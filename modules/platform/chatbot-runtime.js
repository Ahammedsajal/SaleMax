'use strict';
const crypto = require('node:crypto');
const dbPool = require('../../database/config').promise();
const { query } = require('../../database/dbpromise');
const secrets = require('./chatbot-secrets');
const provider = require('./chatbot-provider');
const { shouldPause } = require('./chatbot-conversation-control');
const { parseGuidedFlow, executionFlowId, inboundMessageKey } = require('./chatbot-profile-utils');
const { getDomainPack } = require('./chatbot-domain-packs');
const { isGuidedChoice, hybridTurnPlan, supportsAiPreview } = require('./chatbot-config');
const { channelFor } = require('./chatbot-channels');
const { buildAiPrompt } = require('./chatbot-ai-prompt');
const businessContext = require('./chatbot-business-context');
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

async function finishTurn(turn, status, resultClass) {
  if (!turn?.id) return;
  await query(`UPDATE sx_chatbot_turns SET status=?,result_class=?,lease_until=UTC_TIMESTAMP(3) WHERE id=? AND status='processing'`, [status, resultClass, turn.id]);
}

async function handoffConversation(ctx, chatId, channelKind, channelRef, reason, profile = null, uid = null, options = {}) {
  const db = await dbPool.getConnection();
  try {
    await db.beginTransaction();
    if (options.onlyIfActive) {
      // Lock even the absent control row before claiming the handoff, so two
      // separate inbound messages cannot both send a staff acknowledgement.
      await db.query(`INSERT IGNORE INTO sx_chatbot_conversation_controls(id,tenant_id,channel_kind,channel_ref,conversation_id,mode,revision,updated_by_kind) VALUES (?,?,?,?,?,'inherit',1,'system')`, [crypto.randomUUID(),ctx.tenant.id,channelKind,channelRef,chatId]);
      const [[control]] = await db.query(`SELECT mode,(pause_until IS NULL OR pause_until>UTC_TIMESTAMP(3)) AS active FROM sx_chatbot_conversation_controls WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? FOR UPDATE`, [ctx.tenant.id,channelKind,channelRef,chatId]);
      if (control?.mode === 'paused' && control.active) { await db.commit(); return false; }
    }
    await db.query(`INSERT INTO sx_chatbot_conversation_controls(id,tenant_id,channel_kind,channel_ref,conversation_id,mode,pause_until,auto_pause_at,reason,revision,updated_by_kind,updated_by_identity_id)
      VALUES (?,?,?,?,?,'paused',NULL,NULL,?,1,'system',NULL)
      ON DUPLICATE KEY UPDATE mode='paused',pause_until=NULL,auto_pause_at=NULL,reason=VALUES(reason),revision=revision+1,updated_by_kind='system',updated_by_identity_id=NULL`,
    [crypto.randomUUID(), ctx.tenant.id, channelKind, channelRef, chatId, String(reason || 'human-review').slice(0, 240)]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,NULL,'system','chatbot.conversation-auto-handoff','chatbot-conversation',?,?,?)`,
    [crypto.randomUUID(), ctx.tenant.id, chatId, JSON.stringify({ mode: 'paused', reason: String(reason || 'human-review').slice(0, 240) }), crypto.randomUUID()]);
    if (profile && uid) await require('./chatbot-handoff-task').assignHandoffTask(db, { ctx, profile, uid, chatId, channelKind, channelRef, reason });
    if (profile?.config?.sharedInboxRouting === true && profile.config.handoffAssigneeIdentityId && uid) {
      await require('./team-conversation-assignment').assignConversation(db, { ctx, uid, chatId, identityId: profile.config.handoffAssigneeIdentityId, reason: 'bot-human-handover' });
    }
    await db.commit(); return true;
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
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

async function claimOpeningFlow({ctx,profile,chatId,channelKind,channelRef}) {
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
    if(claimed){state.openingFlowSent=true;state.greeted=false;await db.query(`UPDATE sx_chatbot_guided_sessions SET state=?,expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR) WHERE id=?`,[JSON.stringify(state),row.id]);}
    await db.commit();return claimed;
  } catch(error){await db.rollback().catch(()=>{});throw error;} finally{db.release();}
}

async function guidedTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo }) {
  if (profile.config?.guidedMode === 'domain_default') {
    const introId=profile.config?.introFlowId,channelKind=channelFor(origin);
    if(introId&&channelKind){
      await pruneExpiredGuidedSessions();
    }
    if(introId&&channelKind&&await claimOpeningFlow({ctx,profile,chatId,channelKind,channelRef:sessionId})){
      const intro=await loadGuidedFlow(uid,introId);if(!intro)return false;
      if(!await canSendNow({ctx,profile,uid,origin,sessionId,chatId,message}))return await shouldPause(uid,chatId,channelKind,sessionId)?{paused:true}:false;
      const {processFlow}=require('../../automation/automation'),flowSessionId=executionFlowId(profile);
      const result=await processFlow({nodes:intro.nodes,edges:intro.edges,uid,flowId:flowSessionId,message,incomingText:textOf(message),user,sessionId,origin,chatId,element:{...intro,flow_id:flowSessionId},beforeNode:guidedFlowNodeGuard({ctx,profile,uid,origin,sessionId,chatId,message}),awaitTransitions:true,loopDetection:{visitedNodes:new Map(),startTime:Date.now()}});
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
  const decision = await understandFlowTurn({ ctx, profile, uid, message, flow, flowSessionId, chatId, channelKind: channelFor(origin), channelRef: sessionId });
  if (decision.action === 'handoff') return { handedOff: true, silentHandoff: true, code: decision.reason || 'OUTSIDE_BOT_FLOW', stageId: decision.stageId };
  if (decision.text) message = { ...message, msgContext: { ...message.msgContext, text: { body: decision.text } } };
  const result=await processFlow({ nodes: flow.nodes, edges: flow.edges, uid, flowId: flowSessionId, message, incomingText: textOf(message), user, sessionId, origin, chatId, element: { ...flow, flow_id: flowSessionId }, beforeNode: guidedFlowNodeGuard({ctx,profile,uid,origin,sessionId,chatId,message}), awaitTransitions: true, loopDetection: { visitedNodes: new Map(), startTime: Date.now() } });
  return result==='paused'?{paused:true}:result!==false;
}

async function handoffSilently({ ctx, profile, uid, sessionId, origin, chatId, code }) {
  const channelKind = channelFor(origin), lockDb = await dbPool.getConnection();
  const lock = 'bot-handoff:' + crypto.createHash('sha256').update(JSON.stringify([ctx.tenant.id, channelKind, sessionId, chatId])).digest('hex').slice(0, 48);
  let held = false;
  try {
    const [[row]] = await lockDb.query('SELECT GET_LOCK(?,5) AS acquired', [lock]);
    held = Number(row.acquired) === 1;
    if (!held || await shouldPause(uid, chatId, channelKind, sessionId)) return;
    await handoffConversation(ctx, chatId, channelKind, sessionId, code, profile, uid, { onlyIfActive:true });
  } finally {
    if (held) await lockDb.query('SELECT RELEASE_LOCK(?)', [lock]).catch(() => {});
    lockDb.release();
  }
}

async function understandFlowTurn({ ctx, profile, uid, message, flow, flowSessionId, chatId, channelKind, channelRef }) {
  const understanding = require('./chatbot-flow-understanding');
  const [session] = await query('SELECT data FROM flow_session WHERE uid=? AND flow_id=? AND sender_mobile=? LIMIT 1', [uid, flowSessionId, message.senderMobile]);
  let state = null; try { state = typeof session?.data === 'string' ? JSON.parse(session.data) : session?.data; } catch {}
  const turn = understanding.expectedTurn(flow, state);
  const local = understanding.deterministicDecision(textOf(message), turn);
  if (local.action !== 'interpret') return local;
  if (profile.engine !== 'hybrid' || profile.config.aiFallback === false || profile.config.aiDataProcessingConfirmed !== true) return { ...local, action: 'handoff' };
  const [settings] = await query('SELECT provider,model,key_ciphertext,key_iv,key_auth_tag,daily_token_limit FROM sx_chatbot_provider_configs WHERE tenant_id=?', [ctx.tenant.id]);
  if (!settings) return { action: 'handoff', reason: 'AI_PROVIDER_NOT_CONFIGURED', stageId: turn.stageId };
  const conversation = await loadDomainGuidedSession({ ctx, profile, chatId, channelKind, channelRef });
  const history = (conversation?.recentConversation || []).slice(-4).map(item => ({ role: item.role, text: businessContext.redactCustomerText(item.text) }));
  const prompt = understanding.interpretationPrompt(businessContext.redactCustomerText(textOf(message)), turn, history);
  const reservation = await reserveTokens(ctx, settings, tokenEstimate(prompt.system + prompt.user));
  if (!reservation) return { action: 'handoff', reason: 'DAILY_TOKEN_LIMIT' };
  let used = null;
  try {
    const result = await provider.generate({ provider: settings.provider, model: settings.model, apiKey: secrets.decrypt(settings), ...prompt, requireSources: true, maxOutputTokens: 180 });
    used = (result.inputTokens || 0) + (result.outputTokens || 0) || null;
    const decision = understanding.validateInterpretation(result, turn, Math.max(0.82, Number(profile.config.confidenceThreshold || 0.82)));
    await saveConversationalState({ ctx, profile, chatId, channelKind, channelRef, state: { ...(conversation || {}), recentConversation: [...history, { role: 'user', text: businessContext.redactCustomerText(textOf(message)) }].slice(-4), flowUnderstanding: { ...decision, at: new Date().toISOString() } } });
    return decision;
  } catch (error) {
    used = Number.isSafeInteger(error.tokensUsed) ? error.tokensUsed : Number.isInteger(error.status) ? 0 : null;
    return { action: 'handoff', reason: error.code || 'AI_PROVIDER_REQUEST_FAILED', stageId: turn.stageId };
  } finally { await settleTokens(ctx, reservation, used); }
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

async function trainingCenterGuidedTurn({ ctx, profile, uid, message, sessionId, origin, chatId, intent = null, leadInfo }) {
  const channelKind = channelFor(origin);
  const pack = getDomainPack(ctx.category.key, ctx.category.version);
  if (!channelKind || !pack.guidedReply) return false;
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
  // An attachment or location is not a reply to a guided text prompt. Passing
  // an empty string to guidedReply made it repeat the same question for every
  // such inbound event. The caller treats false as a handoff and pauses this
  // conversation; CV submissions and their validation errors remain supported.
  if (!textOf(message) && !cvSubmission && !cvError) return false;
  const db = await dbPool.getConnection();
  let reply = null;
  let deferLeadQuestion = false;
  try {
    const facts = leadInfo?.facts || (pack.requiresDatabase
      ? await pack.loadFacts({ db, tenantId: ctx.tenant.id, platformOrigin: process.env.SALEMAX_PLATFORM_ORIGIN, config: profile.config })
      : []);
    const knowledgeEntries = mergeKnowledgeEntries(profile.config?.knowledgeEntries || [], await loadApprovedFaqs(ctx.tenant.id));
    await db.beginTransaction();
    await db.query(`INSERT IGNORE INTO sx_chatbot_guided_sessions(id,tenant_id,profile_id,channel_kind,channel_ref,conversation_id,conversation_hash,state,expires_at)
      VALUES (?,?,?,?,?,?,?,JSON_OBJECT(),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR))`,
    [crypto.randomUUID(), ctx.tenant.id, profile.id, channelKind, sessionId, chatId, guidedConversationHash(chatId)]);
    const [[row]] = await db.query(`SELECT id,state,expires_at AS expiresAt FROM sx_chatbot_guided_sessions
      WHERE tenant_id=? AND profile_id=? AND channel_kind=? AND channel_ref=? AND conversation_hash=? AND conversation_id=?
      FOR UPDATE`, [ctx.tenant.id, profile.id, channelKind, sessionId, guidedConversationHash(chatId), chatId]);
    let priorState = null;
    if (row && new Date(row.expiresAt).getTime() <= Date.now()) priorState = null;
    else if (row) { try { priorState = typeof row.state === 'string' ? JSON.parse(row.state) : row.state; } catch { priorState = null; } }
    if(priorState&&typeof message.senderMobile==='string')priorState.whatsappNumber=message.senderMobile;
    if (profile.engine !== 'guided' && priorState) priorState.language = businessContext.languageFor(intent || textOf(message), priorState);
    deferLeadQuestion = !priorState?.greeted;
    if(cvSubmission){
      const success= cvSubmission.repeated
        ? (priorState?.language==='ar'?'تم تسجيل طلبك مسبقاً. سيرتك الذاتية محفوظة، وسيتواصل معك المؤسس قريباً.':'Your application is already recorded. Your CV is saved, and the Founder will contact you soon.')
        : (priorState?.language==='ar'?`شكراً! تم تقديم طلبك وحفظ سيرتك الذاتية في قسم الطلبات الخاص. رقم الطلب ${cvSubmission.referenceCode}. سيتواصل معك المؤسس قريباً.`:`Thank you! Your application is submitted and your CV is saved in our private Applications & CVs area. Reference: ${cvSubmission.referenceCode}. The Founder will contact you soon.`);
      reply={reply:success,state:{...priorState,step:'application_submitted',applicationReferenceCode:cvSubmission.referenceCode},buttons:[],handoff:true,handoffReason:'recruitment-complete'};
    }else if(cvError){
      const invalid=cvError==='CV_TYPE_NOT_ALLOWED'||cvError==='INVALID_CV_FILE';
      reply={reply:priorState?.language==='ar'?(invalid?'يرجى إرسال السيرة الذاتية كملف PDF أو DOCX حتى 8 ميغابايت.':'تعذر حفظ الملف الآن. يرجى المحاولة مرة أخرى بعد قليل.'):(invalid?'Please send your CV as a PDF or DOCX file up to 8 MB.':'I couldn’t save that file just now. Please try sending it again shortly.'),state:priorState,buttons:[]};
    }else reply = pack.guidedReply({ message: intent || textOf(message), state: priorState, facts, config: { ...(profile.config?.guidedContent || {}), knowledgeEntries } });
    if (leadInfo?.nameOnly) reply = { reply: profile.config?.guidedContent?.messages?.nameCollectedMessage?.[leadInfo.language] || pack.guidedContentDefaults.messages.nameCollectedMessage[leadInfo.language], state: priorState || {} };
    if (!reply || typeof reply.reply !== 'string' || !reply.reply.trim()) {
      await db.rollback();
      return false;
    }
    reply = businessContext.polishGuidedReply({ result: reply, profile, message: textOf(message), state: priorState, defaults: pack.guidedContentDefaults });
    const questionLeadInfo = deferLeadQuestion ? { ...leadInfo, questionKey: null } : leadInfo;
    if (!reply.handoff) reply.reply = require('./chatbot-lead-capture').addQuestion(reply.reply, questionLeadInfo, profile.config, pack.guidedContentDefaults);
    reply.state.sentCoursePdfIds = priorState?.sentCoursePdfIds || [];
    const pdfs = require('./chatbot-course-media').coursePdfs(facts, reply.state.selectedCourseCode, textOf(message), reply.state.sentCoursePdfIds);
    reply.media = [...(reply.media || []).filter(item => item.kind !== 'document'), ...pdfs];
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
    await db.commit();
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }

  if (!await canSendNow({ ctx, profile, uid, origin, sessionId, chatId, message })) return false;
  const { sendWaMessage } = require('../../automation/functions');
  const interactiveButtons=channelKind==='whatsapp_meta'&&Array.isArray(reply.buttons)?reply.buttons.filter(item=>item&&typeof item.id==='string'&&typeof item.title==='string'&&item.id.length<=256&&item.title.length<=20).slice(0,3):[];
  const messageContext=interactiveButtons.length?{type:'interactive',interactive:{type:'button',body:{text:reply.reply.slice(0,1024)},action:{buttons:interactiveButtons.map(item=>({type:'reply',reply:{id:item.id,title:item.title}}))}}}:{type:'text',text:{preview_url:false,body:reply.reply}};
  const sentId = await sendWaMessage({ origin, sessionId, message, uid, chatId, content: messageContext });
  if (!sentId) return false;
  if (reply.handoff) await handoffConversation(ctx, chatId, channelKind, sessionId, reply.handoffReason||'customer-requested-human', profile, uid);
  const timestamp = Math.trunc(Date.now() / 1000);
  const messageData = { type: messageContext.type, metaChatId: sentId, msgContext: messageContext, reaction: '', timestamp, senderName: message.senderName, senderMobile: message.senderMobile, star: 0, route: 'OUTGOING', context: null, origin, sentBy: 'bot' };
  await require('./chatbot-conversation-store').persistConversationMessage({ uid, chatId, data: { ...messageData, msgContext: JSON.stringify(messageData.msgContext), context: null } });
  await query(`UPDATE beta_chats SET last_message=? WHERE uid=? AND chat_id=?`, [JSON.stringify(messageData), uid, chatId]);
  if (!reply.handoff && !deferLeadQuestion) await require('./chatbot-lead-capture').markAsked(dbPool, leadInfo, uid);
  if (!reply.handoff && reply.media?.length) {
    try {
      await sendTurnCourseMedia({ ctx, profile, uid, chatId, sessionId, message, origin, media: reply.media, state: reply.state });
    } catch (error) { console.warn('[chatbot] course attachment unavailable', error.code || 'COURSE_MEDIA_ERROR'); }
  }
  return true;
}

function tokenEstimate(text) { return Math.min(12000, Math.max(256, Math.ceil(Buffer.byteLength(text, 'utf8') / 1.5) + 700)); }
async function reserveTokens(ctx, providerConfig, amount) {
  const qatarDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const db = await dbPool.getConnection();
  try {
    await db.beginTransaction();
    await db.query(`INSERT IGNORE INTO sx_chatbot_usage_daily(tenant_id,usage_date) VALUES (?,?)`, [ctx.tenant.id, qatarDate]);
    const [[row]] = await db.query(`SELECT consumed_tokens AS consumed,reserved_tokens AS reserved FROM sx_chatbot_usage_daily WHERE tenant_id=? AND usage_date=? FOR UPDATE`, [ctx.tenant.id, qatarDate]);
    if (Number(row.consumed) + Number(row.reserved) + amount > Number(providerConfig.daily_token_limit)) { await db.rollback(); return null; }
    await db.query(`UPDATE sx_chatbot_usage_daily SET reserved_tokens=reserved_tokens+? WHERE tenant_id=? AND usage_date=?`, [amount, ctx.tenant.id, qatarDate]);
    await db.commit(); return { qatarDate, amount };
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}
async function settleTokens(ctx, reservation, used) {
  if (!reservation) return;
  const actual = Number.isSafeInteger(used) && used >= 0 ? Math.min(used, 12000) : reservation.amount;
  await query(`UPDATE sx_chatbot_usage_daily SET reserved_tokens=GREATEST(0,reserved_tokens-?),consumed_tokens=consumed_tokens+? WHERE tenant_id=? AND usage_date=?`, [reservation.amount, actual, ctx.tenant.id, reservation.qatarDate]);
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
    && recipientAllowed(current.config, message?.senderMobile)
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

async function generateAiAnswer({ ctx, profile, uid, customerMessage, chatId = null, channelKind = null, channelRef = null, state = null, factsOverride = null }) {
  const [settings] = await query(`SELECT provider,model,key_ciphertext,key_iv,key_auth_tag,daily_token_limit FROM sx_chatbot_provider_configs WHERE tenant_id=?`, [ctx.tenant.id]);
  if (uid && chatId && await shouldPause(uid, chatId, channelKind, channelRef)) return { paused: true };
  if (!customerMessage) return { handedOff: true, code: 'UNSUPPORTED_MESSAGE_TYPE' };
  const pack = getDomainPack(ctx.category.key, ctx.category.version);
  const loadFacts = async () => {
    if (!pack.requiresDatabase) return [];
    const db = await dbPool.getConnection();
    try { return await pack.loadFacts({ db, tenantId: ctx.tenant.id, platformOrigin: process.env.SALEMAX_PLATFORM_ORIGIN, config: profile.config }); }
    finally { db.release(); }
  };
  const facts = factsOverride || await loadFacts();
  const session = state || (chatId ? await loadDomainGuidedSession({ ctx, profile, chatId, channelKind, channelRef }) : null) || {};
  const knowledgeEntries = mergeKnowledgeEntries(profile.config?.knowledgeEntries || [], await loadApprovedFaqs(ctx.tenant.id));
  const context = businessContext.retrieveContext({ facts, knowledgeEntries, message: customerMessage, state: session, profileRevision: profile.revision });
  const nextState = { ...session, language: context.language, selectedCourseCode: (context.explicitCourses ? context.selectedCourseCode : null) || session.selectedCourseCode };
  const courseOverview = profile.engine === 'hybrid' && profile.config?.aiFallback !== false && businessContext.isCourseOverviewRequest(customerMessage, context);
  const factualOverviewFallback = sourceContext => {
    const simple = businessContext.simpleFactualReply(customerMessage, sourceContext, profile.config);
    return simple ? { canAnswer: true, confidence: 1, reply: simple.reply, state: nextState, route: 'facts', metrics: { inputTokens: 0, outputTokens: 0, cacheHit: false, sources: sourceContext.sources } } : null;
  };
  if (profile.engine === 'hybrid') {
    const faq = require('./chatbot-faq').findApprovedFaq(customerMessage, knowledgeEntries, context.language, { hasCourse: context.evidence.some(item => item.kind === 'course') });
    if (faq) return { canAnswer: true, confidence: 1, reply: faq.answer, state: nextState, route: 'approved_faq', metrics: { inputTokens: 0, outputTokens: 0, cacheHit: false, sources: context.sources } };
    const simple = businessContext.simpleFactualReply(customerMessage, context, profile.config);
    if (simple && !courseOverview) return { canAnswer: true, confidence: 1, reply: simple.reply, state: simple.nextStep ? { ...nextState, step: simple.nextStep } : nextState, route: 'facts', metrics: { inputTokens: 0, outputTokens: 0, cacheHit: false, sources: context.sources } };
    if (courseOverview && !settings) return factualOverviewFallback(context) || { handedOff: true, code: 'AI_PROVIDER_NOT_CONFIGURED' };
  }
  if (!settings) return { handedOff: true, code: 'AI_PROVIDER_NOT_CONFIGURED' };
  const historySafe = Array.isArray(session.recentConversation) ? session.recentConversation.slice(-4).map(item => ({ role: item.role, text: businessContext.redactCustomerText(item.text) })) : [];
  const key = businessContext.fingerprint({ tenant: ctx.tenant.id, profile: profile.id, revision: context.revision, model: settings.model, provider: settings.provider, question: businessContext.normalized(customerMessage), language: context.language, history: historySafe, selected: session.selectedCourseCode });
  const cached = replyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.answer, state: nextState, metrics: { ...cached.answer.metrics, cacheHit: true, inputTokens: 0, outputTokens: 0 } };
  const sourceAliases = new Map();
  const aiEvidence = courseOverview
    ? context.evidence.filter(item => item.kind === 'course').map(item => ({
      kind: item.kind, code: item.code, name: item.name,
      description: String(item.description || '').slice(0, 520),
      outcomes: String(item.outcomes || '').slice(0, 180),
      duration: item.duration || null, delivery: item.delivery || null, offer: item.offer || null,
      sourceId: item.sourceId,
    }))
    : context.evidence;
  const compactEvidence = aiEvidence.map((item, index) => { const alias = 's' + index; sourceAliases.set(alias, item.sourceId); return { ...item, sourceId: alias }; });
  const { system, user: input, inputBytes } = buildAiPrompt({ pack, profile, customerMessage: businessContext.redactCustomerText(customerMessage), facts: compactEvidence, history: historySafe, courseOverview });
  if (inputBytes > 12000) return factualOverviewFallback(context) || { canAnswer: true, reply: businessContext.clarification(profile.config, context.language), confidence: 0, state: nextState, route: 'clarification' };
  const prompt = `${system}\n\n${input}`;
  const estimate = tokenEstimate(prompt);
  const reservation = await reserveTokens(ctx, settings, estimate);
  if (!reservation) return factualOverviewFallback(context) || { handedOff: true, code: 'DAILY_TOKEN_LIMIT' };
  const providerStarted = Date.now();
  let response;
  let succeeded = false;
  let failedUsage = null;
  try {
    const apiKey = secrets.decrypt(settings);
    response = await provider.generate({ provider: settings.provider, model: settings.model, apiKey, system, user: input, requireSources: true, maxOutputTokens: courseOverview ? 90 : 250 });
    if (Array.isArray(response.sourceIds)) response.sourceIds = response.sourceIds.map(id => sourceAliases.get(id) || 'invalid:' + id);
    if (courseOverview && typeof response.reply === 'string') response.reply = response.reply.replace(/\s*\[s\d+\]/gi, '').trim();
    succeeded = true;
  } catch (error) {
    if (Number.isSafeInteger(error.tokensUsed)) failedUsage = error.tokensUsed;
    else if (Number.isInteger(error.status)) failedUsage = 0;
    if (courseOverview) return factualOverviewFallback(context) || { handedOff: true, code: error.code || 'AI_PROVIDER_ERROR' };
    throw error;
  } finally {
    await settleTokens(ctx, reservation, succeeded ? ((response?.inputTokens || 0) + (response?.outputTokens || 0) || null) : failedUsage);
  }
  const metrics = { inputTokens: response.inputTokens || 0, outputTokens: response.outputTokens || 0, cacheHit: false, latencyMs: Date.now() - providerStarted, sources: context.sources, provider: settings.provider, model: settings.model };
  const validation = businessContext.validateAnswer(response, context);
  const threshold = Number(profile.config?.confidenceThreshold ?? 0.72);
  if (!validation.valid || response.confidence < threshold) {
    if (courseOverview) return factualOverviewFallback(context) || { canAnswer: true, reply: businessContext.clarification(profile.config, context.language), confidence: 0, state: nextState, route: 'clarification', reason: validation.code || 'LOW_CONFIDENCE', metrics };
    const language = context.language;
    return { canAnswer: true, confidence: 0, reply: businessContext.unavailableReply(customerMessage, profile.config, language), state: nextState, route: 'clarification', reason: validation.code || 'LOW_CONFIDENCE', metrics };
  }
  // Re-read live facts after the model call; never deliver a price or date
  // generated from data that changed while the provider was working.
  const fresh = businessContext.retrieveContext({ facts: await loadFacts(), knowledgeEntries: mergeKnowledgeEntries(profile.config?.knowledgeEntries || [], await loadApprovedFaqs(ctx.tenant.id)), message: customerMessage, state: session, profileRevision: profile.revision });
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

async function aiTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo }) {
  if (profile.engine === 'hybrid' && !profile.config?.flowId && profile.config?.guidedMode !== 'domain_default') return { handedOff: true, code: 'GUIDED_FLOW_REQUIRED' };
  if (profile.config.guidedMode === 'domain_default' || (profile.engine === 'ai' && ctx.category.key === 'training_center')) {
    const channelKind = channelFor(origin);
    const session = await loadDomainGuidedSession({ ctx, profile, chatId, channelKind, channelRef: sessionId });
    const incoming = textOf(message);
    const route = businessContext.controlRoute(incoming, profile.config, session || {});
    const applicationAccepted = session?.step === 'course_detail' && /^(?:yes(?:[,.! ]+(?:please(?:\s+(?:send it|send me|share it))?|send it|send me|share it))?|sure|please do|send it|send me|share it|i'm interested|im interested|اي|نعم|نعم من فضلك|أرسلها|ارسلها|أرسل النموذج|ارسل النموذج)$/iu.test(incoming.trim());
    if (route !== 'answer' || leadInfo?.nameOnly || applicationAccepted || (profile.engine === 'hybrid' && profile.config.aiFallback === false)) {
      const dispatched = await trainingCenterGuidedTurn({ ctx, profile, uid, message, sessionId, origin, chatId, leadInfo, intent: route === 'human' ? (businessContext.languageFor(incoming, session || {}) === 'ar' ? 'موظف' : 'agent') : null });
      return dispatched ? { flowDispatched: true, route } : { handedOff: true, code: 'GUIDED_FLOW_UNAVAILABLE' };
    }
  } else if (profile.engine === 'hybrid' && profile.config.flowId) {
    const dispatched = await guidedTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo });
    return dispatched?.handedOff ? dispatched : dispatched?.paused ? { paused: true } : dispatched ? { flowDispatched: true } : { handedOff: true, code: 'GUIDED_FLOW_UNAVAILABLE' };
  }

  const answer = await generateAiAnswer({ ctx, profile, uid, customerMessage: textOf(message), chatId, channelKind: channelFor(origin), channelRef: sessionId, factsOverride: leadInfo?.facts });
  if (answer.handedOff || answer.paused) return answer;
  const pack = getDomainPack(ctx.category.key, ctx.category.version);
  const onboarding = ctx.tenant.categoryKey === 'training_center' && !answer.state?.greeted;
  const questionLeadInfo = onboarding ? { ...leadInfo, questionKey: null } : leadInfo;
  if (onboarding && pack.guidedContentDefaults?.messages) {
    const language = businessContext.languageFor(textOf(message), answer.state || {});
    const messages = profile.config?.guidedContent?.messages || {};
    const greeting = messages.greeting?.[language] || pack.guidedContentDefaults.messages.greeting[language];
    const menu = require('./chatbot-training-guide').menuText(leadInfo?.facts || [], profile.config?.guidedContent || {}, language, { includeGreeting: false });
    answer.reply = `${greeting}\n\n${answer.reply}\n\n${menu}`;
    answer.state = { ...(answer.state || {}), greeted: true };
  }
  answer.reply = require('./chatbot-lead-capture').addQuestion(answer.reply, questionLeadInfo, profile.config, pack.guidedContentDefaults);
  if (!await canSendNow({ ctx, profile, uid, origin, sessionId, chatId, message })) return { paused: true };
  const { sendWaMessage } = require('../../automation/functions');
  const sentId = await sendWaMessage({ origin, sessionId, message, uid, chatId, content: { type: 'text', text: { preview_url: false, body: answer.reply } } });
  if (!sentId) return { handedOff: true, code: 'CHANNEL_SEND_FAILED' };
  const timestamp = Math.trunc(Date.now() / 1000);
  const messageData = { type: 'text', metaChatId: sentId, msgContext: { type: 'text', text: { preview_url: false, body: answer.reply } }, reaction: '', timestamp, senderName: message.senderName, senderMobile: message.senderMobile, star: 0, route: 'OUTGOING', context: null, origin, sentBy: 'bot' };
  await query(`INSERT INTO beta_conversation SET ?`, { ...messageData, msgContext: JSON.stringify(messageData.msgContext), context: null, uid, chat_id: chatId });
  await query(`UPDATE beta_chats SET last_message=? WHERE uid=? AND chat_id=?`, [JSON.stringify(messageData), uid, chatId]);
  if (answer.state) await saveConversationalState({ ctx, profile, chatId, channelKind: channelFor(origin), channelRef: sessionId, state: { ...answer.state, recentConversation: [...(answer.state.recentConversation || []), { role: 'user', text: textOf(message).slice(0, 400) }, { role: 'assistant', text: answer.reply.slice(0, 500) }].slice(-4) } });
  if (!onboarding) await require('./chatbot-lead-capture').markAsked(dbPool, leadInfo, uid);
  const media = require('./chatbot-course-media').coursePdfs(leadInfo?.facts || [], answer.state?.selectedCourseCode, textOf(message), answer.state?.sentCoursePdfIds || []);
  if (media.length) await sendTurnCourseMedia({ ctx, profile, uid, chatId, sessionId, message, origin, media, state: answer.state }).catch(error => console.warn('[chatbot] course attachment unavailable', error.code || 'COURSE_MEDIA_ERROR'));
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
  if(current?.id!==profile.id||Number(current.revision)!==Number(profile.revision)||!recipientAllowed(current.config,message.senderMobile)||!latest||!module.mayFinish(latest.control))return {paused:true};
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
  if (!uid || !chatId || message?.route !== 'INCOMING') return { handled: false };
  const access=await currentOwnerAccess(uid),ctx=access.context;
  if(!ctx){
    const blocked=await require('./chatbot-runtime-access').blocksFallback(dbPool,access,channelFor(origin),sessionId);
    return blocked?{handled:true,paused:true,code:access.code||'BUSINESS_ACCESS_INACTIVE'}:{handled:false};
  }
  const channelKind = channelFor(origin);
  if (await require('./chatbot-no-reply-timeout').inbound(dbPool, { tenantId: ctx.tenant.id, channelKind, channelRef: sessionId, conversationId: chatId, inboundMessageId: typeof message?.metaChatId === 'string' ? message.metaChatId : null })) {
    return { handled: true, paused: true, code: 'NO_REPLY_TIMEOUT' };
  }
  const profile = await profileFor(ctx, uid, origin, sessionId);
  if (!profile) return { handled: false };
  // A restricted chat is handled silently so it cannot fall through to legacy bots.
  if (!recipientAllowed(profile.config, message?.senderMobile)) return { handled: true, paused: true, code: 'RECIPIENT_NOT_ENABLED' };
  let leadInfo = null;
  if (ctx.tenant.categoryKey === 'training_center') {
    try {
      const db = await dbPool.getConnection();
      let facts;
      try { facts = await getDomainPack(ctx.category.key, ctx.category.version).loadFacts({ db, tenantId: ctx.tenant.id, platformOrigin: process.env.SALEMAX_PLATFORM_ORIGIN, config: profile.config }); }
      finally { db.release(); }
      leadInfo = await require('./chatbot-lead-capture').captureLead(dbPool, { ctx, profile, uid, chatId, origin, message, facts });
    } catch (error) {
      await handoffConversation(ctx, chatId, channelFor(origin), sessionId, 'lead-capture-unavailable', profile, uid).catch(() => {});
      return { handled: true, handedOff: true, code: 'LEAD_CAPTURE_UNAVAILABLE' };
    }
  } else if (ctx.category.chatbotLeadCapture === 'generic' && profile.config?.captureLeads === true) {
    if (require('./chatbot-lead-capture').genericCaptureEnabled(ctx)) {
      try {
        leadInfo = await require('./chatbot-lead-capture').captureGenericLead(dbPool, { ctx, profile, uid, chatId, origin, message });
      } catch (error) {
        await handoffConversation(ctx, chatId, channelFor(origin), sessionId, 'lead-capture-unavailable', profile, uid).catch(() => {});
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
  const testReset = require('./chatbot-test-reset').isTestReset(profile.config, message?.senderMobile, textOf(message));
  const completionModule=require('./recruitment-chat-completion');
  const completion=!testReset&&ctx.category.key==='7network_sales'
    ? await completionModule.load(dbPool,{tenantId:ctx.tenant.id,channelKind,channelRef:sessionId,conversationId:chatId}):null;
  const completionAction=completionModule.actionFor(completion,message,textOf(message));
  if(completionAction==='silent'){
    if(!completion.control||completion.control.mode!=='paused')await handoffConversation(ctx,chatId,channelKind,sessionId,completion.application.cvFileName?'recruitment-complete':'recruitment-awaiting-cv',profile,uid);
    return {handled:true,paused:true,code:'RECRUITMENT_QUESTIONS_FINISHED'};
  }
  if (!testReset && !completionAction && await shouldPause(uid, chatId, channelKind, sessionId)) return { handled: true, paused: true };
  const turn = await claimTurn(ctx, profile, message, chatId);
  if (!turn) {
    await handoffConversation(ctx, chatId, channelKind, sessionId, 'inbound-message-id-unavailable', profile, uid);
    return { handled: true, handedOff: true, code: 'INBOUND_MESSAGE_ID_UNAVAILABLE' };
  }
  if (turn.duplicate) return { handled: true, duplicate: true };
  try {
    if (testReset) {
      const db = await dbPool.getConnection();
      try { await require('./chatbot-test-reset').resetTestConversation(db, { ctx, profile, uid, chatId, origin, sender: message.senderMobile, turnId: turn.id }); }
      finally { db.release(); }
      message = { ...message, msgContext: { text: { body: 'Hi' } } };
    }
    let result;
    if (completionAction) result = await finishRecruitmentChat({ctx,profile,uid,message,sessionId,origin,chatId,completion,action:completionAction});
    else {
      const turnLock = await require('./chatbot-turn-lock').runWithTurnLock({ pool: dbPool, uid, origin, channelRef: sessionId, chatId }, async () => {
        if (profile.engine === 'guided') {
          const guided = await guidedTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo });
          return guided?.handedOff ? guided : guided?.paused ? { paused: true } : guided ? { sent: true } : { handedOff: true, code: !textOf(message) ? 'UNSUPPORTED_MESSAGE_TYPE' : 'GUIDED_FLOW_UNAVAILABLE' };
        }
        return aiTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo });
      }, { onOverflow: async () => {
        if (!await shouldPause(uid, chatId, channelKind, sessionId)) {
          await handoffConversation(ctx, chatId, channelKind, sessionId, 'concurrent-message-burst', profile, uid);
        }
      }
      });
      if (!turnLock.acquired) {
        await finishTurn(turn, 'sent', 'conversation-turn-already-running');
        return { handled: true, duplicate: true, code: 'CONVERSATION_TURN_ALREADY_RUNNING' };
      }
      result = turnLock.value;
    }
    if (result?.metrics) await query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,NULL,'system','chatbot.turn-measured','chatbot-turn',?,?,?)`, [crypto.randomUUID(), ctx.tenant.id, turn.id, JSON.stringify({ route: result.route, reason: result.reason || null, ...result.metrics }), crypto.randomUUID()]);
    if (result?.sent || result?.flowDispatched) {
      await require('./chatbot-no-reply-timeout').arm(dbPool, { tenantId: ctx.tenant.id, channelKind, channelRef: sessionId, conversationId: chatId })
        .catch(error => console.warn('[chatbot] could not schedule no-reply pause', error.code || 'NO_REPLY_TIMEOUT_SCHEDULE_FAILED'));
      await finishTurn(turn, 'sent', result?.flowDispatched ? 'guided-flow-dispatched' : 'reply-sent');
    }
    else if (result?.paused) await finishTurn(turn, 'handed_off', 'human-paused');
    else {
      await handoffSilently({ ctx, profile, uid, sessionId, origin, chatId, code: result?.code || 'human-review' });
      await finishTurn(turn, 'handed_off', result?.code || 'human-review');
    }
    return { handled: true, ...result };
  } catch (error) {
    if (error.code === 'TEST_RESET_BUSY') {
      await finishTurn(turn, 'failed', 'test-reset-busy');
      return { handled: true, code: error.code };
    }
    const failure = ['AI_PROVIDER_NOT_CONFIGURED','AI_PROVIDER_TIMEOUT','AI_PROVIDER_REQUEST_FAILED','AI_PROVIDER_INVALID_OUTPUT'].includes(error.code) ? error.code : 'runtime-error';
    await handoffConversation(ctx, chatId, channelKind, sessionId, failure, profile, uid).catch(() => {});
    await finishTurn(turn, 'handed_off', failure).catch(() => {});
    return { handled: true, handedOff: true, code: error.code || 'BOT_RUNTIME_ERROR' };
  }
}

module.exports = { canSendNow, runConfiguredBot, previewConfiguredBot, resolveTenant, handoffConversation, loadGuidedFlow, parseGuidedFlow, executionFlowId };
