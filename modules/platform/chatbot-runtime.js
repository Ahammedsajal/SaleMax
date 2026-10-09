'use strict';
const crypto = require('node:crypto');
const dbPool = require('../../database/config').promise();
const { query } = require('../../database/dbpromise');
const { getCategory, supportsBusinessCapability } = require('./categories');
const { decision } = require('./policy');
const secrets = require('./chatbot-secrets');
const provider = require('./chatbot-provider');
const { shouldPause } = require('./chatbot-conversation-control');
const { parseGuidedFlow, executionFlowId, inboundMessageKey } = require('./chatbot-profile-utils');
const { getDomainPack } = require('./chatbot-domain-packs');
const { isGuidedChoice, hybridTurnPlan, supportsAiPreview } = require('./chatbot-config');
const { channelFor } = require('./chatbot-channels');
const { buildAiPrompt } = require('./chatbot-ai-prompt');
const { recipientAllowed } = require('./chatbot-audience');
let nextGuidedSessionPruneAt = 0;
let guidedSessionPrunePromise = null;

const fail = code => { throw Object.assign(new Error(code), { code }); };
const textOf = message => {
  const body = message?.msgContext?.text?.body ?? message?.msgContext?.button?.text ?? message?.msgContext?.interactive?.button_reply?.title ?? message?.msgContext?.interactive?.list_reply?.title;
  return typeof body === 'string' ? body.trim().slice(0, 2000) : '';
};

async function resolveTenant(uid) {
  const uidHash = crypto.createHash('sha256').update(uid).digest('hex');
  const rows = await query(`SELECT t.id AS tenantId,t.category_key AS categoryKey,t.category_version AS categoryVersion,t.status AS tenantStatus,
      m.id AS membershipId,m.identity_id AS identityId,m.role,m.status AS membershipStatus,m.delegated_permissions AS delegatedPermissions,
      i.status AS identityStatus,a.status AS planStatus,pv.capabilities
    FROM sx_legacy_ownership o JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED)
    JOIN sx_tenants t ON t.id=o.tenant_id JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=t.id
    JOIN sx_identities i ON i.id=m.identity_id
    LEFT JOIN sx_plan_assignments a ON a.tenant_id=t.id AND a.status IN ('active','trial','grace')
    LEFT JOIN sx_plan_versions pv ON pv.id=a.plan_version_id
    WHERE o.source_table='user' AND u.uid=? AND o.legacy_uid_hash=? AND u.role='user' LIMIT 2`, [uid, uidHash]);
  if (rows.length !== 1) return null;
  const row = rows[0], category = getCategory(row.categoryKey, Number(row.categoryVersion));
  if (!supportsBusinessCapability(category, 'automation.chatbot')) return null;
  let capabilities = [];
  try { capabilities = typeof row.capabilities === 'string' ? JSON.parse(row.capabilities) : row.capabilities || []; } catch { return null; }
  let delegatedPermissions = [];
  try { delegatedPermissions = typeof row.delegatedPermissions === 'string' ? JSON.parse(row.delegatedPermissions) : row.delegatedPermissions || []; } catch { delegatedPermissions = []; }
  const context = {
    audience: 'tenant', identity: { id: row.identityId, status: row.identityStatus },
    tenant: { id: row.tenantId, status: row.tenantStatus, categoryKey: row.categoryKey, categoryVersion: Number(row.categoryVersion) },
    membership: { id: row.membershipId, tenantId: row.tenantId, role: row.role, status: row.membershipStatus, delegatedPermissions },
    category, subscription: { status: row.planStatus, capabilities }, runtimeReady: {}
  };
  const gate = decision(context, { capability: 'automation.chatbot', permission: 'automation.manage' });
  return gate.allowed ? context : null;
}

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

async function handoffConversation(ctx, chatId, channelKind, channelRef, reason, profile = null, uid = null) {
  const db = await dbPool.getConnection();
  try {
    await db.beginTransaction();
    await db.query(`INSERT INTO sx_chatbot_conversation_controls(id,tenant_id,channel_kind,channel_ref,conversation_id,mode,pause_until,reason,revision,updated_by_kind,updated_by_identity_id)
      VALUES (?,?,?,?,?,'paused',NULL,?,1,'system',NULL)
      ON DUPLICATE KEY UPDATE mode='paused',pause_until=NULL,reason=VALUES(reason),revision=revision+1,updated_by_kind='system',updated_by_identity_id=NULL`,
    [crypto.randomUUID(), ctx.tenant.id, channelKind, channelRef, chatId, String(reason || 'human-review').slice(0, 240)]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,NULL,'system','chatbot.conversation-auto-handoff','chatbot-conversation',?,?,?)`,
    [crypto.randomUUID(), ctx.tenant.id, chatId, JSON.stringify({ mode: 'paused', reason: String(reason || 'human-review').slice(0, 240) }), crypto.randomUUID()]);
    if (profile && uid) await require('./chatbot-handoff-task').assignHandoffTask(db, { ctx, profile, uid, chatId, channelKind, channelRef, reason });
    await db.commit();
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

async function guidedTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId }) {
  if (profile.config?.guidedMode === 'domain_default') return trainingCenterGuidedTurn({ ctx, profile, uid, message, sessionId, origin, chatId });
  const flow = await loadGuidedFlow(uid, profile.config?.flowId);
  if (!flow) return false;
  const { processFlow } = require('../../automation/automation');
  // Legacy flow_session keys omit the connected channel and profile ID. Give
  // each profile/channel pair its own opaque execution ID to prevent a shared
  // phone contact from continuing another bot's guided conversation.
  const flowSessionId = executionFlowId(profile);
  await processFlow({ nodes: flow.nodes, edges: flow.edges, uid, flowId: flowSessionId, message, incomingText: textOf(message), user, sessionId, origin, chatId, element: { ...flow, flow_id: flowSessionId }, loopDetection: { visitedNodes: new Map(), startTime: Date.now() } });
  return true;
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

async function trainingCenterGuidedTurn({ ctx, profile, uid, message, sessionId, origin, chatId }) {
  const channelKind = channelFor(origin);
  const pack = getDomainPack(ctx.category.key, ctx.category.version);
  if (!channelKind || !pack.guidedReply) return false;
  await pruneExpiredGuidedSessions();
  const db = await dbPool.getConnection();
  let reply = null;
  try {
    const facts = pack.requiresDatabase
      ? await pack.loadFacts({ db, tenantId: ctx.tenant.id, platformOrigin: process.env.SALEMAX_PLATFORM_ORIGIN })
      : [];
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
    reply = pack.guidedReply({ message: textOf(message), state: priorState, facts, config: profile.config?.guidedContent });
    if (!reply || typeof reply.reply !== 'string' || !reply.reply.trim()) {
      await db.rollback();
      return false;
    }
    const nextState = JSON.stringify(reply.state || {});
    await db.query(`UPDATE sx_chatbot_guided_sessions SET state=?,expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 24 HOUR) WHERE id=?`, [nextState, row.id]);
    await db.commit();
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }

  if (!recipientAllowed(profile.config, message?.senderMobile) || await shouldPause(uid, chatId, channelKind, sessionId)) return false;
  const { sendWaMessage } = require('../../automation/functions');
  const sentId = await sendWaMessage({ origin, sessionId, message, uid, chatId, content: { type: 'text', text: { preview_url: false, body: reply.reply } } });
  if (!sentId) return false;
  if (reply.handoff) await handoffConversation(ctx, chatId, channelKind, sessionId, 'customer-requested-human', profile, uid);
  const timestamp = Math.trunc(Date.now() / 1000);
  const messageData = { type: 'text', metaChatId: sentId, msgContext: { type: 'text', text: { preview_url: false, body: reply.reply } }, reaction: '', timestamp, senderName: message.senderName, senderMobile: message.senderMobile, star: 0, route: 'OUTGOING', context: null, origin, sentBy: 'bot' };
  await query(`INSERT INTO beta_conversation SET ?`, { ...messageData, msgContext: JSON.stringify(messageData.msgContext), context: null, uid, chat_id: chatId });
  await query(`UPDATE beta_chats SET last_message=? WHERE uid=? AND chat_id=?`, [JSON.stringify(messageData), uid, chatId]);
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

async function generateAiAnswer({ ctx, profile, uid, customerMessage, chatId = null, channelKind = null, channelRef = null }) {
  const [settings] = await query(`SELECT provider,model,key_ciphertext,key_iv,key_auth_tag,daily_token_limit FROM sx_chatbot_provider_configs WHERE tenant_id=?`, [ctx.tenant.id]);
  if (!settings) return { handedOff: true, code: 'AI_PROVIDER_NOT_CONFIGURED' };
  if (uid && chatId && await shouldPause(uid, chatId, channelKind, channelRef)) return { paused: true };
  if (!customerMessage) return { handedOff: true, code: 'UNSUPPORTED_MESSAGE_TYPE' };
  const pack = getDomainPack(ctx.category.key, ctx.category.version);
  let facts = [...(profile.config?.knowledgeEntries || [])];
  if (pack.requiresDatabase) {
    const db = await dbPool.getConnection();
    try { facts = facts.concat(await pack.loadFacts({ db, tenantId: ctx.tenant.id, platformOrigin: process.env.SALEMAX_PLATFORM_ORIGIN })); }
    finally { db.release(); }
  }
  const history = uid && chatId
    ? await query(`SELECT type,msgContext,route FROM beta_conversation WHERE uid=? AND chat_id=? ORDER BY timestamp DESC LIMIT 8`, [uid, chatId])
    : [];
  const historySafe = history.reverse().map(item => {
    let content; try { content = typeof item.msgContext === 'string' ? JSON.parse(item.msgContext) : item.msgContext; } catch { content = null; }
    const text = item.type === 'text' ? content?.text?.body : content?.interactive?.button_reply?.title || content?.interactive?.list_reply?.title;
    return typeof text === 'string' ? { role: item.route === 'OUTGOING' ? 'assistant' : 'user', text: text.slice(0, 500) } : null;
  }).filter(Boolean);
  const { system, user: input, inputBytes } = buildAiPrompt({ pack, profile, customerMessage, facts, history: historySafe });
  if (inputBytes > 18000) return { handedOff: true, code: 'CONTEXT_LIMIT' };
  const prompt = `${system}\n\n${input}`;
  const estimate = tokenEstimate(prompt);
  const reservation = await reserveTokens(ctx, settings, estimate);
  if (!reservation) return { handedOff: true, code: 'DAILY_TOKEN_LIMIT' };
  let response;
  let succeeded = false;
  try {
    const apiKey = secrets.decrypt(settings);
    response = await provider.generate({ provider: settings.provider, model: settings.model, apiKey, system, user: input, maxOutputTokens: 350 });
    succeeded = true;
  } finally {
    await settleTokens(ctx, reservation, succeeded ? (response?.inputTokens || 0) + (response?.outputTokens || 0) : null);
  }
  const threshold = Number(profile.config?.confidenceThreshold ?? 0.72);
  if (!response.canAnswer || response.confidence < threshold || !response.reply) return { handedOff: true, code: 'LOW_CONFIDENCE', confidence: response.confidence || 0 };
  return { canAnswer: true, confidence: response.confidence, reply: response.reply };
}

async function aiTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId }) {
  if (profile.engine === 'hybrid' && !profile.config?.flowId && profile.config?.guidedMode !== 'domain_default') return { handedOff: true, code: 'GUIDED_FLOW_REQUIRED' };
  if (profile.engine === 'hybrid' && profile.config.guidedMode === 'domain_default') {
    const channelKind = channelFor(origin);
    const session = await loadDomainGuidedSession({ ctx, profile, chatId, channelKind, channelRef: sessionId });
    const pack = getDomainPack(ctx.category.key, ctx.category.version);
    const incoming = textOf(message);
    const plan = hybridTurnPlan({ hasSession: !!session, isChoice: isGuidedChoice(incoming), shouldStartGuided: pack.isGuidedIntent?.(incoming) === true, domainDefault: true, aiFallback: profile.config.aiFallback });
    if (plan.runGuided) {
      const dispatched = await trainingCenterGuidedTurn({ ctx, profile, uid, message, sessionId, origin, chatId });
      if (dispatched || !plan.allowAiFallback) return dispatched ? { flowDispatched: true } : { handedOff: true, code: 'GUIDED_FLOW_UNAVAILABLE' };
    }
  } else if (profile.engine === 'hybrid' && profile.config.flowId) {
    const [session] = await query(`SELECT id FROM flow_session WHERE uid=? AND flow_id=? AND sender_mobile=? LIMIT 1`, [uid, executionFlowId(profile), message.senderMobile]);
    const incoming = textOf(message);
    const plan = hybridTurnPlan({ hasSession: !!session, isChoice: isGuidedChoice(incoming), aiFallback: profile.config.aiFallback });
    if (plan.runGuided) {
      const dispatched = await guidedTurn({ profile, uid, message, user, sessionId, origin, chatId });
      if (dispatched || !plan.allowAiFallback) return dispatched ? { flowDispatched: true } : { handedOff: true, code: 'GUIDED_FLOW_UNAVAILABLE' };
    }
  }
  const answer = await generateAiAnswer({ ctx, profile, uid, customerMessage: textOf(message), chatId, channelKind: channelFor(origin), channelRef: sessionId });
  if (answer.handedOff || answer.paused) return answer;
  if (!recipientAllowed(profile.config, message?.senderMobile) || await shouldPause(uid, chatId, channelFor(origin), sessionId)) return { paused: true };
  const { sendWaMessage } = require('../../automation/functions');
  const sentId = await sendWaMessage({ origin, sessionId, message, uid, chatId, content: { type: 'text', text: { preview_url: false, body: answer.reply } } });
  if (!sentId) return { handedOff: true, code: 'CHANNEL_SEND_FAILED' };
  const timestamp = Math.trunc(Date.now() / 1000);
  const messageData = { type: 'text', metaChatId: sentId, msgContext: { type: 'text', text: { preview_url: false, body: answer.reply } }, reaction: '', timestamp, senderName: message.senderName, senderMobile: message.senderMobile, star: 0, route: 'OUTGOING', context: null, origin, sentBy: 'bot' };
  await query(`INSERT INTO beta_conversation SET ?`, { ...messageData, msgContext: JSON.stringify(messageData.msgContext), context: null, uid, chat_id: chatId });
  await query(`UPDATE beta_chats SET last_message=? WHERE uid=? AND chat_id=?`, [JSON.stringify(messageData), uid, chatId]);
  return { sent: true };
}

async function previewConfiguredBot({ ctx, profile, uid, message }) {
  if (!supportsAiPreview(profile?.engine, profile?.config)) return { canAnswer: false, confidence: 0, reply: '', wouldHandoff: true, reason: 'AI_FALLBACK_DISABLED' };
  if (profile.engine === 'hybrid') {
    if (profile.config?.guidedMode !== 'domain_default') {
      if (!profile.config?.flowId) return { canAnswer: false, confidence: 0, reply: '', wouldHandoff: true, reason: 'GUIDED_FLOW_REQUIRED' };
      if (!await loadGuidedFlow(uid, profile.config.flowId)) return { canAnswer: false, confidence: 0, reply: '', wouldHandoff: true, reason: 'GUIDED_FLOW_UNAVAILABLE' };
    }
  }
  if (profile.config?.aiDataProcessingConfirmed !== true) return { canAnswer: false, confidence: 0, reply: '', wouldHandoff: true, reason: 'AI_DATA_PROCESSING_ACK_REQUIRED' };
  const answer = await generateAiAnswer({ ctx, profile, uid: null, customerMessage: message });
  if (answer.handedOff) return { canAnswer: false, confidence: answer.confidence || 0, reply: '', wouldHandoff: true, reason: answer.code || 'LOW_CONFIDENCE' };
  return { canAnswer: true, confidence: answer.confidence, reply: answer.reply, wouldHandoff: false, reason: null };
}

async function runConfiguredBot({ uid, message, user, sessionId, origin, chatId }) {
  if (!uid || !chatId || message?.route !== 'INCOMING') return { handled: false };
  const ctx = await resolveTenant(uid);
  if (!ctx) return { handled: false };
  const profile = await profileFor(ctx, uid, origin, sessionId);
  if (!profile) return { handled: false };
  // A restricted chat is handled silently so it cannot fall through to legacy bots.
  if (!recipientAllowed(profile.config, message?.senderMobile)) return { handled: true, paused: true, code: 'RECIPIENT_NOT_ENABLED' };
  const channelKind = channelFor(origin);
  if (await shouldPause(uid, chatId, channelKind, sessionId)) return { handled: true, paused: true };
  const turn = await claimTurn(ctx, profile, message, chatId);
  if (!turn) {
    await handoffConversation(ctx, chatId, channelKind, sessionId, 'inbound-message-id-unavailable', profile, uid);
    return { handled: true, handedOff: true, code: 'INBOUND_MESSAGE_ID_UNAVAILABLE' };
  }
  if (turn.duplicate) return { handled: true, duplicate: true };
  try {
    let result;
    if (profile.engine === 'guided') result = await guidedTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId }) ? { sent: true } : { handedOff: true, code: 'GUIDED_FLOW_UNAVAILABLE' };
    else result = await aiTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId });
    if (result?.sent || result?.flowDispatched) await finishTurn(turn, 'sent', result?.flowDispatched ? 'guided-flow-dispatched' : 'reply-sent');
    else if (result?.paused) await finishTurn(turn, 'handed_off', 'human-paused');
    else {
      await handoffConversation(ctx, chatId, channelKind, sessionId, result?.code || 'human-review', profile, uid);
      await finishTurn(turn, 'handed_off', result?.code || 'human-review');
    }
    return { handled: true, ...result };
  } catch (error) {
    const failure = ['AI_PROVIDER_NOT_CONFIGURED','AI_PROVIDER_TIMEOUT','AI_PROVIDER_REQUEST_FAILED','AI_PROVIDER_INVALID_OUTPUT'].includes(error.code) ? error.code : 'runtime-error';
    await handoffConversation(ctx, chatId, channelKind, sessionId, failure, profile, uid).catch(() => {});
    await finishTurn(turn, 'handed_off', failure).catch(() => {});
    return { handled: true, handedOff: true, code: error.code || 'BOT_RUNTIME_ERROR' };
  }
}

module.exports = { runConfiguredBot, previewConfiguredBot, resolveTenant, loadGuidedFlow, parseGuidedFlow, executionFlowId };
