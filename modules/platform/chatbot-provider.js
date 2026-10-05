'use strict';

const PROVIDERS = Object.freeze({
  openai: { endpoint: 'https://api.openai.com/v1/chat/completions', style: 'openai' },
  deepseek: { endpoint: 'https://api.deepseek.com/v1/chat/completions', style: 'openai' },
  gemini: { endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/', style: 'gemini' },
});

async function boundedJson(response, maxBytes = 65536) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw Object.assign(new Error('PROVIDER_RESPONSE_TOO_LARGE'), { code: 'PROVIDER_RESPONSE_TOO_LARGE' });
  const text = await response.text();
  if (Buffer.byteLength(text) > maxBytes) throw Object.assign(new Error('PROVIDER_RESPONSE_TOO_LARGE'), { code: 'PROVIDER_RESPONSE_TOO_LARGE' });
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('PROVIDER_INVALID_RESPONSE'), { code: 'PROVIDER_INVALID_RESPONSE' }); }
}

async function generate({ provider, model, apiKey, system, user, maxOutputTokens = 350, fetchImpl }) {
  const spec = PROVIDERS[provider];
  if (!spec) throw Object.assign(new Error('AI_PROVIDER_UNSUPPORTED'), { code: 'AI_PROVIDER_UNSUPPORTED' });
  if (typeof model !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(model)) throw Object.assign(new Error('AI_MODEL_INVALID'), { code: 'AI_MODEL_INVALID' });
  if (typeof apiKey !== 'string' || !apiKey || apiKey.length > 2048) throw Object.assign(new Error('AI_PROVIDER_NOT_CONFIGURED'), { code: 'AI_PROVIDER_NOT_CONFIGURED' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    let url = spec.endpoint, body, headers = { 'Content-Type': 'application/json' };
    if (spec.style === 'openai') {
      headers.Authorization = `Bearer ${apiKey}`;
      body = { model, temperature: 0.1, max_tokens: Math.min(Math.max(maxOutputTokens, 64), 700), response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
    } else {
      url += `${encodeURIComponent(model)}:generateContent`;
      headers['x-goog-api-key'] = apiKey;
      body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.1, maxOutputTokens: Math.min(Math.max(maxOutputTokens, 64), 700), responseMimeType: 'application/json' } };
    }
    // Load the network adapter only for real provider calls. Injected fetch
    // implementations keep preview and contract tests fully offline.
    const request = fetchImpl || require('node-fetch');
    const response = await request(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, redirect: 'error', size: 65536 });
    let payload;
    try { payload = await boundedJson(response); }
    catch (error) {
      if (['PROVIDER_RESPONSE_TOO_LARGE', 'PROVIDER_INVALID_RESPONSE'].includes(error.code)) {
        throw Object.assign(new Error('AI_PROVIDER_INVALID_OUTPUT'), { code: 'AI_PROVIDER_INVALID_OUTPUT' });
      }
      throw error;
    }
    if (!response.ok) throw Object.assign(new Error('AI_PROVIDER_REQUEST_FAILED'), { code: 'AI_PROVIDER_REQUEST_FAILED', status: response.status });
    const text = spec.style === 'openai' ? payload?.choices?.[0]?.message?.content : payload?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
    if (typeof text !== 'string' || !text.trim() || text.length > 12000) throw Object.assign(new Error('AI_PROVIDER_INVALID_OUTPUT'), { code: 'AI_PROVIDER_INVALID_OUTPUT' });
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw Object.assign(new Error('AI_PROVIDER_INVALID_OUTPUT'), { code: 'AI_PROVIDER_INVALID_OUTPUT' }); }
    if (typeof parsed.reply !== 'string' || parsed.reply.length > 1600 || typeof parsed.can_answer !== 'boolean' || !Number.isFinite(parsed.confidence) || parsed.confidence < 0 || parsed.confidence > 1) throw Object.assign(new Error('AI_PROVIDER_INVALID_OUTPUT'), { code: 'AI_PROVIDER_INVALID_OUTPUT' });
    return { canAnswer: parsed.can_answer, confidence: parsed.confidence, reply: parsed.reply.trim(), inputTokens: Number(payload?.usage?.prompt_tokens ?? payload?.usageMetadata?.promptTokenCount ?? 0), outputTokens: Number(payload?.usage?.completion_tokens ?? payload?.usageMetadata?.candidatesTokenCount ?? 0) };
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error('AI_PROVIDER_TIMEOUT'), { code: 'AI_PROVIDER_TIMEOUT' });
    if (['AI_PROVIDER_REQUEST_FAILED', 'AI_PROVIDER_INVALID_OUTPUT'].includes(error.code)) throw error;
    // Keep network and provider implementation details out of conversation state.
    throw Object.assign(new Error('AI_PROVIDER_REQUEST_FAILED'), { code: 'AI_PROVIDER_REQUEST_FAILED' });
  } finally { clearTimeout(timeout); }
}

module.exports = { PROVIDERS, generate };
