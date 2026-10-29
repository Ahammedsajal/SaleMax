'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const aiText = require('../modules/platform/tenant-ai-text');

test('shared text request redacts private identifiers and bounds reply history', () => {
  const request = aiText.buildRequest({
    mode: 'suggestion',
    text: 'Please call me at +974 5512 3456 or mail me@example.com',
    history: Array.from({ length: 7 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', text: `turn-${index}` })),
  });
  const input = JSON.parse(request.user);
  assert.equal(input.conversation.length, 5);
  assert.equal(input.conversation[0].text, 'turn-2');
  assert.doesNotMatch(request.user, /5512|me@example\.com/);
  assert.match(request.system, /untrusted content/);
});

test('center provider and model serve translation and settle shared token usage', async () => {
  const calls = { reserved: 0, settled: null, request: null };
  const settingsService = {
    async forRuntime(_pool, tenantId) {
      assert.equal(tenantId, 'tenant-1');
      return { provider: 'openai', model: 'gpt-center', apiKey: 'secret-in-memory', daily_token_limit: 20000 };
    },
    async reserveTokens(_pool, tenantId, limit, amount) {
      assert.equal(tenantId, 'tenant-1');
      assert.equal(limit, 20000);
      calls.reserved = amount;
      return { usageDate: '2026-10-29', amount };
    },
    async settleTokens(_pool, tenantId, reservation, used) {
      calls.settled = { tenantId, reservation, used };
    },
  };
  const providerService = {
    async generate(request) {
      calls.request = request;
      return { canAnswer: true, confidence: 1, reply: 'مرحبا', inputTokens: 42, outputTokens: 3 };
    },
  };
  const result = await aiText.generate({ pool: {}, tenantId: 'tenant-1', mode: 'translation', text: 'Hello', targetLanguage: 'Arabic' }, { settingsService, providerService });
  assert.equal(result.text, 'مرحبا');
  assert.equal(calls.request.model, 'gpt-center');
  assert.equal(calls.request.apiKey, 'secret-in-memory');
  assert.ok(calls.reserved > 0);
  assert.equal(calls.settled.used, 45);
});

test('shared daily limit blocks provider calls', async () => {
  let called = false;
  const settingsService = {
    async forRuntime() { return { provider: 'openai', model: 'gpt-center', apiKey: 'secret-in-memory', daily_token_limit: 1000 }; },
    async reserveTokens() { return null; },
  };
  await assert.rejects(aiText.generate({ pool: {}, tenantId: 'tenant-1', mode: 'suggestion', text: 'Hello' }, {
    settingsService,
    providerService: { async generate() { called = true; } },
  }), error => error.code === 'DAILY_TOKEN_LIMIT');
  assert.equal(called, false);
});
