'use strict';
const fetch = require('node-fetch');

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

async function generate({ provider, model, apiKey, system, user, requireSources = false, maxOutputTokens = 350, fetchImpl = fetch }) {
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
      const tokenLimit = Math.min(Math.max(maxOutputTokens, 64), 700);
      body = { model, temperature: 0.1, max_tokens: tokenLimit, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
      if (requireSources && provider === 'openai' && /^gpt-(?:4o|[5-9])/.test(model)) body.response_format = {
        type: 'json_schema', json_schema: { name: 'business_reply', strict: true, schema: {
          type: 'object', additionalProperties: false,
          properties: { can_answer: { type: 'boolean' }, confidence: { type: 'number' }, reply: { type: 'string' }, source_ids: { type: 'array', items: { type: 'string' } } },
          required: ['can_answer', 'confidence', 'reply', 'source_ids'],
        } },
      };
      if (/^gpt-6(?:\.|-)/.test(model)) {
        // Current reasoning models use max_completion_tokens. Non-none reasoning
        // effort also rejects temperature, so use low effort for capable models.
        body.max_completion_tokens = tokenLimit;
        delete body.max_tokens;
        if (model === 'gpt-6-luna') body.reasoning_effort = 'none';
        else {
          body.reasoning_effort = 'low';
          delete body.temperature;
        }
      }
    } else {
      url += `${encodeURIComponent(model)}:generateContent`;
      headers['x-goog-api-key'] = apiKey;
      body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.1, maxOutputTokens: Math.min(Math.max(maxOutputTokens, 64), 700), responseMimeType: 'application/json' } };
    }
    const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, redirect: 'error', size: 65536 });
    if (!response.ok) throw Object.assign(new Error('AI_PROVIDER_REQUEST_FAILED'), { code: 'AI_PROVIDER_REQUEST_FAILED', status: response.status });
    let payload;
    try { payload = await boundedJson(response); }
    catch (error) {
      if (['PROVIDER_RESPONSE_TOO_LARGE', 'PROVIDER_INVALID_RESPONSE'].includes(error.code)) {
        throw Object.assign(new Error('AI_PROVIDER_INVALID_OUTPUT'), { code: 'AI_PROVIDER_INVALID_OUTPUT' });
      }
      throw error;
    }
    const text = spec.style === 'openai' ? payload?.choices?.[0]?.message?.content : payload?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
    const tokensUsed = Number(payload?.usage?.prompt_tokens ?? payload?.usageMetadata?.promptTokenCount ?? 0) + Number(payload?.usage?.completion_tokens ?? payload?.usageMetadata?.candidatesTokenCount ?? 0) + Number(payload?.usageMetadata?.thoughtsTokenCount ?? 0);
    const invalidOutput = () => Object.assign(new Error('AI_PROVIDER_INVALID_OUTPUT'), { code: 'AI_PROVIDER_INVALID_OUTPUT', ...(Number.isSafeInteger(tokensUsed) && tokensUsed > 0 ? { tokensUsed } : {}) });
    if (typeof text !== 'string' || !text.trim() || text.length > 12000) throw invalidOutput();
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw invalidOutput(); }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.reply !== 'string' || parsed.reply.length > 1600 || typeof parsed.can_answer !== 'boolean' || !Number.isFinite(parsed.confidence) || parsed.confidence < 0 || parsed.confidence > 1 || (requireSources && (!Array.isArray(parsed.source_ids) || parsed.source_ids.length > 8 || parsed.source_ids.some(id => typeof id !== 'string' || id.length > 100)))) throw invalidOutput();
    return { ...(Array.isArray(parsed.source_ids) ? { sourceIds: parsed.source_ids.filter(id => typeof id === 'string' && id.length <= 100).slice(0, 8) } : {}), canAnswer: parsed.can_answer, confidence: parsed.confidence, reply: parsed.reply.trim(), inputTokens: Number(payload?.usage?.prompt_tokens ?? payload?.usageMetadata?.promptTokenCount ?? 0), outputTokens: Number(payload?.usage?.completion_tokens ?? payload?.usageMetadata?.candidatesTokenCount ?? 0) };
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error('AI_PROVIDER_TIMEOUT'), { code: 'AI_PROVIDER_TIMEOUT' });
    if (['AI_PROVIDER_REQUEST_FAILED', 'AI_PROVIDER_INVALID_OUTPUT'].includes(error.code)) throw error;
    // Do not leak provider/network implementation errors into conversation
    // state. The Inbox presents this stable code to the human operator.
    throw Object.assign(new Error('AI_PROVIDER_REQUEST_FAILED'), { code: 'AI_PROVIDER_REQUEST_FAILED' });
  } finally { clearTimeout(timeout); }
}

function normalizeFunctions(functions) {
  if (!Array.isArray(functions)) return [];
  return functions.slice(0, 12).filter(fn => fn && typeof fn.name === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(fn.name)).map(fn => ({
    name: fn.name,
    description: typeof fn.description === 'string' ? fn.description.slice(0, 500) : '',
    parameters: fn.parameters && typeof fn.parameters === 'object' ? fn.parameters : { type: 'object', properties: {}, additionalProperties: false },
  }));
}

function geminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'type' && typeof value === 'string') result[key] = value.toUpperCase();
    else result[key] = geminiSchema(value);
  }
  return result;
}

async function generateConversation({ provider, model, apiKey, messages, functions = [], maxOutputTokens = 350, fetchImpl = fetch }) {
  const spec = PROVIDERS[provider];
  if (!spec) throw Object.assign(new Error('AI_PROVIDER_UNSUPPORTED'), { code: 'AI_PROVIDER_UNSUPPORTED' });
  if (typeof model !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(model)) throw Object.assign(new Error('AI_MODEL_INVALID'), { code: 'AI_MODEL_INVALID' });
  if (typeof apiKey !== 'string' || !apiKey || apiKey.length > 2048) throw Object.assign(new Error('AI_PROVIDER_NOT_CONFIGURED'), { code: 'AI_PROVIDER_NOT_CONFIGURED' });
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 32 || messages.some(message => !message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 12000)) throw Object.assign(new Error('AI_INPUT_INVALID'), { code: 'AI_INPUT_INVALID' });
  const toolList = normalizeFunctions(functions);
  const tokenLimit = Math.min(Math.max(Number.isSafeInteger(maxOutputTokens) ? maxOutputTokens : 350, 64), 700);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    let url = spec.endpoint, headers = { 'Content-Type': 'application/json' }, body;
    if (spec.style === 'openai') {
      headers.Authorization = `Bearer ${apiKey}`;
      body = { model, messages, max_tokens: tokenLimit, temperature: 0.1 };
      if (toolList.length) {
        body.tools = toolList.map(fn => ({ type: 'function', function: { name: fn.name, description: fn.description, parameters: fn.parameters } }));
        body.tool_choice = 'auto';
      }
      if (/^gpt-6(?:\.|-)/.test(model)) {
        body.max_completion_tokens = tokenLimit;
        delete body.max_tokens;
        if (model !== 'gpt-6-luna') { body.reasoning_effort = 'low'; delete body.temperature; }
        else body.reasoning_effort = 'none';
      }
    } else {
      url += `${encodeURIComponent(model)}:generateContent`;
      headers['x-goog-api-key'] = apiKey;
      const system = messages.filter(item => item.role === 'system').map(item => item.content).join('\n').slice(0, 12000);
      const contents = messages.filter(item => item.role !== 'system').map(item => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content }] }));
      body = { contents, generationConfig: { temperature: 0.1, maxOutputTokens: tokenLimit } };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      if (toolList.length) body.tools = [{ functionDeclarations: toolList.map(fn => ({ name: fn.name, description: fn.description, parameters: geminiSchema(fn.parameters) })) }];
    }
    const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, redirect: 'error', size: 65536 });
    if (!response.ok) throw Object.assign(new Error('AI_PROVIDER_REQUEST_FAILED'), { code: 'AI_PROVIDER_REQUEST_FAILED', status: response.status });
    const payload = await boundedJson(response);
    let msg = '', functionName = null, functionArguments = null;
    if (spec.style === 'openai') {
      const choice = payload?.choices?.[0]?.message;
      msg = typeof choice?.content === 'string' ? choice.content : '';
      const toolCall = choice?.tool_calls?.[0]?.function;
      functionName = toolCall?.name || choice?.function_call?.name || null;
      const rawArguments = toolCall?.arguments ?? choice?.function_call?.arguments;
      if (typeof rawArguments === 'string') { try { functionArguments = JSON.parse(rawArguments); } catch { throw Object.assign(new Error('AI_PROVIDER_INVALID_OUTPUT'), { code: 'AI_PROVIDER_INVALID_OUTPUT' }); } }
    } else {
      const parts = payload?.candidates?.[0]?.content?.parts || [];
      msg = parts.map(part => typeof part.text === 'string' ? part.text : '').join('');
      const call = parts.find(part => part.functionCall?.name)?.functionCall;
      functionName = call?.name || null;
      functionArguments = call?.args && typeof call.args === 'object' ? call.args : null;
    }
    const usage = {
      inputTokens: Number(payload?.usage?.prompt_tokens ?? payload?.usageMetadata?.promptTokenCount ?? 0),
      outputTokens: Number(payload?.usage?.completion_tokens ?? payload?.usageMetadata?.candidatesTokenCount ?? 0) + Number(payload?.usageMetadata?.thoughtsTokenCount ?? 0),
    };
    if ((!msg.trim() && !functionName) || msg.length > 12000) throw Object.assign(new Error('AI_PROVIDER_INVALID_OUTPUT'), { code: 'AI_PROVIDER_INVALID_OUTPUT', tokensUsed: usage.inputTokens + usage.outputTokens });
    if (functionName && !toolList.some(fn => fn.name === functionName)) throw Object.assign(new Error('AI_PROVIDER_INVALID_OUTPUT'), { code: 'AI_PROVIDER_INVALID_OUTPUT', tokensUsed: usage.inputTokens + usage.outputTokens });
    return { success: true, msg: msg.trim(), function: functionName || false, functionArguments, ...usage, usage };
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error('AI_PROVIDER_TIMEOUT'), { code: 'AI_PROVIDER_TIMEOUT' });
    if (['AI_PROVIDER_REQUEST_FAILED', 'AI_PROVIDER_INVALID_OUTPUT', 'AI_INPUT_INVALID', 'AI_MODEL_INVALID', 'AI_PROVIDER_NOT_CONFIGURED', 'AI_PROVIDER_UNSUPPORTED'].includes(error.code)) throw error;
    throw Object.assign(new Error('AI_PROVIDER_REQUEST_FAILED'), { code: 'AI_PROVIDER_REQUEST_FAILED' });
  } finally { clearTimeout(timeout); }
}

module.exports = { PROVIDERS, generate, generateConversation, normalizeFunctions, geminiSchema };
