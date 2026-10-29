'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateReservation, run } = require('../modules/platform/tenant-ai-runtime');
const { tenantIdForOwnerUid } = require('../modules/platform/tenant-ai-context');

function fakeSettings(settings = { provider: 'openai', model: 'gpt-6-luna', apiKey: 'test-key', daily_token_limit: 50000 }) {
  const calls = [];
  return {
    calls,
    service: {
      async forRuntime(_pool, tenantId) { calls.push(['settings', tenantId]); return settings; },
      async reserveTokens(_pool, tenantId, limit, amount) { calls.push(['reserve', tenantId, limit, amount]); return { tenantId, amount }; },
      async settleTokens(_pool, tenantId, reservation, used) { calls.push(['settle', tenantId, reservation.amount, used]); },
    },
  };
}

test('shared AI runtime runs with tenant provider and settles reported usage', async () => {
  const fake = fakeSettings();
  const result = await run({ pool: {}, tenantId: 'tenant-a', input: 'short prompt', maxOutputTokens: 100, execute: async config => ({ reply: 'ok', usage: { inputTokens: 20, outputTokens: 8 }, config }) }, { settingsService: fake.service });
  assert.equal(result.configured, true);
  assert.deepEqual(result.result.config, { provider: 'openai', model: 'gpt-6-luna', apiKey: 'test-key' });
  assert.deepEqual(fake.calls.at(-1), ['settle', 'tenant-a', fake.calls[1][3], 28]);
});

test('unconfigured tenant does not execute an AI operation', async () => {
  const fake = fakeSettings(null);
  let called = false;
  const result = await run({ pool: {}, tenantId: 'tenant-a', input: 'prompt', execute: async () => { called = true; } }, { settingsService: fake.service });
  assert.equal(result.configured, false);
  assert.equal(called, false);
  assert.equal(fake.calls.some(call => call[0] === 'reserve'), false);
});

test('shared daily budget blocks the provider call and releases no reservation', async () => {
  const fake = fakeSettings();
  fake.service.reserveTokens = async () => null;
  let called = false;
  await assert.rejects(run({ pool: {}, tenantId: 'tenant-a', input: 'prompt', execute: async () => { called = true; } }, { settingsService: fake.service }), { code: 'DAILY_TOKEN_LIMIT' });
  assert.equal(called, false);
});

test('failed provider operation settles the full reservation without exposing error details', async () => {
  const fake = fakeSettings();
  await assert.rejects(run({ pool: {}, tenantId: 'tenant-a', input: 'prompt', execute: async () => { throw Object.assign(new Error('private upstream message'), { code: 'AI_PROVIDER_REQUEST_FAILED' }); } }, { settingsService: fake.service }), { code: 'AI_PROVIDER_REQUEST_FAILED' });
  const reserve = fake.calls.find(call => call[0] === 'reserve');
  assert.deepEqual(fake.calls.at(-1), ['settle', 'tenant-a', reserve[3], null]);
});

test('reservation estimates stay bounded for large requests and cap output', () => {
  assert.ok(estimateReservation('x'.repeat(1_000_000), 50_000) <= 10000);
  assert.ok(estimateReservation('short', 50_000) < 1200);
});

test('owner tenant resolution uses the shared business session mapping', async () => {
  const seen = [];
  const pool = { async query(sql, params) { seen.push([sql, params]); return [[{ id: 7, uid: 'owner-uid' }]]; } };
  const tenantId = await tenantIdForOwnerUid(pool, 'owner-uid', async (_pool, { actor }) => ({ context: { tenant: { id: `tenant-${actor.id}` } } }));
  assert.equal(tenantId, 'tenant-7');
  assert.equal(seen[0][1][0], 'owner-uid');
  assert.equal(await tenantIdForOwnerUid(pool, '', async () => { throw new Error('should not resolve'); }), null);
});
