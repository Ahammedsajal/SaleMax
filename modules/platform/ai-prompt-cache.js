'use strict';
const crypto = require('node:crypto');
const { supportsCacheControls } = require('./ai-provider-catalog');

function configure(body, { provider, model, cacheScope, stablePrefixIndex = 0, conversation = false }) {
  if (provider !== 'openai') return body;
  // Stable, opaque workspace/workload routing; never send customer identifiers or keys.
  if (cacheScope) body.prompt_cache_key = '7network-v1-' + crypto.createHash('sha256').update(String(cacheScope)).digest('hex').slice(0, 40);
  if (supportsCacheControls(provider, model)) {
    // Cache stable policy/evidence, avoiding writes for every short customer question.
    body.prompt_cache_options = { mode: conversation ? 'implicit' : 'explicit', ttl: '30m' };
    body.messages = body.messages.map((message, index) => index === stablePrefixIndex || (index === 0 && message.role === 'system')
      ? { ...message, content: [{ type: 'text', text: message.content, prompt_cache_breakpoint: { mode: 'explicit' } }] } : message);
  }
  return body;
}

const count = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
function usage(payload) {
  const inputTokens = count(payload?.usage?.prompt_tokens ?? payload?.usageMetadata?.promptTokenCount);
  const outputTokens = count(payload?.usage?.completion_tokens ?? payload?.usageMetadata?.candidatesTokenCount) + count(payload?.usageMetadata?.thoughtsTokenCount);
  const read = payload?.usage?.prompt_tokens_details?.cached_tokens ?? payload?.usage?.prompt_cache_hit_tokens ?? payload?.usageMetadata?.cachedContentTokenCount;
  const written = payload?.usage?.prompt_tokens_details?.cache_write_tokens;
  return { inputTokens, outputTokens,
    ...(read !== undefined || written !== undefined ? {
      cachedInputTokens: Math.min(inputTokens, count(read)),
      cacheWriteTokens: Math.min(Math.max(0, inputTokens - count(read)), count(written)),
    } : {}),
  };
}

module.exports = { configure, usage };
