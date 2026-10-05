'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { executionFlowId, inboundMessageKey, parseGuidedFlow } = require('../modules/platform/chatbot-profile-utils');
const { splitSql } = require('../database/migration-runner');
const { encrypt, decrypt } = require('../modules/platform/chatbot-secrets');
const { registerDomainPack, getDomainPack, publicFormUrl, amountFromMinorUnits } = require('../modules/platform/chatbot-domain-packs');
const { botInput, botRequirements, supportsAiPreview, isGuidedChoice, hybridTurnPlan } = require('../modules/platform/chatbot-config');
const { trainingCenter, restaurantFixture, supportsBusinessCapability } = require('../modules/platform/categories');
const platformPlans = require('../modules/platform/plans');
const { legacyChatbotContext } = require('../modules/platform/chatbot-identity');

let pauseRows = [], pauseError = null, pauseQueryCalls = 0, pauseLastSql = '', pauseLastParams = [];
const dbPromisePath = require.resolve('../database/dbpromise');
require.cache[dbPromisePath] = { id: dbPromisePath, filename: dbPromisePath, loaded: true, exports: { query: async (sql, params) => { pauseQueryCalls++; pauseLastSql = sql; pauseLastParams = params; if (pauseError) throw pauseError; return pauseRows; } } };
const { shouldPause } = require('../modules/platform/chatbot-conversation-control');

test('guided-flow state key is stable and isolated by bot profile and connected channel', () => {
  const profile = { id: 'profile-a', channelRef: 'wa-100' };
  const key = executionFlowId(profile);
  assert.match(key, /^sx_[a-f0-9]{32}$/);
  assert.equal(executionFlowId(profile), key);
  assert.notEqual(executionFlowId({ ...profile, id: 'profile-b' }), key);
  assert.notEqual(executionFlowId({ ...profile, channelRef: 'wa-200' }), key);
  assert.throws(() => executionFlowId({ id: 'profile-a' }), /CHATBOT_PROFILE_CHANNEL_REQUIRED/);
});

test('inbound idempotency survives bot reassignment but remains isolated by channel and chat', () => {
  const channel = { channelKind: 'whatsapp_qr', channelRef: 'wa-100' };
  const key = inboundMessageKey({ ...channel, id: 'bot-a' }, 'chat-1', 'provider-message-1');
  assert.equal(inboundMessageKey({ ...channel, id: 'bot-b' }, 'chat-1', 'provider-message-1'), key);
  assert.notEqual(inboundMessageKey({ ...channel, channelRef: 'wa-200' }, 'chat-1', 'provider-message-1'), key);
  assert.notEqual(inboundMessageKey(channel, 'chat-2', 'provider-message-1'), key);
  assert.notEqual(inboundMessageKey(channel, 'chat-1', 'provider-message-2'), key);
});

test('guided flow accepts supported nodes and rejects executable or malformed graphs', () => {
  const safe = { data: { nodes: [{ id: 'initialNode', type: 'INITIAL' }, { id: 'reply', type: 'SEND_MESSAGE' }], edges: [] } };
  assert.deepEqual(parseGuidedFlow(safe).nodes, safe.data.nodes);
  assert.equal(parseGuidedFlow({ data: { ...safe.data, nodes: [...safe.data.nodes, { id: 'danger', type: 'HTTP_REQUEST' }] } }), null);
  assert.equal(parseGuidedFlow({ data: { ...safe.data, nodes: safe.data.nodes.slice(0, 1) } }), null);
  assert.equal(parseGuidedFlow({ data: '{broken json' }), null);
  assert.equal(parseGuidedFlow({ data: { ...safe.data, nodes: Array(121).fill({ id: 'x', type: 'SEND_MESSAGE' }) } }), null);
});

test('chatbot migration defines tenant-bound profiles, unique number assignment and per-chat pause state', () => {
  const file = path.join(__dirname, '../database/migrations/20261030_chatbot_profiles.sql');
  const sql = fs.readFileSync(file, 'utf8');
  const statements = splitSql(sql);
  assert.equal(statements.length, 6);
  assert.match(sql, /UNIQUE KEY sx_chatbot_channel_unique \(tenant_id, channel_kind, channel_ref\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, chatbot_id\) REFERENCES sx_chatbot_profiles\(tenant_id, id\) ON DELETE CASCADE/);
  assert.match(sql, /UNIQUE KEY sx_chatbot_conversation_control_key \(tenant_id, channel_kind, channel_ref, conversation_id\)/);
  assert.match(sql, /UNIQUE KEY sx_chatbot_turn_idempotency \(tenant_id, inbound_message_id\)/);
  assert.match(sql, /updated_by_kind='identity'.*updated_by_identity_id IS NOT NULL/s);
});

test('training-center bot validation produces a bounded reusable category profile', () => {
  const bot = botInput({ name: ' Admissions ', engine: 'hybrid', config: {
    flowId: 'admissions_1', aiFallback: true, confidenceThreshold: 0.8,
    instructions: 'Use the approved course facts.', aiDataProcessingConfirmed: true,
    knowledgeEntries: [{ questionEn: 'Fees?', answerEn: 'Check current course offers.', questionAr: 'الرسوم؟', answerAr: 'تحقق من العروض.' }],
    untrustedProviderKey: 'must-not-be-stored-in-profile'
  } }, 'training_center');
  assert.equal(bot.name, 'Admissions');
  assert.equal(bot.config.domainPack, 'training_center');
  assert.equal(bot.config.workflow, 'course_admissions');
  assert.deepEqual(bot.config.collect, ['name', 'course_interest', 'preferred_schedule', 'phone', 'consent']);
  assert.equal(bot.config.flowId, 'admissions_1');
  assert.equal(bot.config.aiFallback, true);
  assert.equal(Object.hasOwn(bot.config, 'untrustedProviderKey'), false);
  assert.throws(() => botInput({ name: 'Bad', engine: 'ai', config: { confidenceThreshold: 0.1 } }, 'training_center'), { code: 'INVALID_CONFIDENCE_THRESHOLD' });
  assert.throws(() => botInput({ name: 'Bad', engine: 'guided', config: { flowId: '../unsafe' } }, 'training_center'), { code: 'INVALID_FLOW_ID' });
  assert.deepEqual(botRequirements('guided'), { requiresGuidedFlow: true, requiresAi: false });
  assert.deepEqual(botRequirements('hybrid', { aiFallback: true }), { requiresGuidedFlow: true, requiresAi: true });
  assert.deepEqual(botRequirements('hybrid', { aiFallback: false }), { requiresGuidedFlow: true, requiresAi: false });
  assert.deepEqual(botRequirements('ai'), { requiresGuidedFlow: false, requiresAi: true });
});

test('chatbot category access is enabled by the category registry capability contract', () => {
  assert.equal(supportsBusinessCapability(trainingCenter, 'automation.chatbot'), true);
  assert.equal(supportsBusinessCapability(restaurantFixture, 'automation.chatbot'), false);
  const futureCategory = Object.freeze({ key: 'future_service', version: 1, public: true, capabilities: Object.freeze(['automation.chatbot']) });
  assert.equal(supportsBusinessCapability(futureCategory, 'automation.chatbot'), true);
  assert.equal(supportsBusinessCapability({ ...futureCategory, public: false }, 'automation.chatbot'), false);
  assert.equal(supportsBusinessCapability({ ...futureCategory, capabilities: [] }, 'automation.chatbot'), false);
});

test('legacy chatbot authentication resolves tenant category and rejects unpublished fixtures', async () => {
  const previousLoadEntitlements = platformPlans.loadEntitlements;
  platformPlans.loadEntitlements = async () => ({ status: 'active', capabilities: ['automation.chatbot'] });
  const ownerUid = 'synthetic-owner-token';
  const row = {
    tenantId: 'tenant-1', tenantStatus: 'active', categoryKey: trainingCenter.key, categoryVersion: trainingCenter.version,
    membershipId: 'membership-1', identityId: 'identity-1', role: 'owner', membershipStatus: 'active', identityStatus: 'active',
    uidHash: crypto.createHash('sha256').update(ownerUid).digest('hex')
  };
  const poolFor = value => ({ getConnection: async () => ({ query: async () => [[value]], release() {} }) });
  try {
    const context = await legacyChatbotContext(poolFor(row), ownerUid);
    assert.equal(context.category.key, trainingCenter.key);
    assert.equal(context.tenant.categoryVersion, trainingCenter.version);
    await assert.rejects(legacyChatbotContext(poolFor({ ...row, categoryKey: restaurantFixture.key, categoryVersion: restaurantFixture.version }), ownerUid), { code: 'CATEGORY_UNAVAILABLE' });
  } finally { platformPlans.loadEntitlements = previousLoadEntitlements; }
});

test('hybrid routing keeps new chats and menu choices guided, then permits AI only when enabled', () => {
  assert.equal(isGuidedChoice(' 2 '), true);
  assert.equal(isGuidedChoice('القائمة'), true);
  assert.equal(isGuidedChoice('I need course details'), false);
  assert.deepEqual(hybridTurnPlan({ hasSession: false, isChoice: false, aiFallback: true }), { runGuided: true, allowAiFallback: true });
  assert.deepEqual(hybridTurnPlan({ hasSession: true, isChoice: true, aiFallback: true }), { runGuided: true, allowAiFallback: true });
  assert.deepEqual(hybridTurnPlan({ hasSession: true, isChoice: false, aiFallback: true }), { runGuided: false, allowAiFallback: true });
  assert.deepEqual(hybridTurnPlan({ hasSession: true, isChoice: false, aiFallback: false }), { runGuided: true, allowAiFallback: false });
});

test('AI preview is available only for AI-capable bot configurations', () => {
  assert.equal(supportsAiPreview('ai', {}), true);
  assert.equal(supportsAiPreview('hybrid', { aiFallback: true }), true);
  assert.equal(supportsAiPreview('hybrid', { aiFallback: false }), false);
  assert.equal(supportsAiPreview('guided', {}), false);
});

test('provider credential encryption round-trips and detects ciphertext tampering', () => {
  const previous = process.env.SALEMAX_PLATFORM_KEY_BASE64;
  process.env.SALEMAX_PLATFORM_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');
  try {
    const encrypted = encrypt('sk-test-credential-123456');
    const row = { key_ciphertext: encrypted.ciphertext, key_iv: encrypted.iv, key_auth_tag: encrypted.authTag };
    assert.equal(decrypt(row), 'sk-test-credential-123456');
    const altered = { ...row, key_ciphertext: Buffer.from(row.key_ciphertext) };
    altered.key_ciphertext[0] ^= 1;
    assert.throws(() => decrypt(altered));
  } finally {
    if (previous === undefined) delete process.env.SALEMAX_PLATFORM_KEY_BASE64;
    else process.env.SALEMAX_PLATFORM_KEY_BASE64 = previous;
  }
});

test('per-chat pause is scoped to its connected channel and fails closed on lookup errors', async () => {
  pauseError = null; pauseRows = [{ mode: 'paused' }];
  assert.equal(await shouldPause('legacy-uid', 'chat-1', 'whatsapp_qr', 'number-a'), true);
  assert.match(pauseLastSql, /c\.channel_kind=\?/);
  assert.match(pauseLastSql, /c\.channel_ref=\?/);
  assert.equal(pauseLastParams[2], 'chat-1');
  assert.equal(pauseLastParams[3], 'whatsapp_qr');
  assert.equal(pauseLastParams[4], 'number-a');
  pauseRows = [{ mode: 'paused' }, { mode: 'paused' }]; assert.equal(await shouldPause('legacy-uid', 'chat-1', 'whatsapp_qr', 'number-a'), true);
  pauseRows = []; assert.equal(await shouldPause('legacy-uid', 'chat-1', 'whatsapp_qr', 'number-b'), false);
  const calls = pauseQueryCalls; assert.equal(await shouldPause('', 'chat-1', 'whatsapp_qr', 'number-a'), false); assert.equal(pauseQueryCalls, calls);
  pauseError = Object.assign(new Error('missing'), { code: 'ER_NO_SUCH_TABLE' });
  assert.equal(await shouldPause('legacy-uid', 'chat-1', 'whatsapp_qr', 'number-a'), false);
  pauseError = Object.assign(new Error('database unavailable'), { code: 'ECONNREFUSED' });
  assert.equal(await shouldPause('legacy-uid', 'chat-1', 'whatsapp_qr', 'number-a'), true);
  pauseError = null;
});

test('category domain packs use versioned training retrieval and safe FAQ-only fallback', async () => {
  const training = getDomainPack('training_center', 1);
  const calls = [];
  const db = { async query(sql) {
    calls.push(sql);
    if (sql.includes('sx_training_courses')) return [[{ courseId: 'course-1', code: 'EN-1', nameEn: 'English', offer: '{"currency":"QAR","priceMinor":35000,"registrationFeeMinor":1000}', batches: '[]' }]];
    if (sql.includes('sx_training_batches')) return [[]];
    return [[{ tenantSlug: 'center-1', formSlug: 'apply' }]];
  } };
  const facts = await training.loadFacts({ db, tenantId: 'tenant-1', platformOrigin: 'https://crm.salemax.qa' });
  assert.equal(facts[0].code, 'EN-1');
  assert.deepEqual(facts[0].offer, { currency: 'QAR', priceAmount: '350.00', registrationFeeAmount: '10.00' });
  assert.equal(facts.at(-1).url, 'https://crm.salemax.qa/p/center-1/forms/apply');
  assert.equal(calls.length, 3);
  const faqOnly = getDomainPack('future_category', 4);
  assert.equal(faqOnly.key, 'faq_only');
  assert.deepEqual(await faqOnly.loadFacts({}), []);
  assert.match(faqOnly.systemGuidance, /tenant-approved FAQ/);
  const custom = registerDomainPack({ key: 'future_category', version: 4, title: 'Future category', systemGuidance: 'Use reviewed category facts only.', loadFacts: async () => [{ approved: true }] });
  assert.equal(getDomainPack('future_category', 4), custom);
  assert.equal(custom.requiresDatabase, false);
  assert.throws(() => registerDomainPack({ ...custom }), { code: 'CHATBOT_DOMAIN_PACK_ALREADY_REGISTERED' });
});

test('AI training facts convert offer minor units using the currency exponent', () => {
  assert.equal(amountFromMinorUnits(35000, 'QAR'), '350.00');
  assert.equal(amountFromMinorUnits(1234, 'KWD'), '1.234');
  assert.equal(amountFromMinorUnits(105, 'JPY'), '105');
  assert.equal(amountFromMinorUnits(Number.MAX_SAFE_INTEGER + 1, 'QAR'), null);
  assert.equal(amountFromMinorUnits(35000, 'invalid'), null);
});

test('training public form links require HTTPS outside local-only loopback', () => {
  assert.equal(publicFormUrl('http://crm.salemax.qa', 'tenant', 'form'), null);
  assert.equal(publicFormUrl('https://crm.salemax.qa', 'tenant', 'form'), 'https://crm.salemax.qa/p/tenant/forms/form');
  const previous = process.env.LOCAL_ONLY_MODE;
  process.env.LOCAL_ONLY_MODE = 'true';
  try { assert.equal(publicFormUrl('http://127.0.0.1:3010', 'tenant', 'form'), 'http://127.0.0.1:3010/p/tenant/forms/form'); }
  finally { if (previous === undefined) delete process.env.LOCAL_ONLY_MODE; else process.env.LOCAL_ONLY_MODE = previous; }
});
