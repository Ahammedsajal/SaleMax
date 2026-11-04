'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../modules/platform/tenant-ai-settings');
const secrets = require('../modules/platform/chatbot-secrets');

function fakeDb(initialActive, initialProfiles = []) {
  let active = initialActive ? { ...initialActive } : null;
  const profiles = new Map(initialProfiles.map(profile => [profile.provider, { ...profile }]));
  const statements = [];
  const db = {
    statements,
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    async query(sql, params = []) {
      statements.push(sql);
      if (/^SELECT id FROM sx_tenants/.test(sql)) return [[{ id: params[0] }]];
      if (/FROM sx_chatbot_provider_configs/.test(sql)) return [[active ? { ...active } : null]];
      if (/FROM sx_chatbot_provider_profiles WHERE tenant_id=\? AND provider=\?/.test(sql)) return [[profiles.get(params[1]) || null]];
      if (/FROM sx_chatbot_provider_profiles WHERE tenant_id=\?/.test(sql)) return [[...profiles.values()].map(({ provider, model, revision, updatedAt }) => ({ provider, model, revision, updatedAt }))];
      if (/^INSERT INTO sx_chatbot_provider_profiles/.test(sql)) {
        const [tenantId, provider, model, key_ciphertext, key_iv, key_auth_tag, revision] = params;
        profiles.set(provider, { tenant_id: tenantId, provider, model, key_ciphertext, key_iv, key_auth_tag, revision, updatedAt: '2026-11-04 00:00:00' });
        return [{ affectedRows: 1 }];
      }
      if (/^UPDATE sx_chatbot_provider_profiles/.test(sql)) {
        const [model, key_ciphertext, key_iv, key_auth_tag, revision, _identityId, _tenantId, provider] = params;
        profiles.set(provider, { ...profiles.get(provider), model, key_ciphertext, key_iv, key_auth_tag, revision, updatedAt: '2026-11-04 00:00:00' });
        return [{ affectedRows: 1 }];
      }
      if (/^UPDATE sx_chatbot_provider_configs/.test(sql)) {
        const [provider, model, key_ciphertext, key_iv, key_auth_tag, daily_token_limit, revision] = params;
        active = { ...active, provider, model, key_ciphertext, key_iv, key_auth_tag, dailyTokenLimit: daily_token_limit, daily_token_limit, revision };
        return [{ affectedRows: 1 }];
      }
      if (/^INSERT INTO sx_chatbot_provider_configs/.test(sql)) {
        const [tenantId, provider, model, key_ciphertext, key_iv, key_auth_tag, daily_token_limit, revision] = params;
        active = { tenantId, provider, model, key_ciphertext, key_iv, key_auth_tag, dailyTokenLimit: daily_token_limit, daily_token_limit, revision };
        return [{ affectedRows: 1 }];
      }
      if (/^INSERT INTO sx_audit_events/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error('Unexpected provider settings query: ' + sql);
    },
  };
  return { db, profiles, get active() { return active; } };
}

test('settings expose saved provider status without returning encrypted credentials or checking bot status', async () => {
  const priorKey = process.env.SALEMAX_PLATFORM_KEY_BASE64;
  process.env.SALEMAX_PLATFORM_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');
  try {
    const encrypted = secrets.encrypt('openai-test-key-0123456789');
    const state = fakeDb({ provider: 'openai', model: 'gpt-6-luna', dailyTokenLimit: 50000, revision: 3, updatedAt: '2026-11-04' }, [
      { provider: 'openai', model: 'gpt-6-luna', revision: 1, updatedAt: '2026-11-04', key_ciphertext: encrypted.ciphertext, key_iv: encrypted.iv, key_auth_tag: encrypted.authTag },
    ]);
    const result = await settings.read(state.db, 'tenant-1');
    const openai = result.providers.find(provider => provider.id === 'openai');
    const gemini = result.providers.find(provider => provider.id === 'gemini');
    assert.equal(openai.active, true);
    assert.equal(openai.configured, true);
    assert.equal(gemini.configured, false);
    assert.equal(result.lockedByLiveBot, undefined);
    assert.doesNotMatch(JSON.stringify(result), /openai-test-key|key_ciphertext|key_auth_tag/);
    assert.equal(state.db.statements.some(sql => /sx_chatbot_profiles/.test(sql)), false);
  } finally {
    if (priorKey === undefined) delete process.env.SALEMAX_PLATFORM_KEY_BASE64;
    else process.env.SALEMAX_PLATFORM_KEY_BASE64 = priorKey;
  }
});

test('owners can save inactive provider credentials and activate the saved profile while live bot checks are absent', async () => {
  const priorKey = process.env.SALEMAX_PLATFORM_KEY_BASE64;
  process.env.SALEMAX_PLATFORM_KEY_BASE64 = Buffer.alloc(32, 9).toString('base64');
  try {
    const openaiKey = secrets.encrypt('openai-test-key-0123456789');
    const deepseekKey = secrets.encrypt('deepseek-test-key-0123456789');
    const state = fakeDb({
      tenantId: 'tenant-1', provider: 'openai', model: 'gpt-6-luna', dailyTokenLimit: 50000, daily_token_limit: 50000,
      revision: 4, key_ciphertext: openaiKey.ciphertext, key_iv: openaiKey.iv, key_auth_tag: openaiKey.authTag,
    }, [
      { provider: 'openai', model: 'gpt-6-luna', revision: 1, updatedAt: '2026-11-04', key_ciphertext: openaiKey.ciphertext, key_iv: openaiKey.iv, key_auth_tag: openaiKey.authTag },
      { provider: 'deepseek', model: 'deepseek-flash', revision: 2, updatedAt: '2026-11-04', key_ciphertext: deepseekKey.ciphertext, key_iv: deepseekKey.iv, key_auth_tag: deepseekKey.authTag },
    ]);
    const ctx = { tenant: { id: 'tenant-1' }, identity: { id: 'owner-1' } };
    const saved = await settings.save(state.db, ctx, {
      action: 'save-provider', provider: 'gemini', model: 'gemini-3.1-flash-lite', apiKey: 'gemini-test-key-0123456789',
      expectedRevision: 4, expectedProviderRevision: 0,
    });
    assert.equal(state.active.provider, 'openai', 'saving an inactive provider must not switch it');
    assert.equal(saved.providers.find(provider => provider.id === 'gemini').configured, true);
    assert.doesNotMatch(JSON.stringify(saved), /gemini-test-key|key_ciphertext|key_auth_tag/);

    const switched = await settings.save(state.db, ctx, {
      action: 'activate-provider', provider: 'deepseek', expectedRevision: 4, expectedProviderRevision: 2,
    });
    assert.equal(switched.provider, 'deepseek');
    assert.equal(state.active.provider, 'deepseek');
    const runtime = await settings.forRuntime(state.db, 'tenant-1');
    assert.equal(runtime.provider, 'deepseek');
    assert.equal(runtime.apiKey, 'deepseek-test-key-0123456789');
    assert.equal(state.db.statements.some(sql => /sx_chatbot_profiles/.test(sql)), false);
  } finally {
    if (priorKey === undefined) delete process.env.SALEMAX_PLATFORM_KEY_BASE64;
    else process.env.SALEMAX_PLATFORM_KEY_BASE64 = priorKey;
  }
});

test('the existing AI Integrations screen provides profile save and activation without a live-bot lock', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../client/public/ai-integrations.js'), 'utf8');
  assert.match(source, /data-ai-save-profile/);
  assert.match(source, /data-ai-save-activate/);
  assert.match(source, /data-ai-activate/);
  assert.match(source, /profile\?\.savedModel/);
  assert.match(source, /expectedProviderRevision/);
  assert.doesNotMatch(source, /LIVE_BOT_MUST_BE_PAUSED|Pause active bots|lockedByLiveBot/);
  assert.match(source, /Usage this month/);
  assert.match(source, /Prompt caching/);
});
