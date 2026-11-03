'use strict';

// Curated adapters, not a claim that every provider/model is available to every account.
const PROVIDERS = Object.freeze([
  { id: 'openai', name: 'OpenAI', models: ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'], recommendedModel: 'gpt-6-luna', caching: 'stable_prefix' },
  { id: 'gemini', name: 'Google Gemini', models: ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'], recommendedModel: 'gemini-3.1-flash-lite', caching: 'provider_managed' },
  { id: 'deepseek', name: 'DeepSeek', models: ['deepseek-flash', 'deepseek-v4-pro'], recommendedModel: 'deepseek-flash', caching: 'provider_managed' },
]);

function supportsCacheControls(provider, model) {
  return provider === 'openai' && /^gpt-(?:[6-9](?:[.-]|$)|5\.(?:[6-9]|[1-9]\d)(?:[.-]|$))/.test(model);
}

module.exports = { PROVIDERS, supportsCacheControls };
