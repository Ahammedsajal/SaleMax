'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { previewAuditMetrics } = require('../modules/platform/chatbot-preview-audit');

test('preview audit keeps only safe model and cost metrics', () => {
  const result = previewAuditMetrics({
    provider: 'openai', model: 'gpt-6-luna', inputTokens: 810, outputTokens: 42,
    cacheHit: false, latencyMs: 423.6, prompt: 'private prompt', reply: 'private answer', sources: ['private source'],
  });
  assert.deepEqual(result, {
    provider: 'openai', model: 'gpt-6-luna', inputTokens: 810, outputTokens: 42,
    cacheHit: false, latencyMs: 424,
  });
  assert.equal(Object.hasOwn(result, 'prompt'), false);
  assert.equal(Object.hasOwn(result, 'reply'), false);
  assert.equal(Object.hasOwn(result, 'sources'), false);
});

test('preview audit rejects malformed model and token metrics', () => {
  assert.deepEqual(previewAuditMetrics({ provider: 'other', model: 'model\nsecret', inputTokens: -1, outputTokens: 2.5, cacheHit: 1, latencyMs: -10 }), {
    provider: null, model: null, inputTokens: null, outputTokens: null, cacheHit: false, latencyMs: null,
  });
  assert.equal(previewAuditMetrics(null), null);
});
