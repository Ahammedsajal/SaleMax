'use strict';

const PROVIDERS = new Set(['openai', 'gemini', 'deepseek']);
const MAX_API_KEY_LENGTH = 4096;
const MAX_TRANSLATION_LENGTH = 8000;
const MAX_REPLY_CONTEXT_LENGTH = 4000;
const MAX_CHAT_ID_LENGTH = 255;

function fail() {
  throw Object.assign(new Error('INVALID_AI_REQUEST'), { code: 'INVALID_AI_REQUEST' });
}

function boundedText(value, maxLength, { required = true } = {}) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') fail();
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) fail();
  return normalized;
}

function requestCredentials(body) {
  const provider = boundedText(body?.provider, 16);
  const apiKey = boundedText(body?.apiKey, MAX_API_KEY_LENGTH);
  if (!PROVIDERS.has(provider)) fail();
  return { provider, apiKey };
}

function translationInput(body) {
  const { provider, apiKey } = requestCredentials(body);
  const text = boundedText(body?.text, MAX_TRANSLATION_LENGTH);
  const targetLanguage = boundedText(body?.targetLanguage, 64);
  return { provider, apiKey, text, targetLanguage };
}

function replyInput(body) {
  const { provider, apiKey } = requestCredentials(body);
  const rawChatId = body?.chatId;
  if (!['string', 'number'].includes(typeof rawChatId) || (typeof rawChatId === 'number' && !Number.isSafeInteger(rawChatId))) fail();
  const chatId = boundedText(String(rawChatId), MAX_CHAT_ID_LENGTH);
  const lastMessage = body?.lastMessage == null ? '' : boundedText(body.lastMessage, MAX_REPLY_CONTEXT_LENGTH, { required: false });
  return { provider, apiKey, chatId, lastMessage };
}

module.exports = { PROVIDERS, MAX_API_KEY_LENGTH, MAX_TRANSLATION_LENGTH, MAX_REPLY_CONTEXT_LENGTH, MAX_CHAT_ID_LENGTH, translationInput, replyInput };
