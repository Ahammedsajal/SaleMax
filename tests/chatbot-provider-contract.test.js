'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const appRoot = process.env.SALEMAX_APP_ROOT || path.join(__dirname, '..');
const { generate } = require(path.join(appRoot, 'modules/platform/chatbot-provider'));

function response(payload, ok = true, status = 200) {
  return { ok, status, headers: { get: () => null }, text: async () => JSON.stringify(payload) };
}

test('OpenAI-compatible provider sends a bounded JSON-only request and parses confidence output', async () => {
  let request;
  const result = await generate({ provider: 'openai', model: 'gpt-example', apiKey: 'test-provider-key-123456', system: 'system', user: 'question', fetchImpl: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return response({ choices: [{ message: { content: JSON.stringify({ can_answer: true, confidence: 0.94, reply: 'Use the published course page.' }) } }], usage: { prompt_tokens: 120, completion_tokens: 20 } });
  } });
  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer test-provider-key-123456');
  assert.equal(request.body.response_format.type, 'json_object');
  assert.equal(request.body.max_tokens, 350);
  assert.deepEqual(result, { canAnswer: true, confidence: 0.94, reply: 'Use the published course page.', inputTokens: 120, outputTokens: 20 });
});

test('Gemini provider uses its API-key header and validates the same reply contract', async () => {
  let request;
  const result = await generate({ provider: 'gemini', model: 'gemini-example', apiKey: 'test-provider-key-123456', system: 'system', user: 'question', fetchImpl: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return response({ candidates: [{ content: { parts: [{ text: JSON.stringify({ can_answer: true, confidence: 0.9, reply: 'The next batch is listed in the CRM.' }) }] } }], usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 18 } });
  } });
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-example:generateContent');
  assert.equal(request.options.headers['x-goog-api-key'], 'test-provider-key-123456');
  assert.equal(request.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(result.canAnswer, true);
  assert.equal(result.inputTokens + result.outputTokens, 108);
});

test('provider failures and malformed model output are safe errors for handoff', async () => {
  await assert.rejects(() => generate({ provider: 'openai', model: 'model', apiKey: 'test-provider-key-123456', system: 'system', user: 'question', fetchImpl: async () => response({ error: 'provider down' }, false, 503) }), error => error.code === 'AI_PROVIDER_REQUEST_FAILED');
  await assert.rejects(() => generate({ provider: 'openai', model: 'model', apiKey: 'test-provider-key-123456', system: 'system', user: 'question', fetchImpl: async () => response({ choices: [{ message: { content: '{bad json' } }] }) }), error => error.code === 'AI_PROVIDER_INVALID_OUTPUT');
  await assert.rejects(() => generate({ provider: 'openai', model: 'model', apiKey: 'test-provider-key-123456', system: 'system', user: 'question', fetchImpl: async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); } }), error => error.code === 'AI_PROVIDER_TIMEOUT');
});

test('provider errors normalize non-JSON HTTP failures, oversized output, and transport errors', async () => {
  const args = { provider: 'openai', model: 'model', apiKey: 'test-provider-key-123456', system: 'system', user: 'question' };
  await assert.rejects(() => generate({ ...args, fetchImpl: async () => ({ ok: false, status: 502, headers: { get: () => null }, text: async () => '<html>bad gateway</html>' }) }), error => error.code === 'AI_PROVIDER_REQUEST_FAILED');
  await assert.rejects(() => generate({ ...args, fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => 'x'.repeat(70000) }) }), error => error.code === 'AI_PROVIDER_INVALID_OUTPUT');
  await assert.rejects(() => generate({ ...args, fetchImpl: async () => { throw Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }); } }), error => error.code === 'AI_PROVIDER_REQUEST_FAILED');
});
