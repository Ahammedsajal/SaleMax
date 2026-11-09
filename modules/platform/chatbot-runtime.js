'use strict';
const crypto = require('node:crypto');
const dbPool = require('../../database/config').promise();
const { query } = require('../../database/dbpromise');
const tenantAiSettings = require('./tenant-ai-settings');
const provider = require('./chatbot-provider');
const admissions = require('./chatbot-admissions-intake');
const { shouldPause } = require('./chatbot-conversation-control');
const { parseGuidedFlow, executionFlowId, inboundMessageKey } = require('./chatbot-profile-utils');
const { getDomainPack } = require('./chatbot-domain-packs');
const { isGuidedChoice, hybridTurnPlan, supportsAiPreview } = require('./chatbot-config');
const { channelFor } = require('./chatbot-channels');
const { buildAiPrompt } = require('./chatbot-ai-prompt');
const businessContext = require('./chatbot-business-context');
const { isOpeningGreeting } = require('./chatbot-opening-flow');
const replyCache = new Map();
const CACHE_MAX = 250;
const { recipientAllowed } = require('./chatbot-audience');
let nextGuidedSessionPruneAt = 0;
let guidedSessionPrunePromise = null;

const fail = code => { throw Object.assign(new Error(code), { code }); };
const textOf = message => {
  const body = message?.msgContext?.text?.body ?? message?.msgContext?.button?.text ?? message?.msgContext?.interactive?.button_reply?.title ?? message?.msgContext?.interactive?.list_reply?.title;
  return typeof body === 'string' ? body.trim().slice(0, 2000) : '';
};
function mergeKnowledgeEntries(...groups) {
  const seen = new Set();
  return groups.flat().filter(item => item && typeof item === 'object').filter(item => {
    const key = `${businessContext.normalized(item.questionEn)}|${businessContext.normalized(item.questionAr)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
async function loadApprovedFaqs(tenantId) {
  const db = await dbPool.getConnection();
  try {
    const [rows] = await db.query(`SELECT question_en AS questionEn,answer_en AS answerEn,question_ar AS questionAr,answer_ar AS answerAr
      FROM sx_chatbot_faqs WHERE tenant_id=? AND is_active=1 ORDER BY position,created_at,id LIMIT 60`, [tenantId]);
    return rows;
  } finally { db.release(); }
}

async function currentOwnerAccess(uid) {
  const db=await dbPool.getConnection();
  try{return await require('./chatbot-runtime-access').resolveOwnerAccess(db,uid);}
  finally{db.release();}
}
async function resolveTenant(uid) {return (await currentOwnerAccess(uid)).context;}

async function claimTurn(ctx, profile, message, chatId) {
  const providerMessageId = String(message?.metaChatId || '').trim();
  if (!providerMessageId || providerMessageId.length > 255) return null;
  // Keep webhook retries idempotent if an operator changes the active bot
  // assigned to this number before the provider retries the same message.
  const inboundId = inboundMessageKey(profile, chatId, providerMessageId);
  const db = await dbPool.getConnection();
  try {
    await db.beginTransaction();
    const id = crypto.randomUUID();
    const [insert] = await db.query(`INSERT IGNORE INTO sx_chatbot_turns(id,tenant_id,conversation_id,inbound_message_id,profile_id,status,attempts,lease_until)
      VALUES (?,?,?,?,?,'processing',1,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 45 SECOND))`, [id, ctx.tenant.id, chatId, inboundId, profile.id]);
    if (insert.affectedRows === 1) { await db.commit(); return { id, duplicate: false }; }
    const [[row]] = await db.query(`SELECT id,status,attempts,lease_until AS leaseUntil FROM sx_chatbot_turns WHERE tenant_id=? AND inbound_message_id=? FOR UPDATE`, [ctx.tenant.id, inboundId]);
    if (!row) { await db.rollback(); return null; }
    const leaseExpired = new Date(row.leaseUntil).getTime() <= Date.now();
    if (row.status === 'sent' || row.status === 'handed_off' || (row.status === 'processing' && !leaseExpired) || Number(row.attempts) >= 3) {
      await db.commit(); return { id: row.id, duplicate: true };
    }
    await db.query(`UPDATE sx_chatbot_turns SET profile_id=?,conversation_id=?,status='processing',attempts=attempts+1,lease_until=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 45 SECOND),result_class=NULL WHERE id=?`, [profile.id, chatId, row.id]);
    await db.commit(); return { id: row.id, duplicate: false };
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}

async function finishTurn(turn, status, resultClass, diagnostic = null) {
  if (!turn?.id) return;
  await query(`UPDATE sx_chatbot_turns SET status=?,result_class=?,error_stage=?,error_code=?,lease_until=UTC_TIMESTAMP(3) WHERE id=? AND status='processing'`,
    [status, resultClass, diagnostic?.stage || null, diagnostic?.code || null, turn.id]);
}

async function sendBotText({ origin, sessionId, message, uid, chatId, body, bypassBotPause = true }) {
  const content = { type: 'text', text: { preview_url: false, body: String(body || '').slice(0, 1200) } };
  const id = await require('../../automation/functions').sendWaMessage({ origin, sessionId, message, uid, chatId, content, bypassBotPause });
  if (!id) return false;
  const data = { type: 'text', metaChatId: id, msgContext: content, reaction: '', timestamp: Math.trunc(Date.now() / 1000),
    senderName: message?.senderName || '7Network', senderMobile: message?.senderMobile || '', star: 0, route: 'OUTGOING', context: null, origin, sentBy: 'bot' };
  try {
    await require('./chatbot-conversation-store').persistConversationMessage({ uid, chatId, data: { ...data, msgContext: JSON.stringify(content), context: null } });
    await query('UPDATE beta_chats SET last_message=? WHERE uid=? AND chat_id=?', [JSON.stringify(data), uid, chatId]);
  } catch (error) {
    // Treat a provider-accepted message as sent even if local history is unavailable.
    console.warn('[chatbot] bot message accepted but local history update failed', error.code || 'HANDOFF_HISTORY_UPDATE_FAILED');
  }
  return true;
}

function handoffText(message, language = null, accepted = false) {
  const lang = language || businessContext.languageFor(textOf(message), {});
  if (lang === 'ar') return accepted
    ? 'شكرًا لانتظارك. أحد أعضاء فريقنا استلم استفسارك وسيرد عليك هنا قريبًا.'
    : 'أحلت استفسارك إلى فريقنا. سيرد عليك أحد أعضاء الفريق في هذه المحادثة عند توفره.';
  return accepted
    ? 'Thanks for waiting. A team member has accepted your request and will reply here shortly.'
    : 'I’ve passed your message to our team. A staff member will reply in this chat as soon as they’re available.';
}

async function sendCustomerHandoffNotice({ ctx, profile, uid, message, origin, sessionId, chatId, accepted = false }) {
  if (!await canSendNow({ ctx, profile, uid, origin, sessionId, chatId, message, checkPause: false })) return false;
  const channelKind = channelFor(origin);
  const inboundId = String(message?.metaChatId || crypto.createHash('sha256').update(JSON.stringify([chatId, message?.timestamp || '', textOf(message)])).digest('hex')).slice(0, 191);
  const claims = require('./chatbot-handoff-claims');
  const pending = await claims.findOpen(dbPool, { tenantId: ctx.tenant.id, uid, channelKind, channelRef: sessionId, chatId });
  if (!pending) return false;
  if (!await claims.reserveCustomerAcknowledgement(dbPool, { tenantId: ctx.tenant.id, claimId: pending.id, inboundId })) return false;
  const sent = await sendBotText({ origin, sessionId, message, uid, chatId, body: handoffText(message, null, accepted) }).catch(() => false);
  if (!sent) await claims.releaseCustomerAcknowledgement(dbPool, { tenantId: ctx.tenant.id, claimId: pending.id, inboundId }).catch(() => {});
  return sent;
}

async function handoffConversation(ctx, chatId, channelKind, channelRef, reason, profile = null, uid = null, intake = null) {
  const db = await dbPool.getConnection();
  try {
    await db.beginTransaction();
    const handoffs = require('./chatbot-handoff-claims');
    const minutes = handoffs.holdMinutes(ctx.tenant.id);
    let claim = null;
    if (profile && uid) {
      const brief = await buildHandoffBrief(db, { ctx, profile, uid, chatId, channelKind, channelRef, intake });
      claim = await handoffs.open(db, { ctx, profile, uid, chatId, channelKind, channelRef, reason, brief });
      if (minutes === 60 && claim.status === 'claimed') {
        await db.commit();
        return claim;
      }
    }
    const controlReason = String((minutes === 60 && claim?.reason) || reason || 'human-review').slice(0, minutes === 60 ? 120 : 240);
    await db.query(`INSERT INTO sx_chatbot_conversation_controls(id,tenant_id,channel_kind,channel_ref,conversation_id,mode,pause_until,reason,revision,updated_by_kind,updated_by_identity_id)
      VALUES (?,?,?,?,?,'paused',COALESCE(
        (SELECT expires_at FROM sx_chatbot_handoff_claims WHERE tenant_id=? AND id=?),
        TIMESTAMPADD(MINUTE,?,UTC_TIMESTAMP(3))),?,1,'system',NULL)
      ON DUPLICATE KEY UPDATE mode='paused',pause_until=VALUES(pause_until),reason=VALUES(reason),revision=revision+1,updated_by_kind='system',updated_by_identity_id=NULL`,
    [crypto.randomUUID(), ctx.tenant.id, channelKind, channelRef, chatId, ctx.tenant.id,
      minutes === 60 ? claim?.id ?? null : null, minutes, controlReason]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,NULL,'system','chatbot.conversation-auto-handoff','chatbot-conversation',?,?,?)`,
    [crypto.randomUUID(), ctx.tenant.id, chatId, JSON.stringify({ mode: 'paused', reason: controlReason }), crypto.randomUUID()]);
    if (claim?.created) {
      const taskId = await require('./chatbot-handoff-task').assignHandoffTask(db, { ctx, profile, uid, chatId, channelKind, channelRef, reason });
      if (taskId) await db.query('UPDATE sx_chatbot_handoff_claims SET handoff_task_id=? WHERE tenant_id=? AND id=?', [taskId, ctx.tenant.id, claim.id]);
      await handoffs.queue(db, ctx.tenant.id, claim);
    }
    if (profile?.config?.assignHandoffsToInbox === true && profile.config.handoffAssigneeIdentityId && uid) {
      await require('./team-conversation-assignment').assignConversation(db, { ctx, uid, chatId, identityId: profile.config.handoffAssigneeIdentityId, reason: 'bot-human-handover' });
    }
    await db.commit();
    return claim;
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}

async function buildHandoffBrief(db, { ctx, profile, uid, chatId, channelKind, channelRef, intake }) {
  try {
    const [[chat]] = await db.query('SELECT sender_mobile AS senderMobile,sender_name AS senderName FROM beta_chats WHERE uid=? AND chat_id=? LIMIT 1', [uid, chatId]);
    const [rows] = await db.query(`SELECT route,type,msgContext FROM beta_conversation
      WHERE uid=? AND chat_id=? ORDER BY id DESC LIMIT 12`, [uid, chatId]);
    const transcript = rows.reverse().map(row => {
      let value = row.msgContext;
      try { if (typeof value === 'string') value = JSON.parse(value); } catch { value = null; }
      const text = value?.text?.body ?? value?.button?.text ?? value?.interactive?.button_reply?.title ?? value?.interactive?.list_reply?.title;
      return typeof text === 'string' && text.trim() ? { role: row.route === 'OUTGOING' ? 'assistant' : 'user', text: text.trim().slice(0, 400) } : null;
    }).filter(Boolean).slice(-8);
    const inbound = transcript.filter(turn => turn.role === 'user');
    const latestEnquiry = inbound.at(-1)?.text || '';
    let courseDetails = [];
    if (ctx.tenant.categoryKey === 'training_center') {
      const [courses] = await db.query(`SELECT code,name_en AS nameEn,name_ar AS nameAr FROM sx_training_courses
        WHERE tenant_id=? AND status='active' ORDER BY updated_at DESC LIMIT 100`, [ctx.tenant.id]);
      let selectedCourseCode = null;
      const [[session]] = await db.query(`SELECT state FROM sx_chatbot_guided_sessions WHERE tenant_id=? AND profile_id=? AND channel_kind=?
        AND channel_ref=? AND conversation_id=? LIMIT 1`, [ctx.tenant.id, profile.id, channelKind, channelRef]).catch(() => [[]]);
      try { const state = typeof session?.state === 'string' ? JSON.parse(session.state) : session?.state; selectedCourseCode = state?.selectedCourseCode || null; } catch {}
      const matched = businessContext.retrieveContext({ facts: courses, message: inbound.map(turn => turn.text).join('\n'), state: { selectedCourseCode } });
      courseDetails = (matched.evidence || []).filter(item => item.kind === 'course').slice(0, 3).map(item => ({ code: item.code, nameEn: item.name, nameAr: courses.find(course => course.code === item.code)?.nameAr || '' }));
    }
    return {
      customerName: intake?.name || String(chat?.senderName || '').trim().slice(0, 160) || null,
      customerPhone: require('./business-whatsapp').phone(chat?.senderMobile) || null,
      courseDetails,
      latestEnquiry: [intake?.courseInterest ? `Course enquiry: ${intake.courseInterest}` : '',
        intake?.preferredStart ? `Preferred start: ${intake.preferredStart}` : '',
        businessContext.redactCustomerText(latestEnquiry)].filter(Boolean).join('\n').slice(0, 1000),
      summaryContext: profile.config?.aiDataProcessingConfirmed === true ? transcript.map(turn => ({ ...turn, text: businessContext.redactCustomerText(turn.text).slice(0, 300) })) : null,
    };
  } catch (error) {
    console.warn('[chatbot] handoff brief unavailable', error.code || 'HANDOFF_BRIEF_UNAVAILABLE');
    return {};
  }
}

async function processHandoffPriorityForProfile({ ctx, profile, uid, message, user, sessionId, origin, chatId }) {
  const channelKind = channelFor(origin);
  const claims = require('./chatbot-handoff-claims');
  const text = textOf(message);
  if (claims.parseYes(text)) {
    const claimed = await claims.handleStaffClaim(dbPool, { ctx, uid, message, text, channelKind, channelRef: sessionId, chatId });
    if (claimed.handled) {
      let staffReply = 'There are no open staff handoffs to claim.';
      if (claimed.outcome === 'ambiguous') staffReply = 'More than one handoff is waiting. Reply YES followed by the six-character code in the alert.';
      else if (claimed.outcome === 'not_found') staffReply = 'That handoff code is no longer open. Check the latest staff alert.';
      else if (claimed.outcome === 'claimed') staffReply = 'You have been assigned this conversation. Please reply to the customer in the Inbox.';
      else if (claimed.outcome === 'already_claimed') staffReply = 'Another team member has already claimed that conversation.';
      else if (claimed.outcome === 'chat_missing') staffReply = 'That conversation is no longer available in the Inbox.';
      else if (claimed.outcome === 'error') staffReply = 'I could not assign that conversation. Please open it from the Inbox.';
      await sendBotText({ origin, sessionId, message, uid, chatId, body: staffReply }).catch(() => false);
      if (claimed.outcome === 'claimed' && claimed.customerChat?.senderMobile) {
        const customerMessage = { ...message, senderMobile: claimed.customerChat.senderMobile, senderName: claimed.customerChat.senderName || '', metaChatId: `handoff-accepted:${claimed.conversationId}`, timestamp: Date.now() };
        await sendBotText({ origin: claimed.customerChat.origin || origin, sessionId, message: customerMessage, uid, chatId: claimed.conversationId, body: handoffText(customerMessage, null, true) }).catch(() => false);
      }
      return { handled: true, handoffClaim: claimed.outcome };
    }
  }

  const pause = await require('./chatbot-conversation-control').readPause(uid, chatId, channelKind, sessionId);
  if (!pause) return { handled: false };
  if (pause.updatedByKind !== 'system' || pause.failClosed || pause.ambiguous) return { handled: true, paused: true };
  let pending = await claims.findOpen(dbPool, { tenantId: ctx.tenant.id, uid, channelKind, channelRef: sessionId, chatId });
  if (!pending) {
    const claim = await handoffConversation(ctx, chatId, channelKind, sessionId, pause.reason || 'human-review', profile, uid).catch(() => null);
    pending = claim && await claims.findOpen(dbPool, { tenantId: ctx.tenant.id, uid, channelKind, channelRef: sessionId, chatId });
  }
  if (pending) await sendCustomerHandoffNotice({ ctx, profile, uid, message, origin, sessionId, chatId });
  return { handled: true, paused: true, handedOff: Boolean(pending) };
}

async function handleHandoffPriorityMessage({ uid, message, user, sessionId, origin, chatId }) {
  if (!uid || !chatId || message?.route !== 'INCOMING' || require('./qr-inbox-groups').isGroup({ ...message, chatId })) return { handled: false };
  const access = await currentOwnerAccess(uid);
  const ctx = access.context;
  if (!ctx) return { handled: false };
  const profile = await profileFor(ctx, uid, origin, sessionId);
  if (!profile) return { handled: false };
  const claims = require('./chatbot-handoff-claims');
  await claims.expireDue(dbPool, { tenantId: ctx.tenant.id, channelKind: channelFor(origin), channelRef: sessionId, conversationId: chatId }).catch(error => {
    console.warn('[chatbot] handoff expiry sweep failed', error.code || 'HANDOFF_EXPIRY_FAILED');
  });
  if (claims.parseYes(textOf(message))) {
    const result = await processHandoffPriorityForProfile({ ctx, profile, uid, message, user, sessionId, origin, chatId });
    if (result.handled) return result;
  }
  if (ctx.tenant.categoryKey === 'training_center' && isOpeningGreeting(textOf(message))) {
    try {
      const restarted = await claims.resetForCustomerGreeting(dbPool, {
        tenantId: ctx.tenant.id, uid, channelKind: channelFor(origin), channelRef: sessionId, conversationId: chatId,
      });
      if (restarted) return { handled: false, restartedAfterHandoff: true };
    } catch (error) {
      console.warn('[chatbot] greeting handoff reset failed', error.code || 'GREETING_HANDOFF_RESET_FAILED');
      return { handled: true, paused: true };
    }
  }
  const pause = await require('./chatbot-conversation-control').readPause(uid, chatId, channelFor(origin), sessionId);
  if (!pause) return { handled: false };
  return processHandoffPriorityForProfile({ ctx, profile, uid, message, user, sessionId, origin, chatId });
}

async function profileFor(ctx, uid, origin, sessionId) {
  const kind = channelFor(origin);
  if (!kind || typeof sessionId !== 'string' || !sessionId) return null;
  const rows = await query(`SELECT b.id,b.name,b.engine,b.config,b.revision,b.category_key AS categoryKey,b.category_version AS categoryVersion,
      ca.channel_kind AS channelKind,ca.channel_ref AS channelRef
    FROM sx_chatbot_profiles b JOIN sx_chatbot_channel_assignments ca ON ca.tenant_id=b.tenant_id AND ca.chatbot_id=b.id
    WHERE b.tenant_id=? AND b.status='live' AND b.category_key=? AND b.category_version=? AND ca.channel_kind=? AND ca.channel_ref=? LIMIT 2`,
  [ctx.tenant.id, ctx.tenant.categoryKey, ctx.tenant.categoryVersion, kind, sessionId]);
  if (rows.length !== 1) return null;
  const p = rows[0];
  try { p.config = typeof p.config === 'string' ? JSON.parse(p.config) : p.config; } catch { return null; }
  return p;
}

async function loadGuidedFlow(uid, flowId) {
  if (!flowId || !/^[A-Za-z0-9_-]{1,80}$/.test(flowId)) return null;
  const rows = await query(`SELECT flow_id AS flowId,data,source,is_active AS isActive FROM beta_flows WHERE uid=? AND flow_id=? AND source='wa_chatbot' AND is_active=1 LIMIT 2`, [uid, flowId]);
  return rows.length === 1 ? parseGuidedFlow(rows[0]) : null;
}

async function claimOpeningFlow({ctx,profile,chatId,channelKind,channelRef,greeted=false}) {
  const db=await dbPool.getConnection();
  try {
    await db.beginTransaction();
    await db.query(`INSERT IGNORE INTO sx_chatbot_guided_sessions(id,tenant_id,profile_id,channel_kind,channel_ref,conversation_id,conversation_hash,state,expires_at)
      VALUES (?,?,?,?,?,?,?,JSON_OBJECT(),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR))`,
    [crypto.randomUUID(),ctx.tenant.id,profile.id,channelKind,channelRef,chatId,guidedConversationHash(chatId)]);
    const [[row]]=await db.query(`SELECT id,state,(expires_at<=UTC_TIMESTAMP(3)) AS expired FROM sx_chatbot_guided_sessions
      WHERE tenant_id=? AND profile_id=? AND channel_kind=? AND channel_ref=? AND conversation_hash=? AND conversation_id=? FOR UPDATE`,
    [ctx.tenant.id,profile.id,channelKind,channelRef,guidedConversationHash(chatId),chatId]);
    let state={};if(!row.expired)try{state=typeof row.state==='string'?JSON.parse(row.state):row.state||{};}catch{}
    const claimed=!state.openingFlowSent;
    if(claimed){state.openingFlowSent=true;state.greeted=Boolean(greeted);if(greeted)state.step='menu';await db.query(`UPDATE sx_chatbot_guided_sessions SET state=?,expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR) WHERE id=?`,[JSON.stringify(state),row.id]);}
    await db.commit();return claimed;
  } catch(error){await db.rollback().catch(()=>{});throw error;} finally{db.release();}
}

async function guidedTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo }) {
  if (profile.config?.guidedMode === 'domain_default') {
    const introId=profile.config?.introFlowId,channelKind=channelFor(origin);
    const openingGreeting=isOpeningGreeting(textOf(message));
    if(introId&&channelKind){
      await pruneExpiredGuidedSessions();
    }
    if(introId&&channelKind&&await claimOpeningFlow({ctx,profile,chatId,channelKind,channelRef:sessionId,greeted:openingGreeting})&&openingGreeting){
      const intro=await loadGuidedFlow(uid,introId);if(!intro)return false;
      if(!await canSendNow({ctx,profile,uid,origin,sessionId,chatId,message}))return await shouldPause(uid,chatId,channelKind,sessionId)?{paused:true}:false;
      const {processFlow}=require('../../automation/automation'),flowSessionId=executionFlowId(profile);
      const result=await processFlow({nodes:intro.nodes,edges:intro.edges,uid,flowId:flowSessionId,message,incomingText:textOf(message),user,sessionId,origin,chatId,element:{...intro,flow_id:flowSessionId},beforeNode:guidedFlowNodeGuard({ctx,profile,uid,origin,sessionId,chatId,message}),loopDetection:{visitedNodes:new Map(),startTime:Date.now()}});
      return result==='paused'?{paused:true}:result!==false;
    }
    return trainingCenterGuidedTurn({ ctx, profile, uid, message, sessionId, origin, chatId, leadInfo });
  }
  const flow = await loadGuidedFlow(uid, profile.config?.flowId);
  if (!flow) return false;
  if(!await canSendNow({ctx,profile,uid,origin,sessionId,chatId,message}))return await shouldPause(uid,chatId,channelFor(origin),sessionId)?{paused:true}:false;
  const { processFlow } = require('../../automation/automation');
  // Legacy flow_session keys omit the connected channel and profile ID. Give
  // each profile/channel pair its own opaque execution ID to prevent a shared
  // phone contact from continuing another bot's guided conversation.
  const flowSessionId = executionFlowId(profile);
  const result=await processFlow({ nodes: flow.nodes, edges: flow.edges, uid, flowId: flowSessionId, message, incomingText: textOf(message), user, sessionId, origin, chatId, element: { ...flow, flow_id: flowSessionId }, beforeNode: guidedFlowNodeGuard({ctx,profile,uid,origin,sessionId,chatId,message}), loopDetection: { visitedNodes: new Map(), startTime: Date.now() } });
  return result==='paused'?{paused:true}:result!==false;
}

function guidedConversationHash(chatId) {
  return crypto.createHash('sha256').update(String(chatId)).digest();
}

async function pruneExpiredGuidedSessions() {
  if (guidedSessionPrunePromise) return guidedSessionPrunePromise;
  if (Date.now() < nextGuidedSessionPruneAt) return;
  nextGuidedSessionPruneAt = Date.now() + 15 * 60 * 1000;
  guidedSessionPrunePromise = query(`DELETE FROM sx_chatbot_guided_sessions WHERE expires_at<=UTC_TIMESTAMP(3) ORDER BY expires_at LIMIT 500`)
    .catch(error => { console.warn('[chatbot] guided session retention cleanup failed', error.code || 'DB_ERROR'); })
    .finally(() => { guidedSessionPrunePromise = null; });
  await guidedSessionPrunePromise;
}

async function loadDomainGuidedSession({ ctx, profile, chatId, channelKind, channelRef }) {
  await pruneExpiredGuidedSessions();
  const rows = await query(`SELECT state FROM sx_chatbot_guided_sessions
    WHERE tenant_id=? AND profile_id=? AND channel_kind=? AND channel_ref=? AND conversation_hash=? AND conversation_id=? AND expires_at>UTC_TIMESTAMP(3) LIMIT 1`,
  [ctx.tenant.id, profile.id, channelKind, channelRef, guidedConversationHash(chatId), chatId]);
  if (rows.length !== 1) return null;
  try { return typeof rows[0].state === 'string' ? JSON.parse(rows[0].state) : rows[0].state; } catch { return null; }
}

async function sendTurnCourseMedia({ ctx, profile, uid, chatId, sessionId, message, origin, media, state }) {
  const module = require('./chatbot-course-media');
  const recorded = [...(state?.sentCoursePdfIds || [])];
  for (const item of [...media].sort((a,b) => Number(b.kind === 'document') - Number(a.kind === 'document')).slice(0, 2)) {
    const ids = await module.sendCourseMedia({ pool: dbPool, ctx, profile, uid, chatId, sessionId, message, origin, media: [item], valid: () => canSendNow({ ctx, profile, uid, origin, sessionId, chatId, message }) });
    if (ids.length && item.kind === 'document' && !recorded.includes(item.id)) recorded.push(item.id);
  }
  await query(`UPDATE sx_chatbot_guided_sessions SET state=JSON_SET(state,'$.sentCoursePdfIds',JSON_EXTRACT(?,'$')) WHERE tenant_id=? AND profile_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=?`, [JSON.stringify(recorded.slice(-20)), ctx.tenant.id, profile.id, channelFor(origin), sessionId, chatId]);
}

async function sendCourseReplyFollowups({ ctx, profile, uid, origin, sessionId, chatId, message, leadInfo, media, state }) {
  const capture = require('./chatbot-lead-capture');
  const namePrompt = capture.standaloneNamePrompt(leadInfo);
  if (!namePrompt) await capture.markAsked(dbPool, leadInfo, uid);
  if (media?.length) {
    try {
      await sendTurnCourseMedia({ ctx, profile, uid, origin, sessionId, chatId, message, media, state });
    } catch (error) { console.warn('[chatbot] course attachment unavailable', error.code || 'COURSE_MEDIA_ERROR'); }
  }
  if (!namePrompt) return;
  try {
    if (!await canSendNow({ ctx, profile, uid, origin, sessionId, chatId, message })) return;
    const sent = await sendBotText({ origin, sessionId, message, uid, chatId, body: namePrompt, bypassBotPause: false });
    if (sent) await capture.markAsked(dbPool, leadInfo, uid);
  } catch (error) { console.warn('[chatbot] name question unavailable', error.code || 'NAME_QUESTION_FAILED'); }
}

async function trainingCenterGuidedTurn({ ctx, profile, uid, message, sessionId, origin, chatId, intent = null, leadInfo, onStage = null }) {
  onStage?.('training-channel-and-pack');
  const channelKind = channelFor(origin);
  const pack = getDomainPack(ctx.category.key, ctx.category.version);
    if (!channelKind || !pack.guidedReply) { onStage?.('training-guided-route-unavailable'); return false; }
  onStage?.('training-session-prune');
  await pruneExpiredGuidedSessions();
  let cvSubmission = null, cvError = null;
  if(ctx.category.key==='7network_sales'&&message?.type==='document'){
    const candidateState=await loadDomainGuidedSession({ctx,profile,chatId,channelKind,channelRef:sessionId});
    if(candidateState?.step==='awaiting_cv'&&candidateState.screeningConsent===true){
      try{
        cvSubmission=await require('./recruitment-applications').createFromWhatsApp(dbPool,{tenantSlug:ctx.tenant.slug,answers:candidateState.answers,mobile:message.senderMobile,channelKind,channelRef:sessionId,conversationId:chatId,senderName:message.senderName,mediaUrl:message.msgContext?.document?.link,fileName:message.msgContext?.document?.filename});
      }catch(error){cvError=error.code||'CV_SAVE_FAILED';}
    }
  }
  onStage?.('training-db-connect');
  const db = await dbPool.getConnection();
  let reply = null;
  let deferLeadQuestion = false;
  try {
    onStage?.('training-course-facts');
    const facts = leadInfo?.facts || (pack.requiresDatabase
      ? await pack.loadFacts({ db, tenantId: ctx.tenant.id, platformOrigin: process.env.SALEMAX_PLATFORM_ORIGIN, config: profile.config })
      : []);
    onStage?.('training-approved-faqs');
    const knowledgeEntries = mergeKnowledgeEntries(profile.config?.knowledgeEntries || [], await loadApprovedFaqs(ctx.tenant.id));
    onStage?.('training-session-transaction');
    await db.beginTransaction();
    await db.query(`INSERT IGNORE INTO sx_chatbot_guided_sessions(id,tenant_id,profile_id,channel_kind,channel_ref,conversation_id,conversation_hash,state,expires_at)
      VALUES (?,?,?,?,?,?,?,JSON_OBJECT(),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR))`,
    [crypto.randomUUID(), ctx.tenant.id, profile.id, channelKind, sessionId, chatId, guidedConversationHash(chatId)]);
    const [[row]] = await db.query(`SELECT id,state,expires_at AS expiresAt FROM sx_chatbot_guided_sessions
      WHERE tenant_id=? AND profile_id=? AND channel_kind=? AND channel_ref=? AND conversation_hash=? AND conversation_id=?
      FOR UPDATE`, [ctx.tenant.id, profile.id, channelKind, sessionId, guidedConversationHash(chatId), chatId]);
    onStage?.('training-session-read');
    let priorState = null;
    if (row && new Date(row.expiresAt).getTime() <= Date.now()) priorState = null;
    else if (row) { try { priorState = typeof row.state === 'string' ? JSON.parse(row.state) : row.state; } catch { priorState = null; } }
    if(priorState&&typeof message.senderMobile==='string')priorState.whatsappNumber=message.senderMobile;
    if (profile.engine !== 'guided' && priorState) priorState.language = businessContext.languageFor(intent || textOf(message), priorState);
    const openingGreeting = isOpeningGreeting(intent || textOf(message));
    deferLeadQuestion = openingGreeting || !priorState?.greeted;
    if(cvSubmission){
      const success= cvSubmission.repeated
        ? (priorState?.language==='ar'?'تم تسجيل طلبك مسبقاً. سيرتك الذاتية محفوظة، وسيتواصل معك المؤسس قريباً.':'Your application is already recorded. Your CV is saved, and the Founder will contact you soon.')
        : (priorState?.language==='ar'?`شكراً! تم تقديم طلبك وحفظ سيرتك الذاتية في قسم الطلبات الخاص. رقم الطلب ${cvSubmission.referenceCode}. سيتواصل معك المؤسس قريباً.`:`Thank you! Your application is submitted and your CV is saved in our private Applications & CVs area. Reference: ${cvSubmission.referenceCode}. The Founder will contact you soon.`);
      reply={reply:success,state:{...priorState,step:'application_submitted',applicationReferenceCode:cvSubmission.referenceCode},buttons:[],handoff:true,handoffReason:'recruitment-complete'};
    }else if(cvError){
      const invalid=cvError==='CV_TYPE_NOT_ALLOWED'||cvError==='INVALID_CV_FILE';
      reply={reply:priorState?.language==='ar'?(invalid?'يرجى إرسال السيرة الذاتية كملف PDF أو DOCX حتى 8 ميغابايت.':'تعذر حفظ الملف الآن. يرجى المحاولة مرة أخرى بعد قليل.'):(invalid?'Please send your CV as a PDF or DOCX file up to 8 MB.':'I couldn’t save that file just now. Please try sending it again shortly.'),state:priorState,buttons:[]};
    }else {
      const referral = message?.msgContext?.referral || null;
      const referralContext = businessContext.retrieveContext({ facts, message: intent || textOf(message), state: priorState || {}, referral });
      const referralCourse = referralContext.courseContextSource === 'meta_referral'
        ? facts.find(item => item.code === referralContext.selectedCourseCode) : null;
      const selectedCourse = businessContext.isBareCourseSelection(textOf(message), referralContext)
        ? facts.find(item => item.code === referralContext.selectedCourseCode) : null;
      const guideMessage = !intent && selectedCourse
        ? (selectedCourse.nameEn || selectedCourse.nameAr || textOf(message))
        : !intent && referralCourse
          ? `${textOf(message)} ${referralContext.language === 'ar' ? (referralCourse.nameAr || referralCourse.nameEn) : (referralCourse.nameEn || referralCourse.nameAr)}`
          : intent || textOf(message);
      onStage?.('training-guide-compose');
      reply = pack.guidedReply({ message: guideMessage, state: priorState, facts, config: { ...(profile.config?.guidedContent || {}), knowledgeEntries } });
    }
    // A lead-capture name prompt must never erase a substantive safety route
    // (for example, a certificate question that needs staff confirmation).
    if (leadInfo?.nameOnly && !openingGreeting && !reply?.handoff) reply = { reply: profile.config?.guidedContent?.messages?.nameCollectedMessage?.[leadInfo.language] || pack.guidedContentDefaults.messages.nameCollectedMessage[leadInfo.language], state: priorState || {} };
    if (!reply || typeof reply.reply !== 'string' || !reply.reply.trim()) {
      await db.rollback();
      onStage?.('training-guide-empty-reply');
      return false;
    }
    onStage?.('training-guide-polish');
    reply = businessContext.polishGuidedReply({ result: reply, profile, message: textOf(message), state: priorState, defaults: pack.guidedContentDefaults });
    const questionLeadInfo = deferLeadQuestion ? null : leadInfo;
    if (!reply.handoff) reply.reply = require('./chatbot-lead-capture').addQuestion(reply.reply, questionLeadInfo, profile.config, pack.guidedContentDefaults);
    reply.state.sentCoursePdfIds = priorState?.sentCoursePdfIds || [];
    const pdfs = require('./chatbot-course-media').coursePdfs(facts, reply.state.selectedCourseCode, textOf(message), reply.state.sentCoursePdfIds);
    reply.media = [...(reply.media || []).filter(item => item.kind !== 'document'), ...pdfs];
    onStage?.('training-session-save');
    const nextState = JSON.stringify(reply.state || {});
    await db.query(`UPDATE sx_chatbot_guided_sessions SET state=?,expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR) WHERE id=?`, [nextState, row.id]);
    if(ctx.category.key==='7network_sales'&&reply.state?.screeningConsent===true&&reply.state?.answers){
      const recruitment=require('./recruitment-applications');
      const saved=await recruitment.saveScreening(db,{tenantId:ctx.tenant.id,channelKind,channelRef:sessionId,conversationId:chatId,mobile:message.senderMobile,senderName:message.senderName,answers:reply.state.answers,complete:['awaiting_cv','application_saved','application_submitted'].includes(reply.state.step),consent:true});
      if(saved?.applicationId&&reply.state.step==='awaiting_cv'){
        const prefill=await recruitment.issuePrefillToken(db,{tenantId:ctx.tenant.id,applicationId:saved.applicationId,answers:reply.state.answers});
        const url=new URL(`/careers/${encodeURIComponent(ctx.tenant.slug)}?source=whatsapp&prefill=${encodeURIComponent(prefill)}`,'https://7network.live').toString();
        reply.reply=`Please upload your CV here as a PDF or DOCX file (up to 8 MB) to complete your application. Your answers are saved. You can also review your details and upload your CV here: ${url}\n\nOur recruiter will contact you soon.`;
        reply.buttons=[{id:'talk_to_recruiter',title:'Talk to recruiter'}];
        reply.handoff=true;reply.handoffReason='recruitment-awaiting-cv';
      }
    }
    if(ctx.category.key==='7network_sales'&&reply.notifyRecruiter){
      await require('./recruitment-founder-notifications').enqueue(db,{tenantId:ctx.tenant.id,profileId:profile.id,channelKind,channelRef:sessionId,conversationId:chatId,inboundMessageId:String(message.metaChatId||`recruiter:${chatId}:${Date.now()}`),payload:{answers:{...(reply.state.answers||{}),fullName:reply.state.answers?.fullName||message.senderName||'Not provided',whatsappNumber:reply.state.answers?.whatsappNumber||message.senderMobile||'Not provided',contactNumber:reply.state.answers?.contactNumber||message.senderMobile||'Not provided'},whatsappNumber:reply.state.answers?.whatsappNumber||message.senderMobile||'Not provided',senderName:reply.state.answers?.fullName||message.senderName||'Candidate',source:'Candidate requested the recruiter'}});
    }
    onStage?.('training-db-commit');
    await db.commit();
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }

  onStage?.('training-authority-check');
  if (!await canSendNow({ ctx, profile, uid, origin, sessionId, chatId, message })) { onStage?.('training-authority-blocked'); return false; }
  const { sendWaMessage } = require('../../automation/functions');
  const interactiveButtons=channelKind==='whatsapp_meta'&&Array.isArray(reply.buttons)?reply.buttons.filter(item=>item&&typeof item.id==='string'&&typeof item.title==='string'&&item.id.length<=256&&item.title.length<=20).slice(0,3):[];
  const messageContext=interactiveButtons.length?{type:'interactive',interactive:{type:'button',body:{text:reply.reply.slice(0,1024)},action:{buttons:interactiveButtons.map(item=>({type:'reply',reply:{id:item.id,title:item.title}}))}}}:{type:'text',text:{preview_url:false,body:reply.reply}};
  onStage?.('training-whatsapp-send');
  const sentId = await sendWaMessage({ origin, sessionId, message, uid, chatId, content: messageContext });
  if (!sentId) { onStage?.('training-whatsapp-send-empty'); return false; }
  if (reply.handoff) await handoffConversation(ctx, chatId, channelKind, sessionId, reply.handoffReason||'customer-requested-human', profile, uid);
  const timestamp = Math.trunc(Date.now() / 1000);
  const messageData = { type: messageContext.type, metaChatId: sentId, msgContext: messageContext, reaction: '', timestamp, senderName: message.senderName, senderMobile: message.senderMobile, star: 0, route: 'OUTGOING', context: null, origin, sentBy: 'bot' };
  onStage?.('training-conversation-persist');
  await require('./chatbot-conversation-store').persistConversationMessage({ uid, chatId, data: { ...messageData, msgContext: JSON.stringify(messageData.msgContext), context: null } });
  await query(`UPDATE beta_chats SET last_message=? WHERE uid=? AND chat_id=?`, [JSON.stringify(messageData), uid, chatId]);
  if (!reply.handoff) await sendCourseReplyFollowups({ ctx, profile, uid, origin, sessionId, chatId, message,
    leadInfo: deferLeadQuestion ? null : leadInfo, media: reply.media, state: reply.state });
  return true;
}

function tokenEstimate(text) { return Math.min(12000, Math.max(256, Math.ceil(Buffer.byteLength(text, 'utf8') / 1.5) + 700)); }
async function reserveTokens(ctx, providerConfig, amount) {
  return tenantAiSettings.reserveTokens(dbPool, ctx.tenant.id, providerConfig.daily_token_limit, amount);
}
async function settleTokens(ctx, reservation, used, details = {}) {
  return tenantAiSettings.settleTokens(dbPool, ctx.tenant.id, reservation, used, details);
}

async function saveConversationalState({ ctx, profile, chatId, channelKind, channelRef, state }) {
  await query(`INSERT INTO sx_chatbot_guided_sessions(id,tenant_id,profile_id,channel_kind,channel_ref,conversation_id,conversation_hash,state,expires_at)
    VALUES (?,?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR))
    ON DUPLICATE KEY UPDATE state=VALUES(state),expires_at=VALUES(expires_at)`,
  [crypto.randomUUID(), ctx.tenant.id, profile.id, channelKind, channelRef, chatId, guidedConversationHash(chatId), JSON.stringify(state)]);
}

async function canSendNow({ ctx, profile, uid, origin, sessionId, chatId, message, checkPause=true }) {
  const access=await currentOwnerAccess(uid);
  if(!require('./chatbot-runtime-access').sameBoundary(ctx,access.context))return false;
  const current = await profileFor(access.context, uid, origin, sessionId);
  return current?.id === profile.id && Number(current.revision) === Number(profile.revision)
    && recipientAllowed(current.config, message?.senderMobile, current.id)
    && (!checkPause||!await shouldPause(uid, chatId, channelFor(origin), sessionId));
}

function guidedFlowNodeGuard({ctx,profile,uid,origin,sessionId,chatId,message}){
  let checks=0;
  return async()=>{
    try{
      const allowed=await canSendNow({ctx,profile,uid,origin,sessionId,chatId,message,checkPause:false});
      checks++;
      if(!allowed){if(checks>1)await handoffConversation(ctx,chatId,channelFor(origin),sessionId,'guided-flow-authority-changed',profile,uid).catch(()=>{});return false;}
      return await shouldPause(uid,chatId,channelFor(origin),sessionId)?'paused':'allowed';
    }catch(error){
      console.warn('[chatbot] guided flow authority check failed',error.code||'AUTHORITY_CHECK_FAILED');
      checks++;
      if(checks>1)await handoffConversation(ctx,chatId,channelFor(origin),sessionId,'guided-flow-authority-changed',profile,uid).catch(()=>{});
      return false;
    }
  };
}

async function generateAiAnswer({ ctx, profile, uid, customerMessage, chatId = null, channelKind = null, channelRef = null, state = null, factsOverride = null, referral = null, intakeCourse = null, admissionsIntake = false, onStage = null }) {
  onStage?.('ai-settings');
  const settings = await tenantAiSettings.forRuntime(dbPool, ctx.tenant.id);
  if (uid && chatId && await shouldPause(uid, chatId, channelKind, channelRef)) return { paused: true };
  if (!customerMessage) return { handedOff: true, code: 'UNSUPPORTED_MESSAGE_TYPE' };
  const pack = getDomainPack(ctx.category.key, ctx.category.version);
  const loadFacts = async () => {
    if (!pack.requiresDatabase) return [];
    const db = await dbPool.getConnection();
    try { return await pack.loadFacts({ db, tenantId: ctx.tenant.id, platformOrigin: process.env.SALEMAX_PLATFORM_ORIGIN, config: profile.config }); }
    finally { db.release(); }
  };
  onStage?.('course-facts');
  const facts = factsOverride || await loadFacts();
  let session = state || (chatId ? await loadDomainGuidedSession({ ctx, profile, chatId, channelKind, channelRef }) : null) || {};
  if (intakeCourse && !session.selectedCourseCode) {
    const matches = facts.filter(item => !item.kind && [item.nameEn, item.nameAr, item.code]
      .some(name => name && businessContext.normalized(name) === businessContext.normalized(intakeCourse)));
    if (matches.length === 1) session = { ...session, selectedCourseCode: matches[0].code };
  }
  onStage?.('approved-faqs');
  const knowledgeEntries = mergeKnowledgeEntries(profile.config?.knowledgeEntries || [], await loadApprovedFaqs(ctx.tenant.id));
  const context = businessContext.retrieveContext({ facts, knowledgeEntries, message: customerMessage, state: session, profileRevision: profile.revision, referral });
  const nextState = {
    ...session,
    language: context.language,
    // An explicit multi-course question has no single selected course. Clear
    // the prior single-course context so the next follow-up cannot mix it in.
    selectedCourseCode: context.explicitCourses ? context.selectedCourseCode : session.selectedCourseCode || null,
  };
  if (typeof businessContext.shouldClarifyGenericCourseInterest === 'function' && businessContext.shouldClarifyGenericCourseInterest(customerMessage, context, session)) {
    const reply = context.language === 'ar'
      ? 'بكل سرور — عن أي دورة تسأل؟ إذا وصلت من إعلان، أرسل اسم الدورة الظاهر فيه وسأشاركك التفاصيل المناسبة.'
      : 'Of course — which course are you asking about? If you came from an ad, share the course name shown there and I’ll send the right details.';
    return { canAnswer: true, confidence: 1, reply, state: nextState, route: 'clarification', metrics: { inputTokens: 0, outputTokens: 0, cacheHit: false, sources: context.sources } };
  }
  const courseOverview = profile.engine === 'hybrid' && profile.config?.aiFallback !== false && businessContext.isCourseOverviewRequest(customerMessage, context);
  if (ctx.category.key === 'training_center') {
    const handoffReason = businessContext.trainingCenterCoordinatorReason(customerMessage, facts, context.selectedCourseCode || session.selectedCourseCode);
    if (handoffReason) return { handedOff: true, code: handoffReason, state: nextState };
  }
  const factualOverviewFallback = sourceContext => {
    const simple = businessContext.simpleFactualReply(customerMessage, sourceContext, profile.config);
    return simple ? { canAnswer: true, confidence: 1, reply: simple.reply, state: nextState, route: 'facts', metrics: { inputTokens: 0, outputTokens: 0, cacheHit: false, sources: sourceContext.sources } } : null;
  };
  if (profile.engine === 'hybrid') {
    const faq = require('./chatbot-faq').findApprovedFaq(customerMessage, knowledgeEntries, context.language, { hasCourse: context.evidence.some(item => item.kind === 'course') });
    const skipFaq = typeof businessContext.shouldSkipApprovedFaq === 'function' && businessContext.shouldSkipApprovedFaq(customerMessage, context);
    if (faq && !skipFaq) return { canAnswer: true, confidence: 1, reply: faq.answer, state: nextState, route: 'approved_faq', metrics: { inputTokens: 0, outputTokens: 0, cacheHit: false, sources: context.sources } };
    const simple = businessContext.simpleFactualReply(customerMessage, context, profile.config);
    if (simple && !courseOverview) return { canAnswer: true, confidence: 1, reply: simple.reply, state: simple.nextStep ? { ...nextState, step: simple.nextStep } : nextState, route: 'facts', metrics: { inputTokens: 0, outputTokens: 0, cacheHit: false, sources: context.sources } };
    if (courseOverview && !settings) return factualOverviewFallback(context) || { handedOff: true, code: 'AI_PROVIDER_NOT_CONFIGURED' };
  }
  if (!settings) return (admissionsIntake && factualOverviewFallback(context)) || { handedOff: true, code: 'AI_PROVIDER_NOT_CONFIGURED' };
  const historySafe = Array.isArray(session.recentConversation) ? session.recentConversation.slice(-4).map(item => ({ role: item.role, text: businessContext.redactCustomerText(item.text) })) : [];
  const key = businessContext.fingerprint({ tenant: ctx.tenant.id, profile: profile.id, revision: context.revision, model: settings.model, provider: settings.provider, question: businessContext.normalized(customerMessage), language: context.language, history: historySafe, selected: session.selectedCourseCode });
  const cached = replyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.answer, state: nextState, metrics: { ...cached.answer.metrics, cacheHit: true, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 } };
  const sourceAliases = new Map();
  const aiEvidence = courseOverview
    ? context.evidence.filter(item => item.kind === 'course').map(item => ({
      kind: item.kind, code: item.code, name: item.name,
      description: String(item.description || '').slice(0, 520),
      outcomes: String(item.outcomes || '').slice(0, 180),
      difficultyLevel: item.difficultyLevel || null,
      prerequisites: String(item.prerequisites || '').slice(0, 160),
      duration: item.duration || null, delivery: item.delivery || null, offer: item.offer || null,
      sourceId: item.sourceId,
    }))
    : context.evidence;
  const compactEvidence = aiEvidence.map((item, index) => { const alias = 's' + index; sourceAliases.set(alias, item.sourceId); return { ...item, sourceId: alias }; });
  const { system, context: promptContext, user: input, inputBytes } = buildAiPrompt({ pack, profile, customerMessage: businessContext.redactCustomerText(customerMessage), facts: compactEvidence, history: historySafe, courseOverview, admissionsIntake });
  if (inputBytes > 12000) return factualOverviewFallback(context) || { canAnswer: true, reply: businessContext.clarification(profile.config, context.language), confidence: 0, state: nextState, route: 'clarification' };
  const prompt = `${system}\n\n${promptContext}\n\n${input}`;
  const estimate = tokenEstimate(prompt);
  let reservation = null;
  try { reservation = await reserveTokens(ctx, settings, estimate); }
  catch (error) { console.warn('[chatbot] AI usage reservation unavailable', error.code || 'USAGE_RESERVATION_FAILED'); }
  const providerStarted = Date.now();
  let response;
  let succeeded = false;
  let failedUsage = null;
  onStage?.('provider-request');
  try {
    response = await provider.generate({ provider: settings.provider, model: settings.model, apiKey: settings.apiKey, system, context: promptContext, user: input, cacheScope: `${ctx.tenant.id}:chatbot`, requireSources: true, maxOutputTokens: courseOverview ? 90 : admissionsIntake ? 145 : 250 });
    if (Array.isArray(response.sourceIds)) response.sourceIds = response.sourceIds.map(id => sourceAliases.get(id) || 'invalid:' + id);
    if (courseOverview && typeof response.reply === 'string') response.reply = response.reply.replace(/\s*\[s\d+\]/gi, '').trim();
    succeeded = true;
  } catch (error) {
    if (error.usage) response = error.usage;
    if (Number.isSafeInteger(error.tokensUsed)) failedUsage = error.tokensUsed;
    else if (Number.isInteger(error.status)) failedUsage = 0;
    if (courseOverview || (admissionsIntake && ['AI_PROVIDER_TIMEOUT','AI_PROVIDER_REQUEST_FAILED','AI_PROVIDER_INVALID_OUTPUT'].includes(error.code))) {
      return factualOverviewFallback(context) || { handedOff: true, code: error.code || 'AI_PROVIDER_ERROR' };
    }
    throw error;
  } finally {
    try {
      await settleTokens(ctx, reservation, succeeded ? ((response?.inputTokens || 0) + (response?.outputTokens || 0) || null) : failedUsage, {
        provider: settings.provider, model: settings.model,
        inputTokens: response?.inputTokens,
        outputTokens: response?.outputTokens ?? failedUsage,
        cachedInputTokens: response?.cachedInputTokens, cacheWriteTokens: response?.cacheWriteTokens,
      });
    } catch (error) { console.warn('[chatbot] AI usage settlement unavailable', error.code || 'USAGE_SETTLEMENT_FAILED'); }
  }
  const metrics = { inputTokens: response.inputTokens || 0, outputTokens: response.outputTokens || 0, cachedInputTokens: response.cachedInputTokens || 0, cacheWriteTokens: response.cacheWriteTokens || 0, cacheHit: false, latencyMs: Date.now() - providerStarted, sources: context.sources, provider: settings.provider, model: settings.model };
  onStage?.('answer-validation');
  const validation = businessContext.validateAnswer(response, context);
  const threshold = Number(profile.config?.confidenceThreshold ?? 0.72);
  if (!validation.valid || response.confidence < threshold) {
    if (courseOverview) return factualOverviewFallback(context) || { canAnswer: true, reply: businessContext.clarification(profile.config, context.language), confidence: 0, state: nextState, route: 'clarification', reason: validation.code || 'LOW_CONFIDENCE', metrics };
    const language = context.language;
    return { canAnswer: true, confidence: 0, reply: businessContext.unavailableReply(customerMessage, profile.config, language), state: nextState, route: 'clarification', reason: validation.code || 'LOW_CONFIDENCE', metrics };
  }
  // Re-read live facts after the model call; never deliver a price or date
  // generated from data that changed while the provider was working.
  const fresh = businessContext.retrieveContext({ facts: await loadFacts(), knowledgeEntries: mergeKnowledgeEntries(profile.config?.knowledgeEntries || [], await loadApprovedFaqs(ctx.tenant.id)), message: customerMessage, state: session, profileRevision: profile.revision, referral });
  if (fresh.revision !== context.revision) return factualOverviewFallback(fresh) || { canAnswer: true, confidence: 0, reply: businessContext.clarification(profile.config, context.language), state: nextState, route: 'clarification', reason: 'BUSINESS_DATA_CHANGED', metrics };
  const usedCourses = context.evidence.filter(item => item.kind === 'course' && response.sourceIds.includes(item.sourceId));
  if (usedCourses.length === 1 && businessContext.normalized(response.reply).includes(businessContext.normalized(usedCourses[0].name))) nextState.selectedCourseCode = usedCourses[0].code;
  const answer = { canAnswer: true, confidence: response.confidence, reply: response.reply, state: nextState, route: 'ai', metrics };
  // Cache only answers without customer history or contact/private identifiers.
  if (!historySafe.length && customerMessage.length <= 180 && /fee|price|duration|schedule|centre|center|location|address|رسوم|سعر|مدة|عنوان|موقع/i.test(customerMessage) && !/[0-9]{7,}|@|my name|اسمي/i.test(customerMessage)) {
    if (replyCache.size >= CACHE_MAX) replyCache.delete(replyCache.keys().next().value);
    replyCache.set(key, { expiresAt: Date.now() + 5 * 60 * 1000, answer });
  }
  return answer;
}

async function resetOpeningGreetingState({ ctx, profile, uid, chatId, sessionId, origin, senderMobile }) {
  const channelKind = channelFor(origin);
  const db = await dbPool.getConnection();
  try {
    await db.beginTransaction();
    await db.query(`DELETE FROM sx_chatbot_guided_sessions
      WHERE tenant_id=? AND profile_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=?`,
    [ctx.tenant.id, profile.id, channelKind, sessionId, chatId]);
    if ((profile.config?.flowId || profile.config?.introFlowId) && senderMobile) {
      const flowOrigin = origin === 'qr' ? 'qr' : 'meta';
      const flowOriginId = flowOrigin === 'qr' ? sessionId : 'META';
      await db.query(`DELETE FROM flow_session WHERE uid=? AND origin=? AND origin_id=? AND flow_id=? AND sender_mobile=?`,
        [uid, flowOrigin, flowOriginId, executionFlowId(profile), senderMobile]);
    }
    await db.commit();
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }
}

async function aiTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo, onStage = null }) {
  onStage?.('bot-routing');
  const incomingText = textOf(message);
  if (ctx.category.key === 'training_center' && isOpeningGreeting(incomingText)) {
    onStage?.('opening-greeting-reset');
    try {
      await resetOpeningGreetingState({ ctx, profile, uid, chatId, sessionId, origin, senderMobile: message.senderMobile });
    } catch (error) {
      console.warn('[chatbot] opening greeting state reset failed', error.code || 'GREETING_RESET_FAILED');
      return { handedOff: true, code: 'GREETING_RESET_FAILED' };
    }
    const configuredOpeningFlow = profile.config?.flowId
      || (profile.config?.guidedMode === 'domain_default' && profile.config?.introFlowId);
    let dispatched = configuredOpeningFlow
      ? await guidedTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo, onStage })
      : false;
    if (!dispatched) dispatched = await trainingCenterGuidedTurn({ ctx, profile, uid, message, sessionId, origin, chatId, leadInfo, onStage });
    return dispatched ? { flowDispatched: true, route: 'greeting' } : { handedOff: true, code: 'OPENING_GREETING_UNAVAILABLE' };
  }
  if (profile.engine === 'hybrid' && !profile.config?.flowId && profile.config?.guidedMode !== 'domain_default') return { handedOff: true, code: 'GUIDED_FLOW_REQUIRED' };
  const certificateQuestion = /\b(?:what certificate|which certificate|certificate do i get|certificate will i get|certificate after|certificate for this course|certification|accreditation|accredited|attestation)\b|اي شهادة|ما الشهادة|شهادة احصل|شهادة الدورة|الشهادة التي سأحصل|اعتماد الدورة/iu.test(incomingText);
  const safetyRoute = businessContext.controlRoute(incomingText, profile.config || {}, {}, leadInfo?.facts || []);
  if (safetyRoute === 'handoff' && ctx.category.key === 'training_center' && !certificateQuestion) {
    const language = businessContext.languageFor(textOf(message));
    const dispatched = await trainingCenterGuidedTurn({ ctx, profile, uid, message, sessionId, origin, chatId, leadInfo, intent: language === 'ar' ? 'موظف' : 'agent', onStage });
    return dispatched ? { flowDispatched: true, route: 'handoff' } : { handedOff: true, code: 'HUMAN_REVIEW_REQUIRED' };
  }
  const intakeAnswer = leadInfo?.intake?.answerOnly && safetyRoute === 'answer';
  if (!intakeAnswer && (profile.config.guidedMode === 'domain_default' || (profile.engine === 'ai' && ctx.category.key === 'training_center'))) {
    onStage?.('guided-route-check');
    const channelKind = channelFor(origin);
    const session = await loadDomainGuidedSession({ ctx, profile, chatId, channelKind, channelRef: sessionId });
    const incoming = textOf(message);
    const route = businessContext.controlRoute(incoming, profile.config, session || {}, leadInfo?.facts || []);
    let bareCourseSelection = false;
    if (route === 'answer' && !leadInfo?.nameOnly && ctx.category.key === 'training_center') {
      const pack = getDomainPack(ctx.category.key, ctx.category.version);
      let selectionFacts = leadInfo?.facts;
      if (!selectionFacts && pack.requiresDatabase) {
        const db = await dbPool.getConnection();
        try { selectionFacts = await pack.loadFacts({ db, tenantId: ctx.tenant.id, platformOrigin: process.env.SALEMAX_PLATFORM_ORIGIN, config: profile.config }); }
        finally { db.release(); }
      }
      const selectionContext = businessContext.retrieveContext({ facts: selectionFacts || [], message: incoming, state: session || {}, referral: message?.msgContext?.referral || null });
      bareCourseSelection = businessContext.isBareCourseSelection(incoming, selectionContext);
    }
    const applicationAccepted = session?.step === 'course_detail' && /^(?:yes(?:[,.! ]+(?:please(?:\s+(?:send it|send me|share it))?|send it|send me|share it))?|sure|please do|send it|send me|share it|i'm interested|im interested|اي|نعم|نعم من فضلك|أرسلها|ارسلها|أرسل النموذج|ارسل النموذج)$/iu.test(incoming.trim());
    if (route !== 'answer' || leadInfo?.nameOnly || applicationAccepted || bareCourseSelection || (profile.engine === 'hybrid' && profile.config.aiFallback === false)) {
      onStage?.('training-center-guided-reply');
      const handoffIntent = route === 'human' || route === 'handoff'
        ? (businessContext.languageFor(incoming, session || {}) === 'ar' ? 'موظف' : 'agent')
        : null;
      const dispatched = await trainingCenterGuidedTurn({ ctx, profile, uid, message, sessionId, origin, chatId, leadInfo, intent: handoffIntent, onStage });
      return dispatched ? { flowDispatched: true, route } : { handedOff: true, code: 'GUIDED_FLOW_UNAVAILABLE' };
    }
  } else if (!intakeAnswer && profile.engine === 'hybrid' && profile.config.flowId) {
    onStage?.('configured-flow-check');
    const [session] = await query(`SELECT id FROM flow_session WHERE uid=? AND flow_id=? AND sender_mobile=? LIMIT 1`, [uid, executionFlowId(profile), message.senderMobile]);
    const incoming = textOf(message);
    const plan = hybridTurnPlan({ hasSession: !!session, isChoice: isGuidedChoice(incoming), aiFallback: profile.config.aiFallback });
    if (plan.runGuided) {
      const dispatched = await guidedTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo });
      if (dispatched || !plan.allowAiFallback) return dispatched ? { flowDispatched: true } : { handedOff: true, code: 'GUIDED_FLOW_UNAVAILABLE' };
    }
  }
  onStage?.('ai-answer-generation');
  let answer = intakeAnswer
    ? { canAnswer: true, reply: leadInfo.language === 'ar' ? 'شكرا، تم تسجيل ردك.' : 'Thanks, I’ve noted your answer.',
        state: leadInfo.intake.session, route: 'admissions-intake' }
    : await generateAiAnswer({ ctx, profile, uid, customerMessage: incomingText, chatId, channelKind: channelFor(origin),
        channelRef: sessionId, factsOverride: leadInfo?.facts, referral: message?.msgContext?.referral || null,
        admissionsIntake: !!leadInfo?.intake, intakeCourse: leadInfo?.intake ? leadInfo.courseInterest : null, onStage });
  if (leadInfo?.intake && !answer.paused) answer = admissions.planReply(answer, leadInfo);
  if (answer.handedOff || answer.paused) return answer;
  const pack = getDomainPack(ctx.category.key, ctx.category.version);
  const onboarding = ctx.tenant.categoryKey === 'training_center' && !answer.state?.greeted;
  if (onboarding) answer.state = { ...(answer.state || {}), greeted: true };
  const questionLeadInfo = leadInfo?.intake
    ? { ...leadInfo, intake: { ...leadInfo.intake, session: answer.state || {} } }
    : onboarding ? null : leadInfo;
  const answerBeforeIntake = answer.reply;
  answer.reply = require('./chatbot-lead-capture').addQuestion(answer.reply, questionLeadInfo, profile.config, pack.guidedContentDefaults);
  onStage?.('reply-authority-check');
  if (!await canSendNow({ ctx, profile, uid, origin, sessionId, chatId, message })) return { paused: true };
  const { sendWaMessage } = require('../../automation/functions');
  onStage?.('whatsapp-send');
  const sentId = await sendWaMessage({ origin, sessionId, message, uid, chatId, content: { type: 'text', text: { preview_url: false, body: answer.reply } } });
  if (!sentId) return { handedOff: true, code: 'CHANNEL_SEND_FAILED' };
  onStage?.('conversation-persist');
  const timestamp = Math.trunc(Date.now() / 1000);
  const messageData = { type: 'text', metaChatId: sentId, msgContext: { type: 'text', text: { preview_url: false, body: answer.reply } }, reaction: '', timestamp, senderName: message.senderName, senderMobile: message.senderMobile, star: 0, route: 'OUTGOING', context: null, origin, sentBy: 'bot' };
  await query(`INSERT INTO beta_conversation SET ?`, { ...messageData, msgContext: JSON.stringify(messageData.msgContext), context: null, uid, chat_id: chatId });
  await query(`UPDATE beta_chats SET last_message=? WHERE uid=? AND chat_id=?`, [JSON.stringify(messageData), uid, chatId]);
  if (answer.state) await saveConversationalState({ ctx, profile, chatId, channelKind: channelFor(origin), channelRef: sessionId, state: { ...answer.state, recentConversation: intakeAnswer ? answer.state.recentConversation || [] : [...(answer.state.recentConversation || []),
    { role: 'user', text: incomingText.slice(0, 400) },
    { role: 'assistant', text: (leadInfo?.intake ? answerBeforeIntake : answer.reply).slice(0, 500) }].slice(-4) } });
  const media = require('./chatbot-course-media').coursePdfs(leadInfo?.facts || [], answer.state?.selectedCourseCode, textOf(message), answer.state?.sentCoursePdfIds || []);
  await sendCourseReplyFollowups({ ctx, profile, uid, origin, sessionId, chatId, message, leadInfo: questionLeadInfo, media, state: answer.state });
  return { sent: true, route: answer.route, reason: answer.reason, metrics: answer.metrics };
}

async function previewConfiguredBot({ ctx, profile, uid, message, state = null }) {
  if (!supportsAiPreview(profile?.engine, profile?.config)) return { canAnswer: false, confidence: 0, reply: '', wouldHandoff: true, reason: 'AI_FALLBACK_DISABLED' };
  if (profile.engine === 'hybrid') {
    if (profile.config?.guidedMode !== 'domain_default') {
      if (!profile.config?.flowId) return { canAnswer: false, confidence: 0, reply: '', wouldHandoff: true, reason: 'GUIDED_FLOW_REQUIRED' };
      if (!await loadGuidedFlow(uid, profile.config.flowId)) return { canAnswer: false, confidence: 0, reply: '', wouldHandoff: true, reason: 'GUIDED_FLOW_UNAVAILABLE' };
    }
  }
  if (profile.config?.aiDataProcessingConfirmed !== true) return { canAnswer: false, confidence: 0, reply: '', wouldHandoff: true, reason: 'AI_DATA_PROCESSING_ACK_REQUIRED' };
  const prior = businessContext.previewState(state);
  prior.language = businessContext.languageFor(message, prior);
  const pack = getDomainPack(ctx.category.key, ctx.category.version);
  const route = businessContext.controlRoute(message, profile.config, prior);
  if (pack.guidedReply && route !== 'answer') {
    const db = await dbPool.getConnection();
    let facts;
    try { facts = await pack.loadFacts({ db, tenantId: ctx.tenant.id, platformOrigin: process.env.SALEMAX_PLATFORM_ORIGIN, config: profile.config }); } finally { db.release(); }
    const result = pack.guidedReply({ message: route === 'human' ? (businessContext.languageFor(message, prior) === 'ar' ? 'موظف' : 'agent') : message, state: prior, facts, config: profile.config.guidedContent });
    businessContext.polishGuidedReply({ result, profile, message, state: prior, defaults: pack.guidedContentDefaults });
    return { canAnswer: true, confidence: 1, reply: result.reply, wouldHandoff: !!result.handoff, reason: result.handoff ? 'customer-requested-human' : null, route, state: result.state, metrics: { inputTokens: 0, outputTokens: 0 } };
  }
  const answer = await generateAiAnswer({ ctx, profile, uid: null, customerMessage: message, state: prior });
  if (answer.state) answer.state.recentConversation = [...(prior.recentConversation || []), { role: 'user', text: message.slice(0, 400) }, { role: 'assistant', text: (answer.reply || '').slice(0, 500) }].slice(-4);
  if (answer.handedOff) return { canAnswer: false, confidence: answer.confidence || 0, reply: '', wouldHandoff: true, reason: answer.code || 'LOW_CONFIDENCE' };
  return { canAnswer: true, confidence: answer.confidence, reply: answer.reply, wouldHandoff: false, reason: answer.reason || null, route: answer.route, state: answer.state, metrics: answer.metrics };
}

async function finishRecruitmentChat({ctx,profile,uid,message,sessionId,origin,chatId,completion,action}){
  const module=require('./recruitment-chat-completion'),channelKind=channelFor(origin);
  const current=await profileFor(ctx,uid,origin,sessionId);
  const latest=await module.load(dbPool,{tenantId:ctx.tenant.id,channelKind,channelRef:sessionId,conversationId:chatId});
  if(current?.id!==profile.id||Number(current.revision)!==Number(profile.revision)||!recipientAllowed(current.config,message.senderMobile,current.id)||!latest||!module.mayFinish(latest.control))return {paused:true};
  let reply,reason='recruitment-awaiting-cv';
  if(action==='cv'){
    if(latest.application.cvFileName)return {paused:true};
    try{
      await require('./recruitment-applications').createFromWhatsApp(dbPool,{tenantSlug:ctx.tenant.slug,answers:latest.answers,mobile:latest.application.mobile,channelKind,channelRef:sessionId,conversationId:chatId,senderName:latest.application.fullName,mediaUrl:message.msgContext?.document?.link,fileName:message.msgContext?.document?.filename});
      reply='Thank you! Your CV is saved and your application is complete. Our recruiter will contact you soon.';reason='recruitment-complete';
      await query(`UPDATE sx_chatbot_guided_sessions SET state=JSON_SET(state,'$.step','application_submitted') WHERE tenant_id=? AND profile_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=?`,[ctx.tenant.id,profile.id,channelKind,sessionId,chatId]);
    }catch(error){reply=['CV_TYPE_NOT_ALLOWED','INVALID_CV_FILE'].includes(error.code)?'Please upload your CV as a PDF or DOCX file up to 8 MB.':'I couldn’t save the file just now. Please send your CV again, or contact the recruiter.';}
  }else{
    await require('./recruitment-founder-notifications').enqueue(dbPool,{tenantId:ctx.tenant.id,profileId:profile.id,channelKind,channelRef:sessionId,conversationId:chatId,inboundMessageId:String(message.metaChatId),payload:{answers:latest.answers,whatsappNumber:latest.application.mobile,senderName:latest.application.fullName,source:'Candidate requested the recruiter'}});
    reply='I’ve notified the recruiter. They’ll join this chat soon.';reason='recruitment-recruiter-requested';
  }
  // A human pause set while the file was saving also suppresses the acknowledgement.
  const final=await module.load(dbPool,{tenantId:ctx.tenant.id,channelKind,channelRef:sessionId,conversationId:chatId});
  if(!module.mayFinish(final?.control))return {paused:true};
  const content={type:'text',text:{preview_url:false,body:reply}};
  const id=await require('../../automation/functions').sendWaMessage({origin,sessionId,message,uid,chatId,content});
  await handoffConversation(ctx,chatId,channelKind,sessionId,reason,profile,uid);
  if(!id)return {paused:true};
  const data={type:'text',metaChatId:id,msgContext:JSON.stringify(content),reaction:'',timestamp:Math.trunc(Date.now()/1000),senderName:message.senderName,senderMobile:message.senderMobile,star:0,route:'OUTGOING',context:null,origin,sentBy:'bot'};
  await require('./chatbot-conversation-store').persistConversationMessage({uid,chatId,data});
  await query('UPDATE beta_chats SET last_message=? WHERE uid=? AND chat_id=?',[JSON.stringify({...data,msgContext:content}),uid,chatId]);
  return {sent:true};
}

async function runConfiguredBot({ uid, message, user, sessionId, origin, chatId }) {
  if (require('./qr-inbox-groups').isGroup({ ...message, chatId })) return { handled: true, paused: true, code: 'GROUP_AUTOMATION_DISABLED' };
  if (!uid || !chatId || message?.route !== 'INCOMING') return { handled: false };
  const access=await currentOwnerAccess(uid),ctx=access.context;
  if(!ctx){
    const blocked=await require('./chatbot-runtime-access').blocksFallback(dbPool,access,channelFor(origin),sessionId);
    return blocked?{handled:true,paused:true,code:access.code||'BUSINESS_ACCESS_INACTIVE'}:{handled:false};
  }
  const profile = await profileFor(ctx, uid, origin, sessionId);
  if (!profile) return { handled: false };
  const priority = await handleHandoffPriorityMessage({ uid, message, user, sessionId, origin, chatId });
  if (priority.handled) return priority;
  // A restricted chat is handled silently so it cannot fall through to legacy bots.
  if (!recipientAllowed(profile.config, message?.senderMobile, profile.id)) return { handled: true, paused: true, code: 'RECIPIENT_NOT_ENABLED' };
  let leadInfo = null;
  if (ctx.tenant.categoryKey === 'training_center') {
    try {
      const db = await dbPool.getConnection();
      let facts;
      try { facts = await getDomainPack(ctx.category.key, ctx.category.version).loadFacts({ db, tenantId: ctx.tenant.id, platformOrigin: process.env.SALEMAX_PLATFORM_ORIGIN, config: profile.config }); }
      finally { db.release(); }
      leadInfo = await require('./chatbot-lead-capture').captureLead(dbPool, { ctx, profile, uid, chatId, origin, message, facts });
    } catch (error) {
      const claim = await handoffConversation(ctx, chatId, channelFor(origin), sessionId, 'lead-capture-unavailable', profile, uid).catch(() => null);
      if (claim) await sendCustomerHandoffNotice({ ctx, profile, uid, message, origin, sessionId, chatId });
      return { handled: true, handedOff: true, code: 'LEAD_CAPTURE_UNAVAILABLE' };
    }
  } else if (ctx.category.chatbotLeadCapture === 'generic' && profile.config?.captureLeads === true) {
    if (require('./chatbot-lead-capture').genericCaptureEnabled(ctx)) {
      try {
        leadInfo = await require('./chatbot-lead-capture').captureGenericLead(dbPool, { ctx, profile, uid, chatId, origin, message });
      } catch (error) {
        const claim = await handoffConversation(ctx, chatId, channelFor(origin), sessionId, 'lead-capture-unavailable', profile, uid).catch(() => null);
        if (claim) await sendCustomerHandoffNotice({ ctx, profile, uid, message, origin, sessionId, chatId });
        return { handled: true, handedOff: true, code: 'LEAD_CAPTURE_UNAVAILABLE' };
      }
    }
  }

  if (profile.config?.sharedInboxRouting === true) {
    const { getConnectedUsers, sendToUid } = require('../../socket');
    const routed = await require('./team-conversation-assignment').routeIncomingConversation(dbPool, {
      ctx, profile, uid, chatId, connectedUids: getConnectedUsers().map(item => item.uid),
    });
    if (routed) sendToUid(uid, { chatId }, 'request_update_chat_list');
  }
  const channelKind = channelFor(origin);
  const testReset = require('./chatbot-test-reset').isTestReset(profile.config, message?.senderMobile, textOf(message), profile.id);
  const completionModule=require('./recruitment-chat-completion');
  const completion=!testReset&&ctx.category.key==='7network_sales'
    ? await completionModule.load(dbPool,{tenantId:ctx.tenant.id,channelKind,channelRef:sessionId,conversationId:chatId}):null;
  const completionAction=completionModule.actionFor(completion,message,textOf(message));
  if(completionAction==='silent'){
    if(!completion.control||completion.control.mode!=='paused'){
      const claim=await handoffConversation(ctx,chatId,channelKind,sessionId,completion.application.cvFileName?'recruitment-complete':'recruitment-awaiting-cv',profile,uid);
      if(claim)await sendCustomerHandoffNotice({ctx,profile,uid,message,origin,sessionId,chatId});
    }
    return {handled:true,paused:true,code:'RECRUITMENT_QUESTIONS_FINISHED'};
  }
  if (!testReset && !completionAction && await shouldPause(uid, chatId, channelKind, sessionId)) return { handled: true, paused: true };
  const turn = await claimTurn(ctx, profile, message, chatId);
  if (!turn) {
    const claim = await handoffConversation(ctx, chatId, channelKind, sessionId, 'inbound-message-id-unavailable', profile, uid);
    if (claim) await sendCustomerHandoffNotice({ ctx, profile, uid, message, origin, sessionId, chatId });
    return { handled: true, handedOff: true, code: 'INBOUND_MESSAGE_ID_UNAVAILABLE' };
  }
  if (turn.duplicate) return { handled: true, duplicate: true };
  let activeStage = 'turn-processing';
  const setStage = stage => { activeStage = stage; };
  try {
    if (testReset) {
      setStage('test-reset');
      const db = await dbPool.getConnection();
      try { await require('./chatbot-test-reset').resetTestConversation(db, { ctx, profile, uid, chatId, origin, sender: message.senderMobile, turnId: turn.id }); }
      finally { db.release(); }
      message = { ...message, msgContext: { text: { body: 'Hi' } } };
    }
    let result;
    if (completionAction) result = await finishRecruitmentChat({ctx,profile,uid,message,sessionId,origin,chatId,completion,action:completionAction});
    else if (profile.engine === 'guided' && ctx.category.key === 'training_center' && isOpeningGreeting(textOf(message))) result = await aiTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo, onStage: setStage });
    else if (profile.engine === 'guided') { const guided=await guidedTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo });result=guided?.paused?{paused:true}:guided?{sent:true}:{handedOff:true,code:'GUIDED_FLOW_UNAVAILABLE'}; }
    else result = await aiTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo, onStage: setStage });
    setStage('turn-metrics');
    if (result?.metrics) await query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,NULL,'system','chatbot.turn-measured','chatbot-turn',?,?,?)`, [crypto.randomUUID(), ctx.tenant.id, turn.id, JSON.stringify({ route: result.route, reason: result.reason || null, ...result.metrics }), crypto.randomUUID()]);
    if (result?.sent || result?.flowDispatched) await finishTurn(turn, 'sent', result?.flowDispatched ? 'guided-flow-dispatched' : 'reply-sent');
    else if (result?.paused) await finishTurn(turn, 'handed_off', 'human-paused');
    else {
      const claim = await handoffConversation(ctx, chatId, channelKind, sessionId, result?.code || 'human-review', profile, uid, leadInfo?.intake ? { ...leadInfo.intake, courseInterest: leadInfo.courseInterest } : null);
      if (claim && !result?.sent && !result?.flowDispatched) await sendCustomerHandoffNotice({ ctx, profile, uid, message, origin, sessionId, chatId });
      const softFailure = result?.code === 'GUIDED_FLOW_UNAVAILABLE';
      await finishTurn(turn, 'handed_off', result?.code || 'human-review', softFailure ? { stage: activeStage, code: result.code } : null);
    }
    return { handled: true, ...result };
  } catch (error) {
    if (error.code === 'TEST_RESET_BUSY') {
      await finishTurn(turn, 'failed', 'test-reset-busy');
      return { handled: true, code: error.code };
    }
    const diagnosticName = typeof error.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(error.name) ? error.name.toUpperCase() : 'ERROR';
    const diagnosticCode = typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : `UNCLASSIFIED_${diagnosticName}`;
    const failure = ['AI_PROVIDER_NOT_CONFIGURED','AI_PROVIDER_TIMEOUT','AI_PROVIDER_REQUEST_FAILED','AI_PROVIDER_INVALID_OUTPUT'].includes(error.code) ? error.code : 'runtime-error';
    console.warn('[chatbot] inbound turn failed', JSON.stringify({ stage: activeStage, code: diagnosticCode }));
    const claim = await handoffConversation(ctx, chatId, channelKind, sessionId, failure, profile, uid).catch(() => null);
    if (claim) await sendCustomerHandoffNotice({ ctx, profile, uid, message, origin, sessionId, chatId }).catch(() => false);
    await finishTurn(turn, 'handed_off', failure, { stage: activeStage, code: diagnosticCode }).catch(() => {});
    return { handled: true, handedOff: true, code: error.code || 'BOT_RUNTIME_ERROR' };
  }
}

module.exports = { canSendNow, handleHandoffPriorityMessage, runConfiguredBot, previewConfiguredBot, resolveTenant, loadGuidedFlow, parseGuidedFlow, executionFlowId };
