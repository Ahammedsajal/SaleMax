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
    if (profile?.config?.sharedInboxRouting === true && profile.config.handoffAssigneeIdentityId && uid) {
      await require('./team-conversation-assignment').assignConversation(db, { ctx, uid, chatId, identityId: profile.config.handoffAssigneeIdentityId, reason: 'bot-human-handover' });
    }
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

async function guidedTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo }) {
  if (profile.config?.guidedMode === 'domain_default') return trainingCenterGuidedTurn({ ctx, profile, uid, message, sessionId, origin, chatId, leadInfo });
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
  const db = await dbPool.getConnection();
  let reply = null;
  let deferLeadQuestion = false;
  try {
    const facts = leadInfo?.facts || (pack.requiresDatabase
      ? await pack.loadFacts({ db, tenantId: ctx.tenant.id, platformOrigin: process.env.SALEMAX_PLATFORM_ORIGIN })
      : []);
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
    if (profile.engine !== 'guided' && priorState) priorState.language = businessContext.languageFor(intent || textOf(message), priorState);
    deferLeadQuestion = !priorState?.greeted;
    reply = pack.guidedReply({ message: intent || textOf(message), state: priorState, facts, config: profile.config?.guidedContent });
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
    await db.commit();
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally { db.release(); }

  if (!await canSendNow({ ctx, profile, uid, origin, sessionId, chatId, message })) return false;
  const { sendWaMessage } = require('../../automation/functions');
  const sentId = await sendWaMessage({ origin, sessionId, message, uid, chatId, content: { type: 'text', text: { preview_url: false, body: reply.reply } } });
  if (!sentId) return false;
  if (reply.handoff) await handoffConversation(ctx, chatId, channelKind, sessionId, 'customer-requested-human', profile, uid);
  const timestamp = Math.trunc(Date.now() / 1000);
  const messageData = { type: 'text', metaChatId: sentId, msgContext: { type: 'text', text: { preview_url: false, body: reply.reply } }, reaction: '', timestamp, senderName: message.senderName, senderMobile: message.senderMobile, star: 0, route: 'OUTGOING', context: null, origin, sentBy: 'bot' };
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

async function canSendNow({ ctx, profile, uid, origin, sessionId, chatId, message }) {
  const current = await profileFor(ctx, uid, origin, sessionId);
  return current?.id === profile.id && Number(current.revision) === Number(profile.revision)
    && recipientAllowed(current.config, message?.senderMobile)
    && !await shouldPause(uid, chatId, channelFor(origin), sessionId);
}

async function generateAiAnswer({ ctx, profile, uid, customerMessage, chatId = null, channelKind = null, channelRef = null, state = null, factsOverride = null }) {
  const [settings] = await query(`SELECT provider,model,key_ciphertext,key_iv,key_auth_tag,daily_token_limit FROM sx_chatbot_provider_configs WHERE tenant_id=?`, [ctx.tenant.id]);
  if (uid && chatId && await shouldPause(uid, chatId, channelKind, channelRef)) return { paused: true };
  if (!customerMessage) return { handedOff: true, code: 'UNSUPPORTED_MESSAGE_TYPE' };
  const pack = getDomainPack(ctx.category.key, ctx.category.version);
  const loadFacts = async () => {
    if (!pack.requiresDatabase) return [];
    const db = await dbPool.getConnection();
    try { return await pack.loadFacts({ db, tenantId: ctx.tenant.id, platformOrigin: process.env.SALEMAX_PLATFORM_ORIGIN }); }
    finally { db.release(); }
  };
  const facts = factsOverride || await loadFacts();
  const session = state || (chatId ? await loadDomainGuidedSession({ ctx, profile, chatId, channelKind, channelRef }) : null) || {};
  const context = businessContext.retrieveContext({ facts, knowledgeEntries: profile.config?.knowledgeEntries, message: customerMessage, state: session, profileRevision: profile.revision });
  const nextState = { ...session, language: context.language, selectedCourseCode: (context.explicitCourses ? context.selectedCourseCode : null) || session.selectedCourseCode };
  const courseOverview = profile.engine === 'hybrid' && profile.config?.aiFallback !== false && businessContext.isCourseOverviewRequest(customerMessage, context);
  const factualOverviewFallback = sourceContext => {
    const simple = businessContext.simpleFactualReply(customerMessage, sourceContext, profile.config);
    return simple ? { canAnswer: true, confidence: 1, reply: simple.reply, state: nextState, route: 'facts', metrics: { inputTokens: 0, outputTokens: 0, cacheHit: false, sources: sourceContext.sources } } : null;
  };
  if (profile.engine === 'hybrid') {
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
    const msg = profile.config?.guidedContent?.messages?.unavailableMessage || pack.guidedContentDefaults?.messages?.unavailableMessage;
    return { canAnswer: true, confidence: 0, reply: (context.explicitCourses || session.selectedCourseCode || /policy|refund|discount|guarantee|accredit|سياسة|استرداد|خصم|ضمان|اعتماد/i.test(customerMessage)) ? (msg?.[language] || businessContext.clarification(profile.config, language)) : businessContext.clarification(profile.config, language), state: nextState, route: 'clarification', reason: validation.code || 'LOW_CONFIDENCE', metrics };
  }
  // Re-read live facts after the model call; never deliver a price or date
  // generated from data that changed while the provider was working.
  const fresh = businessContext.retrieveContext({ facts: await loadFacts(), knowledgeEntries: profile.config?.knowledgeEntries, message: customerMessage, state: session, profileRevision: profile.revision });
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
    const [session] = await query(`SELECT id FROM flow_session WHERE uid=? AND flow_id=? AND sender_mobile=? LIMIT 1`, [uid, executionFlowId(profile), message.senderMobile]);
    const incoming = textOf(message);
    const plan = hybridTurnPlan({ hasSession: !!session, isChoice: isGuidedChoice(incoming), aiFallback: profile.config.aiFallback });
    if (plan.runGuided) {
      const dispatched = await guidedTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo });
      if (dispatched || !plan.allowAiFallback) return dispatched ? { flowDispatched: true } : { handedOff: true, code: 'GUIDED_FLOW_UNAVAILABLE' };
    }
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
    try { facts = await pack.loadFacts({ db, tenantId: ctx.tenant.id, platformOrigin: process.env.SALEMAX_PLATFORM_ORIGIN }); } finally { db.release(); }
    const result = pack.guidedReply({ message: route === 'human' ? (businessContext.languageFor(message, prior) === 'ar' ? 'موظف' : 'agent') : message, state: prior, facts, config: profile.config.guidedContent });
    businessContext.polishGuidedReply({ result, profile, message, state: prior, defaults: pack.guidedContentDefaults });
    return { canAnswer: true, confidence: 1, reply: result.reply, wouldHandoff: !!result.handoff, reason: result.handoff ? 'customer-requested-human' : null, route, state: result.state, metrics: { inputTokens: 0, outputTokens: 0 } };
  }
  const answer = await generateAiAnswer({ ctx, profile, uid: null, customerMessage: message, state: prior });
  if (answer.state) answer.state.recentConversation = [...(prior.recentConversation || []), { role: 'user', text: message.slice(0, 400) }, { role: 'assistant', text: (answer.reply || '').slice(0, 500) }].slice(-4);
  if (answer.handedOff) return { canAnswer: false, confidence: answer.confidence || 0, reply: '', wouldHandoff: true, reason: answer.code || 'LOW_CONFIDENCE' };
  return { canAnswer: true, confidence: answer.confidence, reply: answer.reply, wouldHandoff: false, reason: answer.reason || null, route: answer.route, state: answer.state, metrics: answer.metrics };
}

async function runConfiguredBot({ uid, message, user, sessionId, origin, chatId }) {
  if (!uid || !chatId || message?.route !== 'INCOMING') return { handled: false };
  const ctx = await resolveTenant(uid);
  if (!ctx) return { handled: false };
  const profile = await profileFor(ctx, uid, origin, sessionId);
  if (!profile) return { handled: false };
  // A restricted chat is handled silently so it cannot fall through to legacy bots.
  if (!recipientAllowed(profile.config, message?.senderMobile)) return { handled: true, paused: true, code: 'RECIPIENT_NOT_ENABLED' };
  let leadInfo = null;
  if (ctx.tenant.categoryKey === 'training_center') {
    try {
      const db = await dbPool.getConnection();
      let facts;
      try { facts = await getDomainPack(ctx.category.key, ctx.category.version).loadFacts({ db, tenantId: ctx.tenant.id, platformOrigin: process.env.SALEMAX_PLATFORM_ORIGIN }); }
      finally { db.release(); }
      leadInfo = await require('./chatbot-lead-capture').captureLead(dbPool, { ctx, profile, uid, chatId, origin, message, facts });
    } catch (error) {
      await handoffConversation(ctx, chatId, channelFor(origin), sessionId, 'lead-capture-unavailable', profile, uid).catch(() => {});
      return { handled: true, handedOff: true, code: 'LEAD_CAPTURE_UNAVAILABLE' };
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
  const testReset = require('./chatbot-test-reset').isTestReset(profile.config, message?.senderMobile, textOf(message));
  if (!testReset && await shouldPause(uid, chatId, channelKind, sessionId)) return { handled: true, paused: true };
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
    if (profile.engine === 'guided') result = await guidedTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo }) ? { sent: true } : { handedOff: true, code: 'GUIDED_FLOW_UNAVAILABLE' };
    else result = await aiTurn({ ctx, profile, uid, message, user, sessionId, origin, chatId, leadInfo });
    if (result?.metrics) await query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,NULL,'system','chatbot.turn-measured','chatbot-turn',?,?,?)`, [crypto.randomUUID(), ctx.tenant.id, turn.id, JSON.stringify({ route: result.route, reason: result.reason || null, ...result.metrics }), crypto.randomUUID()]);
    if (result?.sent || result?.flowDispatched) await finishTurn(turn, 'sent', result?.flowDispatched ? 'guided-flow-dispatched' : 'reply-sent');
    else if (result?.paused) await finishTurn(turn, 'handed_off', 'human-paused');
    else {
      await handoffConversation(ctx, chatId, channelKind, sessionId, result?.code || 'human-review', profile, uid);
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

module.exports = { runConfiguredBot, previewConfiguredBot, resolveTenant, loadGuidedFlow, parseGuidedFlow, executionFlowId };
