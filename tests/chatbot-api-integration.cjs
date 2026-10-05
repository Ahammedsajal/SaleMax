'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

module.exports = async function chatbotApiIntegration(connection, pool, { t1, t2, i1, i2, m1, m2 }) {
  const previousKey = process.env.SALEMAX_PLATFORM_KEY_BASE64;
  process.env.SALEMAX_PLATFORM_KEY_BASE64 = Buffer.alloc(32, 31).toString('base64');
  const provider = require('../modules/platform/chatbot-provider');
  const originalGenerate = provider.generate;
  let providerCalls = 0;
  let previewInput = '';
  let failNextProvider = false;
  provider.generate = async request => {
    providerCalls++;
    previewInput = request.user;
    if (failNextProvider) {
      failNextProvider = false;
      throw Object.assign(new Error('synthetic malformed provider output'), { code: 'AI_PROVIDER_INVALID_OUTPUT' });
    }
    return { canAnswer: true, confidence: 0.96, reply: 'Our approved course information is available.', inputTokens: 31, outputTokens: 14 };
  };

  const express = require('express');
  const { createChatbotRouter } = require('../modules/platform/chatbot-router');
  const { getCategory } = require('../modules/platform/categories');
  const legacyUid = `chatbot-test-${crypto.randomUUID()}`;
  const channelRef = `chatbot-test-${crypto.randomUUID()}`;
  const conversationId = `chatbot-test-${crypto.randomUUID()}`;
  const faqAnswer = 'Synthetic approved answer: classroom training runs in the evening.';
  const contextFor = (tenantId, identityId, membershipId, role = 'owner') => ({
    audience: 'tenant', identity: { id: identityId, status: 'active' },
    tenant: { id: tenantId, status: 'active', categoryKey: 'training_center', categoryVersion: 1 },
    membership: { id: membershipId, tenantId, role, status: 'active', delegatedPermissions: [] },
    category: getCategory('training_center', 1),
    subscription: { status: 'active', capabilities: ['automation.chatbot'] }, runtimeReady: {},
  });

  let server;
  const sendModulePath = require.resolve('../automation/functions');
  const previousSendModule = require.cache[sendModulePath];
  const sentMessages = [];
  try {
    const [columns] = await connection.query('SHOW COLUMNS FROM instance');
    const columnNames = new Set(columns.map(column => column.Field));
    for (const [name, definition] of [['uid', 'VARCHAR(999) NULL'], ['uniqueId', 'VARCHAR(160) NULL'], ['number', 'VARCHAR(80) NULL']]) {
      if (!columnNames.has(name)) await connection.query(`ALTER TABLE instance ADD COLUMN ${name} ${definition}`);
    }
    await connection.query('UPDATE instance SET uid=?,uniqueId=?,number=?,status=? WHERE id=1', [legacyUid, channelRef, '+97455000001', 'ACTIVE']);
    await connection.query(`CREATE TABLE IF NOT EXISTS beta_chats (
      uid VARCHAR(999) NOT NULL,chat_id VARCHAR(999) NOT NULL,
      last_message LONGTEXT NULL,last_message_came BIGINT NULL,
      KEY chatbot_test_chat_lookup(uid(191),chat_id(191))
    ) ENGINE=InnoDB`);
    const [chatColumns] = await connection.query('SHOW COLUMNS FROM beta_chats');
    const chatColumnNames = new Set(chatColumns.map(column => column.Field));
    if (!chatColumnNames.has('last_message')) await connection.query('ALTER TABLE beta_chats ADD COLUMN last_message LONGTEXT NULL');
    if (!chatColumnNames.has('last_message_came')) await connection.query('ALTER TABLE beta_chats ADD COLUMN last_message_came BIGINT NULL');
    await connection.query(`CREATE TABLE IF NOT EXISTS beta_conversation (
      uid VARCHAR(999) NOT NULL,chat_id VARCHAR(999) NOT NULL,type VARCHAR(40) NOT NULL,
      metaChatId VARCHAR(255) NULL,msgContext JSON NULL,reaction VARCHAR(80) NULL,timestamp BIGINT NULL,
      senderName VARCHAR(200) NULL,senderMobile VARCHAR(80) NULL,star TINYINT NULL,route VARCHAR(20) NULL,
      context JSON NULL,origin VARCHAR(30) NULL,sentBy VARCHAR(40) NULL,
      KEY chatbot_test_conversation_lookup(uid(191),chat_id(191),timestamp)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await connection.query(`CREATE TABLE IF NOT EXISTS meta_api (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,uid VARCHAR(999) NOT NULL,
      business_phone_number_id VARCHAR(160) NULL,embed_data LONGTEXT NULL
    ) ENGINE=InnoDB`);
    const [metaColumns] = await connection.query('SHOW COLUMNS FROM meta_api');
    if (!metaColumns.some(column => column.Field === 'embed_data')) await connection.query('ALTER TABLE meta_api ADD COLUMN embed_data LONGTEXT NULL');
    await connection.query('INSERT INTO meta_api(uid,business_phone_number_id,embed_data) VALUES (?,?,?)', [legacyUid, 'synthetic-meta-phone-id', JSON.stringify({ phoneDetails: { display_phone_number: '+97455000003' } })]);
    await connection.query(`CREATE TABLE IF NOT EXISTS beta_flows (
      uid VARCHAR(999) NOT NULL,flow_id VARCHAR(80) NOT NULL,data JSON NOT NULL,
      source VARCHAR(40) NOT NULL,is_active TINYINT(1) NOT NULL
    ) ENGINE=InnoDB`);
    const guidedFlowId = 'synthetic-guided-flow';
    await connection.query('INSERT INTO beta_flows(uid,flow_id,data,source,is_active) VALUES (?,?,?,\'wa_chatbot\',1)', [legacyUid, guidedFlowId, JSON.stringify({ nodes: [{ id: 'initialNode', type: 'INITIAL' }, { id: 'reply', type: 'SEND_MESSAGE' }], edges: [{ id: 'start-reply', source: 'initialNode', target: 'reply' }] })]);
    await connection.query('INSERT INTO beta_chats(uid,chat_id) VALUES (?,?)', [legacyUid, conversationId]);

    const app = express();
    app.use('/api/user/chatbots', createChatbotRouter({
      pool, origin: 'https://chatbot.test',
      userGuard: (req, res, next) => { req.decode = { uid: legacyUid }; next(); },
      canonicalGuard: (req, res, next) => {
        const other = req.get('X-Test-Tenant') === t2;
        req.businessContext = contextFor(other ? t2 : t1, other ? i2 : i1, other ? m2 : m1, req.get('X-Test-Role') || 'owner');
        req.decode = { uid: legacyUid };
        next();
      },
    }));
    await new Promise((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', resolve);
      server.once('error', reject);
    });
    const base = `http://127.0.0.1:${server.address().port}/api/user/chatbots`;
    const call = async (path, method = 'GET', body, headers = {}) => {
      const response = await fetch(base + path, {
        method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { Origin: 'https://chatbot.test' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      let payload = {};
      try { payload = await response.json(); } catch {}
      return { status: response.status, ...payload };
    };

    const created = await call('/', 'POST', {
      name: 'Synthetic Training FAQ', engine: 'ai', config: {
        instructions: 'Answer only from approved course facts.', confidenceThreshold: 0.72,
        aiDataProcessingConfirmed: true,
        knowledgeEntries: [{ questionEn: 'When are classes?', answerEn: faqAnswer, questionAr: 'متى الدروس؟', answerAr: 'المساء' }],
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.status, 'draft');
    const botId = created.data.id;

    const listed = await call('/');
    assert.equal(listed.status, 200);
    assert.equal(listed.data.items.some(bot => bot.id === botId && bot.engine === 'ai' && bot.status === 'draft'), true);
    const otherList = await call('/', 'GET', undefined, { 'X-Test-Tenant': t2 });
    assert.equal(otherList.data.items.some(bot => bot.id === botId), false);
    const flows = await call('/flows');
    assert.equal(flows.status, 200);
    assert.equal(flows.data.some(flow => flow.id === guidedFlowId), true);
    const runtime = require('../modules/platform/chatbot-runtime');
    assert.ok(await runtime.loadGuidedFlow(legacyUid, guidedFlowId), 'guided flow lookup uses the application DB wrapper row contract');

    const stale = await call(`/${botId}`, 'PUT', { name: 'Stale edit', engine: 'ai', config: {}, expectedRevision: 99 });
    assert.equal(stale.status, 409);
    const unauthorized = await call('/', 'GET', undefined, { 'X-Test-Role': 'agent' });
    assert.equal(unauthorized.status, 403);
    const originDenied = await fetch(base + '/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    assert.equal(originDenied.status, 403);

    const providerConfig = await call('/settings/provider', 'PUT', {
      provider: 'openai', model: 'gpt-test', apiKey: 'synthetic-provider-key-0123456789', expectedRevision: 0, dailyTokenLimit: 10000,
    });
    assert.equal(providerConfig.status, 200);
    assert.equal(providerConfig.data.maskedKey, '••••••••');
    const providerRead = await call('/settings/provider');
    assert.equal(providerRead.data.configured, true);
    assert.equal(JSON.stringify(providerRead).includes('synthetic-provider-key'), false);
    const [[storedKey]] = await connection.query('SELECT key_ciphertext,key_iv,key_auth_tag FROM sx_chatbot_provider_configs WHERE tenant_id=?', [t1]);
    assert.ok(Buffer.from(storedKey.key_ciphertext).length > 0);
    assert.notEqual(Buffer.from(storedKey.key_ciphertext).toString(), 'synthetic-provider-key-0123456789');

    const preview = await call(`/${botId}/preview`, 'POST', { message: 'When are classes?', expectedRevision: 1 });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.canAnswer, true);
    assert.equal(preview.data.reply, 'Our approved course information is available.');
    assert.equal(providerCalls, 1);
    assert.ok(previewInput.includes(faqAnswer));
    const [[turnCount]] = await connection.query('SELECT COUNT(*) AS count FROM sx_chatbot_turns WHERE tenant_id=?', [t1]);
    assert.equal(Number(turnCount.count), 0, 'preview does not create inbound WhatsApp turns');

    const previewCourseId = crypto.randomUUID();
    await connection.query(`INSERT INTO sx_training_courses(id,tenant_id,code,name_en,name_ar,description_en,description_ar,duration_value,duration_unit,delivery_mode,status,created_by_identity_id,updated_by_identity_id)
      VALUES (?,?, 'PREVIEW-01','Synthetic Preview Course','دورة المعاينة','Published description for preview','وصف منشور للمعاينة',12,'weeks','hybrid','active',?,?)`, [previewCourseId, t1, i1, i1]);
    await connection.query(`INSERT INTO sx_training_offers(id,tenant_id,course_id,version,currency,price_minor,registration_fee_minor,inclusions,status,created_by_identity_id)
      VALUES (?,?,?,1,'QAR',42000,5000,JSON_ARRAY(),'active',?)`, [crypto.randomUUID(), t1, previewCourseId, i1]);
    await connection.query(`INSERT INTO sx_training_batches(id,tenant_id,course_id,code,starts_on,ends_on,language_code,capacity,reserved_seats,status,created_by_identity_id)
      VALUES (?,?,?,'PREVIEW-BATCH',DATE_ADD(CURDATE(),INTERVAL 7 DAY),DATE_ADD(CURDATE(),INTERVAL 37 DAY),'en',15,3,'open',?)`, [crypto.randomUUID(), t1, previewCourseId, i1]);
    const [[beforeGuidedPreview]] = await connection.query(`SELECT
      (SELECT COUNT(*) FROM sx_chatbot_profiles WHERE tenant_id=?) AS profiles,
      (SELECT COUNT(*) FROM sx_chatbot_turns WHERE tenant_id=?) AS turns,
      (SELECT COUNT(*) FROM sx_audit_events WHERE tenant_id=?) AS audits`, [t1,t1,t1]);
    const guidedStart = await call('/guided-preview', 'POST', {
      message: 'hello', state: null,
      guidedContent: { messages: { greeting: { en: 'Synthetic draft greeting.' } } },
    });
    assert.equal(guidedStart.status, 200);
    assert.match(guidedStart.data.reply, /Synthetic draft greeting/);
    const guidedList = await call('/guided-preview', 'POST', { message: 'courses', state: guidedStart.data.state });
    assert.equal(guidedList.status, 200);
    assert.match(guidedList.data.reply, /Synthetic Preview Course — 420\.00 QAR/);
    const guidedDetails = await call('/guided-preview', 'POST', { message: '1', state: guidedList.data.state });
    assert.equal(guidedDetails.status, 200);
    assert.match(guidedDetails.data.reply, /Published description for preview/);
    assert.match(guidedDetails.data.reply, /50\.00 QAR/);
    assert.match(guidedDetails.data.reply, /seats available/);
    const otherGuidedPreview = await call('/guided-preview', 'POST', { message: 'courses', guidedContent: {} }, { 'X-Test-Tenant': t2 });
    assert.equal(otherGuidedPreview.status, 200);
    assert.doesNotMatch(otherGuidedPreview.data.reply, /Synthetic Preview Course|420\.00 QAR/);
    assert.equal(providerCalls, 1, 'Guided preview does not call the AI provider');
    const [[afterGuidedPreview]] = await connection.query(`SELECT
      (SELECT COUNT(*) FROM sx_chatbot_profiles WHERE tenant_id=?) AS profiles,
      (SELECT COUNT(*) FROM sx_chatbot_turns WHERE tenant_id=?) AS turns,
      (SELECT COUNT(*) FROM sx_audit_events WHERE tenant_id=?) AS audits`, [t1,t1,t1]);
    assert.deepEqual(afterGuidedPreview, beforeGuidedPreview, 'Guided preview does not write profiles, turns or audit rows');

    const channels = await call('/channels');
    const qrChannel = channels.data.find(channel => channel.kind === 'whatsapp_qr' && channel.reference === channelRef);
    assert.equal(qrChannel?.label, '+97455000001');
    const metaChannel = channels.data.find(channel => channel.kind === 'whatsapp_meta' && channel.reference === 'synthetic-meta-phone-id');
    assert.equal(metaChannel?.label, '+97455000003');
    const assigned = await call(`/${botId}/channels`, 'PUT', { expectedRevision: 1, channels: [{ kind: 'whatsapp_qr', reference: channelRef }] });
    assert.equal(assigned.status, 200);
    assert.equal(assigned.data.revision, 2);
    const activated = await call(`/${botId}/status`, 'PUT', { status: 'live', expectedRevision: 2 });
    assert.equal(activated.status, 200);
    assert.equal(activated.data.status, 'live');

    const activeEdit = await call(`/${botId}`, 'PUT', {
      name: 'Synthetic Training FAQ · revised', engine: 'ai', config: {
        instructions: 'Use the latest approved Training Center facts.', confidenceThreshold: 0.72,
        aiDataProcessingConfirmed: true,
        knowledgeEntries: [{ questionEn: 'What changed?', answerEn: 'The live profile was safely updated.', questionAr: 'ما الذي تغير؟', answerAr: 'تم تحديث إعدادات الروبوت النشط بأمان.' }],
      }, expectedRevision: 3,
    });
    assert.equal(activeEdit.status, 200, 'a live bot profile can be atomically edited without pausing its runtime');
    assert.equal(activeEdit.data.revision, 4);
    const rejectedUnsafeEdit = await call(`/${botId}`, 'PUT', {
      name: 'Unsafe live edit', engine: 'ai', config: {
        instructions: 'Updated without privacy acknowledgement.', confidenceThreshold: 0.72,
        aiDataProcessingConfirmed: false, knowledgeEntries: [],
      }, expectedRevision: 4,
    });
    assert.equal(rejectedUnsafeEdit.status, 409);
    assert.equal(rejectedUnsafeEdit.code, 'AI_DATA_PROCESSING_ACK_REQUIRED');
    const afterLiveEdit = await call('/');
    const editedBot = afterLiveEdit.data.items.find(item => item.id === botId);
    assert.equal(editedBot.status, 'live');
    assert.equal(editedBot.revision, 4);
    assert.equal(editedBot.config.instructions, 'Use the latest approved Training Center facts.');
    assert.deepEqual(editedBot.channels.map(channel => channel.reference), [channelRef], 'a live profile edit preserves its connected-number assignment');
    const liveProviderChange = await call('/settings/provider', 'PUT', {
      provider: 'openai', model: 'gpt-next', expectedRevision: 1, dailyTokenLimit: 10000,
    });
    assert.equal(liveProviderChange.status, 409);
    assert.equal(liveProviderChange.code, 'LIVE_BOT_MUST_BE_PAUSED');
    assert.equal((await call('/settings/provider')).data.model, 'gpt-test', 'a live AI bot protects its shared provider config');

    // Exercise the actual inbound dispatcher and persistence path with a fake
    // channel transport. The synthetic DB and provider are real; no WhatsApp
    // network call or customer message is made.
    const fakeAutomationModule = {
      id: sendModulePath, filename: sendModulePath, loaded: true,
      exports: { sendWaMessage: async payload => { sentMessages.push(payload); return `synthetic-outbound-${sentMessages.length}`; } },
    };
    require.cache[sendModulePath] = fakeAutomationModule;
    const [syntheticUser] = await connection.query(
      'INSERT INTO user(uid,name,plan,plan_expire,role) VALUES (?,?,?,?,?)',
      [legacyUid, 'Synthetic chatbot business', '{}', String(Date.now() + 86400000), 'user'],
    );
    await connection.query(`INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash,verified_at)
      VALUES ('user',?,?,?,?,UTC_TIMESTAMP(3))`, [String(syntheticUser.insertId), t1, m1, crypto.createHash('sha256').update(legacyUid).digest('hex')]);
    // This isolated runtime fixture needs the bot capability present in the
    // tenant's published entitlement snapshot; plan lifecycle is tested above.
    await connection.query(`UPDATE sx_plan_versions v JOIN sx_plan_assignments a ON a.plan_version_id=v.id
      SET v.capabilities=JSON_ARRAY_APPEND(v.capabilities,'$','automation.chatbot')
      WHERE a.tenant_id=? AND a.status IN ('active','trial','grace')
        AND JSON_CONTAINS(v.capabilities,JSON_QUOTE('automation.chatbot'))=0`, [t1]);
    const inbound = {
      type: 'text', route: 'INCOMING', metaChatId: `synthetic-inbound-${crypto.randomUUID()}`,
      msgContext: { type: 'text', text: { body: 'When are classes?' } },
      senderName: 'Synthetic Learner', senderMobile: '+97455000002',
    };
    const runtimeResult = await runtime.runConfiguredBot({ uid: legacyUid, message: inbound, user: { uid: legacyUid }, sessionId: channelRef, origin: 'qr', chatId: conversationId });
    assert.equal(runtimeResult.handled, true);
    assert.equal(runtimeResult.sent, true);
    assert.equal(providerCalls, 2, 'live AI runtime calls the configured provider after the separate preview call');
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].sessionId, channelRef);
    assert.equal(sentMessages[0].chatId, conversationId);
    assert.equal(sentMessages[0].content.text.body, 'Our approved course information is available.');
    const duplicateResult = await runtime.runConfiguredBot({ uid: legacyUid, message: inbound, user: { uid: legacyUid }, sessionId: channelRef, origin: 'qr', chatId: conversationId });
    assert.equal(duplicateResult.duplicate, true);
    assert.equal(sentMessages.length, 1, 'retry does not send a second customer reply');
    const [[sentTurn]] = await connection.query('SELECT status,result_class FROM sx_chatbot_turns WHERE tenant_id=? AND conversation_id=?', [t1, conversationId]);
    assert.equal(sentTurn.status, 'sent');
    assert.equal(sentTurn.result_class, 'reply-sent');

    const controlPath = `/conversations/${encodeURIComponent(conversationId)}/bot-control?channelKind=whatsapp_qr&channelRef=${encodeURIComponent(channelRef)}`;
    const pausedChat = await call(controlPath, 'PUT', { channelKind: 'whatsapp_qr', channelRef, mode: 'paused', reason: 'Synthetic test pause', expectedRevision: 0 });
    assert.equal(pausedChat.status, 200);
    assert.equal(pausedChat.data.mode, 'paused');
    const [[pausedControl]] = await connection.query('SELECT mode,revision FROM sx_chatbot_conversation_controls WHERE tenant_id=? AND conversation_id=?', [t1, conversationId]);
    assert.equal(pausedControl.mode, 'paused');
    assert.equal(Number(pausedControl.revision), 1);
    const [[control]] = await connection.query('SELECT mode,revision FROM sx_chatbot_conversation_controls WHERE tenant_id=? AND conversation_id=?', [t1, conversationId]);
    assert.equal(control.mode, 'paused');
    assert.equal(Number(control.revision), 1);
    const controlRead = await call(controlPath);
    assert.equal(controlRead.data.channelRef, channelRef);
    const pausedInbound = { ...inbound, metaChatId: `synthetic-paused-${crypto.randomUUID()}` };
    const pausedRuntime = await runtime.runConfiguredBot({ uid: legacyUid, message: pausedInbound, user: { uid: legacyUid }, sessionId: channelRef, origin: 'qr', chatId: conversationId });
    assert.equal(pausedRuntime.handled, true);
    assert.equal(pausedRuntime.paused, true);
    assert.equal(providerCalls, 2, 'a per-chat pause prevents another AI-provider request');
    assert.equal(sentMessages.length, 1, 'a per-chat pause prevents another channel send');
    const resumedChat = await call(controlPath, 'PUT', { channelKind: 'whatsapp_qr', channelRef, mode: 'inherit', expectedRevision: 1 });
    assert.equal(resumedChat.status, 200);
    const [[resumedControl]] = await connection.query('SELECT mode,revision FROM sx_chatbot_conversation_controls WHERE tenant_id=? AND conversation_id=?', [t1, conversationId]);
    assert.equal(resumedControl.mode, 'inherit');
    assert.equal(Number(resumedControl.revision), 2);

    const pausedBot = await call(`/${botId}/status`, 'PUT', { status: 'paused', expectedRevision: 4 });
    assert.equal(pausedBot.status, 200);

    const deleted = await call(`/${botId}`, 'DELETE', {});
    assert.equal(deleted.status, 200);

    // Verify the Hybrid dispatcher end to end against the isolated database:
    // the first greeting stays deterministic, while an unrelated question
    // reaches the mocked provider. The channel transport above remains fake.
    const hybrid = await call('/', 'POST', {
      name: 'Synthetic Training Hybrid', engine: 'hybrid', config: {
        guidedMode: 'domain_default', aiFallback: true,
        instructions: 'Use only approved training-center facts.', confidenceThreshold: 0.72,
        aiDataProcessingConfirmed: true, knowledgeEntries: [],
      },
    });
    assert.equal(hybrid.status, 201);
    const hybridId = hybrid.data.id;
    const hybridAssigned = await call(`/${hybridId}/channels`, 'PUT', { expectedRevision: 1, channels: [{ kind: 'whatsapp_qr', reference: channelRef }] });
    assert.equal(hybridAssigned.status, 200);
    const hybridActivated = await call(`/${hybridId}/status`, 'PUT', { status: 'live', expectedRevision: 2 });
    assert.equal(hybridActivated.status, 200);
    const hybridLiveEdit = await call(`/${hybridId}`, 'PUT', {
      name: 'Synthetic Training Hybrid · revised', engine: 'hybrid', config: {
        guidedMode: 'domain_default', aiFallback: true,
        instructions: 'Use only approved training-center facts.', confidenceThreshold: 0.72,
        aiDataProcessingConfirmed: true, knowledgeEntries: [],
        guidedContent: { messages: { greeting: { en: 'Welcome from the updated Training Center guide.' } } },
      }, expectedRevision: 3,
    });
    assert.equal(hybridLiveEdit.status, 200, 'a live Hybrid profile can update Guided copy while preserving AI readiness');
    assert.equal(hybridLiveEdit.data.revision, 4);

    const hybridConversation = `chatbot-hybrid-${crypto.randomUUID()}`;
    await connection.query('INSERT INTO beta_chats(uid,chat_id) VALUES (?,?)', [legacyUid, hybridConversation]);
    const greetingInbound = {
      type: 'text', route: 'INCOMING', metaChatId: `synthetic-hybrid-greeting-${crypto.randomUUID()}`,
      msgContext: { type: 'text', text: { body: 'Good evening' } },
      senderName: 'Synthetic Learner', senderMobile: '+97455000004',
    };
    const greetingResult = await runtime.runConfiguredBot({ uid: legacyUid, message: greetingInbound, user: { uid: legacyUid }, sessionId: channelRef, origin: 'qr', chatId: hybridConversation });
    assert.equal(greetingResult.handled, true);
    assert.equal(greetingResult.flowDispatched, true);
    assert.match(sentMessages.at(-1).content.text.body, /^Welcome from the updated Training Center guide\./);
    assert.equal(providerCalls, 2, 'Hybrid greeting is answered by the deterministic guide without a provider call');

    const hybridQuestion = {
      ...greetingInbound, metaChatId: `synthetic-hybrid-question-${crypto.randomUUID()}`,
      msgContext: { type: 'text', text: { body: 'Can you explain your refund policy?' } },
    };
    const hybridQuestionResult = await runtime.runConfiguredBot({ uid: legacyUid, message: hybridQuestion, user: { uid: legacyUid }, sessionId: channelRef, origin: 'qr', chatId: hybridConversation });
    assert.equal(hybridQuestionResult.handled, true);
    assert.equal(hybridQuestionResult.sent, true);
    assert.equal(providerCalls, 3, 'Hybrid sends an ordinary follow-up to the configured AI fallback');
    assert.equal(sentMessages.at(-1).content.text.body, 'Our approved course information is available.');
    const sentCountBeforeFailure = sentMessages.length;
    failNextProvider = true;
    const invalidOutputInbound = { ...hybridQuestion, metaChatId: `synthetic-hybrid-invalid-output-${crypto.randomUUID()}` };
    const invalidOutputResult = await runtime.runConfiguredBot({ uid: legacyUid, message: invalidOutputInbound, user: { uid: legacyUid }, sessionId: channelRef, origin: 'qr', chatId: hybridConversation });
    assert.equal(invalidOutputResult.handedOff, true);
    assert.equal(invalidOutputResult.code, 'AI_PROVIDER_INVALID_OUTPUT');
    assert.equal(sentMessages.length, sentCountBeforeFailure, 'invalid AI output is never sent to the customer');
    const [[providerFailureControl]] = await connection.query('SELECT mode,reason FROM sx_chatbot_conversation_controls WHERE tenant_id=? AND conversation_id=?', [t1, hybridConversation]);
    assert.equal(providerFailureControl.mode, 'paused');
    assert.equal(providerFailureControl.reason, 'AI_PROVIDER_INVALID_OUTPUT', 'Inbox handoff retains a useful provider failure code');
    const inboundKey = require('../modules/platform/chatbot-profile-utils').inboundMessageKey({ channelKind: 'whatsapp_qr', channelRef }, hybridConversation, invalidOutputInbound.metaChatId);
    const [[providerFailureTurn]] = await connection.query('SELECT status,result_class FROM sx_chatbot_turns WHERE tenant_id=? AND conversation_id=? AND inbound_message_id=?', [t1, hybridConversation, inboundKey]);
    assert.equal(providerFailureTurn.status, 'handed_off');
    assert.equal(providerFailureTurn.result_class, 'AI_PROVIDER_INVALID_OUTPUT');
    const hybridPaused = await call(`/${hybridId}/status`, 'PUT', { status: 'paused', expectedRevision: 4 });
    assert.equal(hybridPaused.status, 200);
    assert.equal((await call(`/${hybridId}`, 'DELETE', {})).status, 200);

    return {
      profileCrudAndRevisionConflicts: true, tenantIsolationAndPermissionChecks: true,
      providerKeyMaskedAndEncrypted: true, savedFactAiPreviewWithoutWhatsAppTurn: true,
      connectedNumberAssignmentAndActivation: true, perConversationPauseResume: true,
      liveInboundAiResponseWithFakeChannelTransport: true, inboundRetryIdempotency: true,
      pausedConversationSuppressesAiAndChannelSend: true, liveProfileEditsAreAtomicAndPreserveActivationSafety: true,
      hybridDeterministicGreetingAndAiFallbackWithFakeChannelTransport: true, liveHybridGuidedCopyEditAppliedToNextTurn: true,
      hybridProviderInvalidOutputIsHumanReadableAndNeverSent: true,
      guidedFlowOptionsAndRuntimeLookup: true, guidedPreviewUsesTenantPublishedFactsWithoutWritesOrProviderCalls: true,
    };
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    provider.generate = originalGenerate;
    if (previousKey === undefined) delete process.env.SALEMAX_PLATFORM_KEY_BASE64;
    else process.env.SALEMAX_PLATFORM_KEY_BASE64 = previousKey;
    if (previousSendModule) require.cache[sendModulePath] = previousSendModule;
    else delete require.cache[sendModulePath];
  }
};
