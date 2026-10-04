'use strict';
const express = require('express');
const crypto = require('node:crypto');
const { legacyChatbotContext } = require('./chatbot-identity');
const { decision } = require('./policy');
const chatbotSecrets = require('./chatbot-secrets');
const chatbotProvider = require('./chatbot-provider');
const { ENGINES, botInput, cleanText, botRequirements } = require('./chatbot-config');
const { previewGuidedTurn } = require('./chatbot-guide-preview');
const { getDomainPack } = require('./chatbot-domain-packs');
const { SUPPORTED_CHANNEL_KINDS } = require('./chatbot-channels');

// Until the other adapters have inbound and outbound coverage, expose only
// WhatsApp channels supported by the current inbox dispatch path.
const CHANNELS = new Set(SUPPORTED_CHANNEL_KINDS);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const uuid = () => crypto.randomUUID();
function authorize(ctx) {
  const allowed = decision(ctx, { capability: 'automation.chatbot', permission: 'automation.manage' });
  if (!allowed.allowed) fail(allowed.code);
}
function createChatbotRouter({ pool, origin, userGuard, canonicalGuard }) {
  const router = express.Router();
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  router.use(express.json({ limit: '40kb', strict: true }));
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('Origin') !== origin) return res.status(403).json({ success: false, code: 'ORIGIN_DENIED' });
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ success: false, code: 'INVALID_BODY' });
    return next();
  });
  router.use((req, res, next) => {
    if (/^Bearer\s+/i.test(req.get('Authorization') || '')) {
      return userGuard(req, res, () => legacyChatbotContext(pool, req.decode.uid).then(ctx => { req.botContext = ctx; next(); }).catch(next));
    }
    return canonicalGuard(req, res, () => { req.botContext = req.businessContext; next(); });
  });
  const withDb = async fn => { const db = await pool.getConnection(); try { return await fn(db); } finally { db.release(); } };
  const context = req => { authorize(req.botContext); return req.botContext; };
  const audit = (db, ctx, action, id, changes) => db.query(
    `INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
     VALUES (?,?,?,'identity',?,'chatbot',?,?,?)`, [uuid(), ctx.tenant.id, ctx.identity.id, action, id, JSON.stringify(changes), uuid()]);

  router.get('/settings/provider', wrap(async (req, res) => {
    const ctx = context(req);
    const data = await withDb(async db => {
      const [[row]] = await db.query(`SELECT provider,model,daily_token_limit AS dailyTokenLimit,revision,updated_at AS updatedAt FROM sx_chatbot_provider_configs WHERE tenant_id=?`, [ctx.tenant.id]);
      return row ? { configured: true, ...row, revision: Number(row.revision), dailyTokenLimit: Number(row.dailyTokenLimit), maskedKey: '••••••••' } : { configured: false, revision: 0, supportedProviders: Object.keys(chatbotProvider.PROVIDERS) };
    });
    res.json({ success: true, data });
  }));
  router.put('/settings/provider', wrap(async (req, res) => {
    const ctx = context(req); const { provider, model, apiKey, expectedRevision } = req.body;
    const spec = chatbotProvider.PROVIDERS[provider];
    if (!spec || typeof model !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(model) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('INVALID_PROVIDER_CONFIG');
    if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length < 16 || apiKey.length > 2048)) fail('INVALID_PROVIDER_KEY');
    const dailyTokenLimit = req.body.dailyTokenLimit ?? 50000;
    if (!Number.isSafeInteger(dailyTokenLimit) || dailyTokenLimit < 1000 || dailyTokenLimit > 1000000) fail('INVALID_DAILY_TOKEN_LIMIT');
    const encrypted = apiKey === undefined ? null : chatbotSecrets.encrypt(apiKey);
    const data = await withDb(async db => {
      await db.beginTransaction(); try {
        const [[row]] = await db.query(`SELECT provider,model,revision,key_ciphertext,key_iv,key_auth_tag FROM sx_chatbot_provider_configs WHERE tenant_id=? FOR UPDATE`, [ctx.tenant.id]);
        const revision = row ? Number(row.revision) : 0;
        if (revision !== expectedRevision) fail('STALE_REVISION');
        if (!row && !encrypted) fail('PROVIDER_KEY_REQUIRED');
        if (row && row.provider !== provider && !encrypted) fail('PROVIDER_KEY_REQUIRED');
        const nextRevision = revision + 1;
        if (row) {
          await db.query(`UPDATE sx_chatbot_provider_configs SET provider=?,model=?,key_ciphertext=?,key_iv=?,key_auth_tag=?,daily_token_limit=?,revision=?,updated_by_identity_id=? WHERE tenant_id=?`, [provider, model, encrypted?.ciphertext ?? row.key_ciphertext, encrypted?.iv ?? row.key_iv, encrypted?.authTag ?? row.key_auth_tag, dailyTokenLimit, nextRevision, ctx.identity.id, ctx.tenant.id]);
        } else {
          await db.query(`INSERT INTO sx_chatbot_provider_configs(tenant_id,provider,model,key_ciphertext,key_iv,key_auth_tag,daily_token_limit,revision,updated_by_identity_id) VALUES (?,?,?,?,?,?,?,1,?)`, [ctx.tenant.id, provider, model, encrypted.ciphertext, encrypted.iv, encrypted.authTag, dailyTokenLimit, ctx.identity.id]);
        }
        await audit(db, ctx, 'chatbot.provider-configured', ctx.tenant.id, { provider, model, dailyTokenLimit, keyRotated: !!encrypted });
        await db.commit(); return { configured: true, provider, model, dailyTokenLimit, revision: nextRevision, maskedKey: '••••••••' };
      } catch (error) { await db.rollback(); throw error; }
    });
    res.json({ success: true, data });
  }));

  router.get('/channels', wrap(async (req, res) => {
    const ctx = context(req);
    const data = await withDb(async db => {
      const uid = await legacyUidFor(db, req, ctx);
      const [meta] = await db.query(`SELECT business_phone_number_id AS reference,
          CASE WHEN JSON_VALID(embed_data) THEN COALESCE(
            NULLIF(JSON_UNQUOTE(JSON_EXTRACT(embed_data,'$.phoneDetails.display_phone_number')),'')
          ) ELSE NULL END AS label
        FROM meta_api
        WHERE uid=? AND business_phone_number_id IS NOT NULL AND business_phone_number_id<>''`, [uid]);
      const [qr] = await db.query(`SELECT uniqueId AS reference,number AS label FROM instance WHERE uid=?`, [uid]);
      return [
        ...meta.map(item => ({ kind: 'whatsapp_meta', reference: String(item.reference), label: item.label ? String(item.label) : null })),
        ...qr.map(item => ({ kind: 'whatsapp_qr', reference: String(item.reference), label: item.label ? String(item.label) : null })),
      ];
    });
    res.json({ success: true, data });
  }));
  router.get('/flows', wrap(async (req, res) => {
    const ctx = context(req);
    const data = await withDb(async db => {
      const uid = await legacyUidFor(db, req, ctx);
      const [rows] = await db.query(`SELECT flow_id AS id,data,source,is_active AS isActive FROM beta_flows
        WHERE uid=? AND source='wa_chatbot' AND is_active=1 ORDER BY flow_id LIMIT 40`, [uid]);
      const runtime = require('./chatbot-runtime');
      return rows.filter(row => runtime.parseGuidedFlow(row)).map(row => ({ id: row.id, name: row.id }));
    });
    res.json({ success: true, data });
  }));
  router.post('/guided-preview', wrap(async (req, res) => {
    const ctx = context(req);
    const pack = getDomainPack(ctx.category.key, ctx.category.version);
    const result = await withDb(db => previewGuidedTurn({ body: req.body, pack, db, tenantId: ctx.tenant.id, platformOrigin: process.env.SALEMAX_PLATFORM_ORIGIN }));
    res.json({ success: true, data: result });
  }));

  router.get('/', wrap(async (req, res) => {
    const ctx = context(req);
    const data = await withDb(async db => {
      const [bots] = await db.query(`SELECT id,name,engine,status,config,revision,updated_at AS updatedAt FROM sx_chatbot_profiles WHERE tenant_id=? ORDER BY updated_at DESC`, [ctx.tenant.id]);
      for (const bot of bots) {
        bot.config = typeof bot.config === 'string' ? JSON.parse(bot.config) : bot.config;
        const [channels] = await db.query(`SELECT channel_kind AS kind,channel_ref AS reference FROM sx_chatbot_channel_assignments WHERE tenant_id=? AND chatbot_id=? ORDER BY created_at`, [ctx.tenant.id, bot.id]);
        bot.channels = channels;
      }
      const pack = getDomainPack(ctx.category.key, ctx.category.version);
      return {
        category: ctx.category.key,
        categoryTitle: ctx.category.title,
        categoryVersion: ctx.category.version,
        engines: [...ENGINES],
        guidedContentDefaults: pack.guidedContentDefaults,
        guidedContentSchema: pack.guidedContentSchema,
        items: bots,
      };
    });
    res.json({ success: true, data });
  }));
  router.post('/:id/preview', wrap(async (req, res) => {
    const ctx = context(req);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id) || !Number.isSafeInteger(req.body.expectedRevision) || req.body.expectedRevision < 1 || typeof req.body.message !== 'string' || !req.body.message.trim() || req.body.message.length > 2000) fail('INVALID_PREVIEW_REQUEST');
    const profile = await withDb(async db => {
      const [[row]] = await db.query(`SELECT id,engine,status,config,revision,category_key AS categoryKey,category_version AS categoryVersion FROM sx_chatbot_profiles WHERE tenant_id=? AND id=?`, [ctx.tenant.id, req.params.id]);
      if (!row) fail('BOT_NOT_FOUND');
      if (Number(row.revision) !== req.body.expectedRevision) fail('STALE_REVISION');
      if (row.categoryKey !== ctx.category.key || Number(row.categoryVersion) !== ctx.category.version) fail('CATEGORY_UNAVAILABLE');
      return { ...row, config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config };
    });
    const uid = await withDb(db => legacyUidFor(db, req, ctx));
    const result = await require('../platform/chatbot-runtime').previewConfiguredBot({ ctx, profile, uid, message: req.body.message.trim() });
    await withDb(db => audit(db, ctx, 'chatbot.preview-tested', req.params.id, { engine: profile.engine, revision: Number(profile.revision), inputCharacters: req.body.message.trim().length, outcome: result.canAnswer ? 'answer' : 'handoff', reason: result.reason || null }));
    res.json({ success: true, data: result });
  }));
  router.post('/', wrap(async (req, res) => {
    const ctx = context(req); const input = botInput(req.body, ctx.category.key, ctx.category.version);
    const id = uuid();
    const data = await withDb(async db => {
      await db.beginTransaction(); try {
        await db.query(`INSERT INTO sx_chatbot_profiles(id,tenant_id,category_key,category_version,name,engine,status,config,created_by_identity_id,updated_by_identity_id) VALUES (?,?,?,?,?,?,'draft',?,?,?)`, [id, ctx.tenant.id, ctx.category.key, ctx.category.version, input.name, input.engine, JSON.stringify(input.config), ctx.identity.id, ctx.identity.id]);
        await audit(db, ctx, 'chatbot.profile-created', id, { engine: input.engine, category: ctx.category.key });
        await db.commit(); return { id, status: 'draft', revision: 1, runtime: 'configuration_only' };
      } catch (error) { await db.rollback(); throw error; }
    });
    res.status(201).json({ success: true, data });
  }));
  router.put('/:id', wrap(async (req, res) => {
    const ctx = context(req); const input = botInput(req.body, ctx.category.key, ctx.category.version);
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id) || !Number.isSafeInteger(req.body.expectedRevision) || req.body.expectedRevision < 1) fail('INVALID_REVISION');
    const data = await withDb(async db => {
      await db.beginTransaction(); try {
        const [[row]] = await db.query(`SELECT revision,status FROM sx_chatbot_profiles WHERE tenant_id=? AND id=? FOR UPDATE`, [ctx.tenant.id, req.params.id]);
        if (!row) fail('BOT_NOT_FOUND');
        if (Number(row.revision) !== req.body.expectedRevision) fail('STALE_REVISION');
        if (row.status === 'live') fail('LIVE_BOT_MUST_BE_PAUSED');
        await db.query(`UPDATE sx_chatbot_profiles SET name=?,engine=?,config=?,revision=revision+1,updated_by_identity_id=? WHERE tenant_id=? AND id=?`, [input.name, input.engine, JSON.stringify(input.config), ctx.identity.id, ctx.tenant.id, req.params.id]);
        await audit(db, ctx, 'chatbot.profile-updated', req.params.id, { engine: input.engine, revision: req.body.expectedRevision + 1 });
        await db.commit(); return { id: req.params.id, revision: req.body.expectedRevision + 1 };
      } catch (error) { await db.rollback(); throw error; }
    });
    res.json({ success: true, data });
  }));
  router.put('/:id/status', wrap(async (req, res) => {
    const ctx = context(req); const { status, expectedRevision } = req.body;
    if (!['draft', 'testing', 'paused', 'live'].includes(status) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !/^[0-9a-f-]{36}$/i.test(req.params.id)) fail('INVALID_STATUS');
    const data = await withDb(async db => {
      await db.beginTransaction(); try {
        const [[row]] = await db.query(`SELECT revision,status,engine,config,category_key AS categoryKey,category_version AS categoryVersion FROM sx_chatbot_profiles WHERE tenant_id=? AND id=? FOR UPDATE`, [ctx.tenant.id, req.params.id]);
        if (!row) fail('BOT_NOT_FOUND'); if (Number(row.revision) !== expectedRevision) fail('STALE_REVISION');
        if (status === 'live') {
          const [[assignment]] = await db.query(`SELECT COUNT(*) AS count FROM sx_chatbot_channel_assignments WHERE tenant_id=? AND chatbot_id=?`, [ctx.tenant.id, req.params.id]);
          if (Number(assignment.count) < 1) fail('BOT_CHANNEL_REQUIRED');
          const config = typeof row.config === 'string' ? JSON.parse(row.config) : row.config;
          if (row.categoryKey !== ctx.category.key || Number(row.categoryVersion) !== ctx.category.version) fail('CATEGORY_UNAVAILABLE');
          const requirements = botRequirements(row.engine, config);
          if (config?.guidedMode === 'domain_default' && !require('./chatbot-domain-packs').getDomainPack(row.categoryKey, Number(row.categoryVersion)).guidedReply) fail('CATEGORY_GUIDED_FLOW_UNAVAILABLE');
          if (requirements.requiresGuidedFlow && !config?.flowId) fail('GUIDED_FLOW_REQUIRED');
          if (requirements.requiresGuidedFlow) {
            const uid = await legacyUidFor(db, req, ctx);
            const flow = await require('../platform/chatbot-runtime').loadGuidedFlow(uid, config?.flowId);
            if (!flow) fail('GUIDED_FLOW_UNAVAILABLE');
          }
          if (requirements.requiresAi) {
            if (config?.aiDataProcessingConfirmed !== true) fail('AI_DATA_PROCESSING_ACK_REQUIRED');
            const [[providerConfig]] = await db.query(`SELECT provider,key_ciphertext,key_iv,key_auth_tag FROM sx_chatbot_provider_configs WHERE tenant_id=?`, [ctx.tenant.id]);
            if (!providerConfig) fail('AI_PROVIDER_NOT_CONFIGURED');
            chatbotSecrets.decrypt(providerConfig);
          }
        }
        await db.query(`UPDATE sx_chatbot_profiles SET status=?,revision=revision+1,updated_by_identity_id=? WHERE tenant_id=? AND id=?`, [status, ctx.identity.id, ctx.tenant.id, req.params.id]);
        await audit(db, ctx, 'chatbot.status-changed', req.params.id, { from: row.status, to: status, revision: expectedRevision + 1 });
        await db.commit(); return { id: req.params.id, status, revision: expectedRevision + 1, runtime: 'inbound_connected' };
      } catch (error) { await db.rollback(); throw error; }
    }); res.json({ success: true, data });
  }));
  router.put('/:id/channels', wrap(async (req, res) => {
    const ctx = context(req); const { channels, expectedRevision } = req.body;
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id) || !Number.isSafeInteger(expectedRevision) || !Array.isArray(channels) || channels.length > 10) fail('INVALID_CHANNELS');
    const clean = channels.map(item => {
      if (!item || !CHANNELS.has(item.kind) || typeof item.reference !== 'string' || !/^[A-Za-z0-9+_.:@/-]{1,160}$/.test(item.reference)) fail('INVALID_CHANNELS');
      return { kind: item.kind, reference: item.reference };
    });
    if (new Set(clean.map(x => `${x.kind}:${x.reference}`)).size !== clean.length) fail('DUPLICATE_CHANNEL');
    const data = await withDb(async db => {
      await db.beginTransaction(); try {
        const [[bot]] = await db.query(`SELECT revision,status FROM sx_chatbot_profiles WHERE tenant_id=? AND id=? FOR UPDATE`, [ctx.tenant.id, req.params.id]);
        if (!bot) fail('BOT_NOT_FOUND'); if (Number(bot.revision) !== expectedRevision) fail('STALE_REVISION');
        if (bot.status === 'live') fail('LIVE_BOT_MUST_BE_PAUSED');
        const uid = await legacyUidFor(db, req, ctx);
        for (const channel of clean) {
          const [matches] = channel.kind === 'whatsapp_meta'
            ? await db.query(`SELECT id FROM meta_api WHERE uid=? AND business_phone_number_id=? LIMIT 2`, [uid, channel.reference])
            : await db.query(`SELECT uniqueId AS id FROM instance WHERE uid=? AND uniqueId=? LIMIT 2`, [uid, channel.reference]);
          if (matches.length !== 1) fail('CONNECTED_CHANNEL_NOT_FOUND');
        }
        await db.query(`DELETE FROM sx_chatbot_channel_assignments WHERE tenant_id=? AND chatbot_id=?`, [ctx.tenant.id, req.params.id]);
        for (const channel of clean) await db.query(`INSERT INTO sx_chatbot_channel_assignments(id,tenant_id,chatbot_id,channel_kind,channel_ref,assigned_by_identity_id) VALUES (?,?,?,?,?,?)`, [uuid(), ctx.tenant.id, req.params.id, channel.kind, channel.reference, ctx.identity.id]);
        await db.query(`UPDATE sx_chatbot_profiles SET revision=revision+1,updated_by_identity_id=? WHERE tenant_id=? AND id=?`, [ctx.identity.id, ctx.tenant.id, req.params.id]);
        await audit(db, ctx, 'chatbot.channels-assigned', req.params.id, { count: clean.length });
        await db.commit(); return { id: req.params.id, channels: clean, revision: expectedRevision + 1, runtime: 'inbound_connected' };
      } catch (error) { await db.rollback(); throw error; }
    }); res.json({ success: true, data });
  }));
  async function legacyUidFor(db, req, ctx) {
    if (req.decode?.uid) return req.decode.uid;
    const [rows] = await db.query(`SELECT u.uid,o.legacy_uid_hash AS uidHash
      FROM sx_legacy_ownership o JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED)
      WHERE o.source_table='user' AND o.tenant_id=? AND u.role='user' LIMIT 2`, [ctx.tenant.id]);
    if (rows.length !== 1 || rows[0].uidHash !== crypto.createHash('sha256').update(rows[0].uid).digest('hex')) fail('LEGACY_INBOX_LINK_REQUIRED');
    return rows[0].uid;
  }
  async function requireConversation(db, ctx, req, conversationId, channelKind, channelRef) {
    if (!/^[A-Za-z0-9_.:@+/-]{1,999}$/.test(conversationId)) fail('INVALID_CONVERSATION_ID');
    if (!['whatsapp_meta', 'whatsapp_qr'].includes(channelKind) || typeof channelRef !== 'string' || !/^[A-Za-z0-9+_.:@/-]{1,160}$/.test(channelRef)) fail('INVALID_CONVERSATION_CHANNEL');
    const uid = await legacyUidFor(db, req, ctx);
    const [[beta]] = await db.query(`SELECT chat_id AS id FROM beta_chats WHERE uid=? AND chat_id=? LIMIT 1 FOR UPDATE`, [uid, conversationId]);
    let legacy = null;
    if (!beta) [[legacy]] = await db.query(`SELECT chat_id AS id FROM chats WHERE uid=? AND chat_id=? LIMIT 1 FOR UPDATE`, [uid, conversationId]);
    if (!beta && !legacy) fail('CONVERSATION_NOT_FOUND');
    const [channels] = channelKind === 'whatsapp_meta'
      ? await db.query(`SELECT id FROM meta_api WHERE uid=? AND business_phone_number_id=? LIMIT 2`, [uid, channelRef])
      : await db.query(`SELECT uniqueId AS id FROM instance WHERE uid=? AND uniqueId=? LIMIT 2`, [uid, channelRef]);
    if (channels.length !== 1) fail('CONNECTED_CHANNEL_NOT_FOUND');
    const [[assignment]] = await db.query(`SELECT b.id FROM sx_chatbot_profiles b
      JOIN sx_chatbot_channel_assignments a ON a.tenant_id=b.tenant_id AND a.chatbot_id=b.id
      WHERE b.tenant_id=? AND a.channel_kind=? AND a.channel_ref=? AND b.status IN ('live','paused') LIMIT 1`,
    [ctx.tenant.id, channelKind, channelRef]);
    if (!assignment) fail('BOT_CHANNEL_REQUIRED');
    return uid;
  }
  router.get('/conversations/:conversationId/bot-control', wrap(async (req, res) => {
    const ctx = context(req);
    const { channelKind, channelRef } = req.query;
    const data = await withDb(async db => {
      await requireConversation(db, ctx, req, req.params.conversationId, channelKind, channelRef);
      const [[row]] = await db.query(`SELECT c.mode,c.pause_until AS pauseUntil,c.reason,c.revision,c.updated_at AS updatedAt,c.updated_by_kind AS updatedByKind,i.display_name AS updatedBy,
          (c.mode='paused' AND (c.pause_until IS NULL OR c.pause_until>UTC_TIMESTAMP(3))) AS isActive
        FROM sx_chatbot_conversation_controls c LEFT JOIN sx_identities i ON i.id=c.updated_by_identity_id
        WHERE c.tenant_id=? AND c.channel_kind=? AND c.channel_ref=? AND c.conversation_id=?`, [ctx.tenant.id, channelKind, channelRef, req.params.conversationId]);
      const active = Boolean(row?.isActive);
      return row ? { mode: active ? 'paused' : 'inherit', pauseUntil: active ? row.pauseUntil : null, reason: active ? row.reason : null, revision: Number(row.revision), updatedAt: row.updatedAt, updatedBy: row.updatedByKind === 'system' ? 'System' : row.updatedBy, channelKind, channelRef } : { mode: 'inherit', pauseUntil: null, reason: null, revision: 0, updatedBy: null, channelKind, channelRef };
    });
    res.json({ success: true, data });
  }));
  router.put('/conversations/:conversationId/bot-control', wrap(async (req, res) => {
    const ctx = context(req); const { mode, expectedRevision, channelKind, channelRef } = req.body;
    if (!['inherit', 'paused'].includes(mode) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('INVALID_CONVERSATION_CONTROL');
    let pauseUntil = null;
    if (mode === 'paused' && req.body.pauseUntil != null) {
      if (typeof req.body.pauseUntil !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(req.body.pauseUntil)) fail('INVALID_PAUSE_UNTIL');
      const parsed = new Date(req.body.pauseUntil);
      if (Number.isNaN(parsed.valueOf()) || parsed <= new Date() || parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) fail('INVALID_PAUSE_UNTIL');
      pauseUntil = parsed.toISOString().slice(0, 23).replace('T', ' ');
    }
    const reason = req.body.reason == null ? null : cleanText(req.body.reason, 240, 'INVALID_PAUSE_REASON') || null;
    const data = await withDb(async db => {
      await db.beginTransaction(); try {
        await requireConversation(db, ctx, req, req.params.conversationId, channelKind, channelRef);
        const [[row]] = await db.query(`SELECT id,mode,revision FROM sx_chatbot_conversation_controls WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? FOR UPDATE`, [ctx.tenant.id, channelKind, channelRef, req.params.conversationId]);
        const currentRevision = row ? Number(row.revision) : 0;
        if (currentRevision !== expectedRevision) fail('STALE_REVISION');
        const nextRevision = currentRevision + 1;
        if (row) await db.query(`UPDATE sx_chatbot_conversation_controls SET mode=?,pause_until=?,reason=?,revision=?,updated_by_kind='identity',updated_by_identity_id=? WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=?`, [mode, mode === 'paused' ? pauseUntil : null, mode === 'paused' ? reason : null, nextRevision, ctx.identity.id, ctx.tenant.id, channelKind, channelRef, req.params.conversationId]);
        else await db.query(`INSERT INTO sx_chatbot_conversation_controls(id,tenant_id,channel_kind,channel_ref,conversation_id,mode,pause_until,reason,revision,updated_by_kind,updated_by_identity_id) VALUES (?,?,?,?,?,?,?,?,?,'identity',?)`, [uuid(), ctx.tenant.id, channelKind, channelRef, req.params.conversationId, mode, mode === 'paused' ? pauseUntil : null, mode === 'paused' ? reason : null, nextRevision, ctx.identity.id]);
        await audit(db, ctx, 'chatbot.conversation-control-changed', req.params.conversationId, { channelKind, channelRef, from: row?.mode || 'inherit', to: mode, pauseUntil, revision: nextRevision });
        await db.commit(); return { mode, pauseUntil: mode === 'paused' ? pauseUntil : null, reason: mode === 'paused' ? reason : null, revision: nextRevision, channelKind, channelRef };
      } catch (error) { await db.rollback(); throw error; }
    });
    res.json({ success: true, data });
  }));
  router.delete('/:id', wrap(async (req, res) => {
    const ctx = context(req); if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) fail('INVALID_ID');
    const data = await withDb(async db => {
      await db.beginTransaction(); try {
      const [[row]] = await db.query(`SELECT status FROM sx_chatbot_profiles WHERE tenant_id=? AND id=? FOR UPDATE`, [ctx.tenant.id, req.params.id]);
      if (!row) fail('BOT_NOT_FOUND'); if (row.status === 'live') fail('LIVE_BOT_MUST_BE_PAUSED');
      await db.query(`DELETE FROM sx_chatbot_profiles WHERE tenant_id=? AND id=?`, [ctx.tenant.id, req.params.id]);
      await audit(db, ctx, 'chatbot.profile-deleted', req.params.id, {}); await db.commit(); return { id: req.params.id, deleted: true };
      } catch (error) { await db.rollback(); throw error; }
    }); res.json({ success: true, data });
  }));
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const code = error.code || 'CHATBOT_UNAVAILABLE';
    const status = ['PERMISSION_DENIED'].includes(code) ? 403 : ['TENANT_CONTEXT_REQUIRED','VERIFIED_BUSINESS_OWNER_REQUIRED'].includes(code) ? 403 : ['BOT_NOT_FOUND','CONVERSATION_NOT_FOUND'].includes(code) ? 404 : ['STALE_REVISION','LIVE_BOT_MUST_BE_PAUSED','CATEGORY_UNAVAILABLE','CATEGORY_GUIDED_FLOW_UNAVAILABLE','FEATURE_UNAVAILABLE','ER_DUP_ENTRY','BOT_CHANNEL_REQUIRED','CONNECTED_CHANNEL_NOT_FOUND','GUIDED_FLOW_REQUIRED','GUIDED_FLOW_UNAVAILABLE','AI_PROVIDER_NOT_CONFIGURED','PROVIDER_KEY_REQUIRED','AI_DATA_PROCESSING_ACK_REQUIRED'].includes(code) ? 409 : code.startsWith('INVALID_') || code === 'DUPLICATE_CHANNEL' ? 400 : 503;
    res.status(status).json({ success: false, code: status >= 500 ? 'CHATBOT_UNAVAILABLE' : code === 'ER_DUP_ENTRY' ? 'CHANNEL_ALREADY_ASSIGNED' : code });
  });
  return router;
}
module.exports = { createChatbotRouter, botInput };
