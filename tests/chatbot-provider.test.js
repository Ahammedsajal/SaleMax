'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generate } = require('../modules/platform/chatbot-provider');

function response(payload, { status = 200, contentLength } = {}) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return { ok: status >= 200 && status < 300, status, headers: { get(name) { return name === 'content-length' ? (contentLength ?? String(Buffer.byteLength(text))) : null; } }, async text() { return text; } };
}

test('OpenAI-compatible provider sends bounded JSON with authorization only in the header', async () => {
  let captured;
  const result = await generate({ provider: 'openai', model: 'gpt-test', apiKey: 'secret-provider-key-012345', system: 'Grounded assistant', user: 'What courses are open?', fetchImpl: async (url, options) => {
    captured = { url, options };
    return response({ choices: [{ message: { content: JSON.stringify({ can_answer: true, confidence: 0.93, reply: 'English is open.' }) } }], usage: { prompt_tokens: 20, completion_tokens: 8 } });
  } });
  assert.equal(captured.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(captured.url.includes('secret-provider-key'), false);
  assert.equal(captured.options.headers.Authorization, 'Bearer secret-provider-key-012345');
  const body = JSON.parse(captured.options.body);
  assert.equal(body.response_format.type, 'json_object');
  assert.equal(body.max_tokens, 350);
  assert.deepEqual(result, { canAnswer: true, confidence: 0.93, reply: 'English is open.', inputTokens: 20, outputTokens: 8 });
});

test('GPT-6 chat models use current token and reasoning parameters', async () => {
  for (const [model, effort, hasTemperature] of [
    ['gpt-6-luna', 'none', true],
    ['gpt-6.1-sol', 'low', false],
    ['gpt-6-astra', 'low', false],
  ]) {
    let body;
    await generate({ provider: 'openai', model, apiKey: 'secret-provider-key-012345', system: 'Rules', user: 'Question', fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return response({ choices: [{ message: { content: JSON.stringify({ can_answer: true, confidence: 0.9, reply: 'Answer' }) } }] });
    } });
    assert.equal(body.max_completion_tokens, 350, model);
    assert.equal('max_tokens' in body, false, model);
    assert.equal(body.reasoning_effort, effort, model);
    assert.equal('temperature' in body, hasTemperature, model);
  }
});

test('Gemini sends its key in a header and percent-encodes the model path', async () => {
  let captured;
  const result = await generate({ provider: 'gemini', model: 'gemini-2.0-flash', apiKey: 'secret-provider-key-012345', system: 'Rules', user: 'Question', fetchImpl: async (url, options) => {
    captured = { url, options };
    return response({ candidates: [{ content: { parts: [{ text: JSON.stringify({ can_answer: false, confidence: 0, reply: '' }) }] } }], usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 2 } });
  } });
  assert.equal(captured.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent');
  assert.equal(captured.options.headers['x-goog-api-key'], 'secret-provider-key-012345');
  assert.equal(captured.url.includes('secret-provider-key'), false);
  assert.equal(result.canAnswer, false);
  assert.equal(result.inputTokens, 11);
});

test('provider errors, oversized responses and invalid confidence fail closed', async () => {
  await assert.rejects(generate({ provider: 'deepseek', model: 'deepseek-chat', apiKey: 'secret-provider-key-012345', system: 's', user: 'u', fetchImpl: async () => response({ error: 'private details' }, { status: 429 }) }), { code: 'AI_PROVIDER_REQUEST_FAILED' });
  await assert.rejects(generate({ provider: 'openai', model: 'gpt-test', apiKey: 'secret-provider-key-012345', system: 's', user: 'u', fetchImpl: async () => response('{}', { contentLength: '70000' }) }), { code: 'AI_PROVIDER_INVALID_OUTPUT' });
  await assert.rejects(generate({ provider: 'openai', model: 'gpt-test', apiKey: 'secret-provider-key-012345', system: 's', user: 'u', fetchImpl: async () => response({ choices: [{ message: { content: JSON.stringify({ can_answer: true, confidence: 1.1, reply: 'Unsafe' }) } }] }) }), { code: 'AI_PROVIDER_INVALID_OUTPUT' });
});
