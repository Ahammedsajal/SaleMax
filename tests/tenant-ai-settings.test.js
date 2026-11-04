'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reserveTokens, settleTokens, estimatedCostUsd, MONTHLY_SPEND_REMINDER_USD } = require('../modules/platform/tenant-ai-settings');

test('estimated USD uses the selected model input and output rates', () => {
  assert.equal(estimatedCostUsd('openai', 'gpt-6-luna', 1_000_000, 1_000_000), 0.6);
  assert.equal(estimatedCostUsd('openai', 'legacy-custom-model', 1_000_000, 1_000_000), 60);
  assert.equal(MONTHLY_SPEND_REMINDER_USD, 10);
});

test('daily token settings no longer deny provider reservations', async () => {
  const statements = [];
  const db = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, params) { statements.push([sql, params]); return [[]]; },
  };
  const reservation = await reserveTokens({ async getConnection() { return db; } }, 'tenant-1', 1000, 50000);
  assert.equal(reservation.amount, 50000);
  assert.equal(statements.some(([sql]) => /consumed_tokens AS consumed/.test(sql)), false);
  assert.equal(statements.some(([sql]) => /reserved_tokens=reserved_tokens\+VALUES\(reserved_tokens\)/.test(sql)), true);
});

test('monthly spend crossing queues one owner-manager reminder event', async () => {
  const statements = [];
  const db = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, params) {
      statements.push([sql, params]);
      if (/SELECT estimated_usd/.test(sql)) return [[{ estimatedUsd: '10.05', reminderEnqueuedAt: null }]];
      return [[]];
    },
  };
  await settleTokens({ async getConnection() { return db; } }, 'tenant-1', { usageDate: '2026-11-02', amount: 1500 }, 1500,
    { provider: 'openai', model: 'gpt-6-luna', inputTokens: 1000, outputTokens: 500 });
  const event = statements.find(([sql]) => /ai_usage_monthly/.test(sql));
  assert.ok(event);
  assert.equal(event[1][1], 'tenant-1');
  assert.equal(event[1][2], 'ai-usage:2026-11');
  assert.ok(statements.some(([sql]) => /reminder_enqueued_at=UTC_TIMESTAMP/.test(sql)));
});
