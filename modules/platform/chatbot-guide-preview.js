'use strict';

const { normalizeGuidedContent } = require('./chatbot-config');

function isSafeStateValue(value, depth = 0) {
  if (depth > 5) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.length <= 512;
  if (typeof value === 'number') return Number.isSafeInteger(value);
  if (Array.isArray(value)) return value.length <= 30 && value.every(item => isSafeStateValue(item, depth + 1));
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const entries = Object.entries(value);
  return entries.length <= 32 && entries.every(([key, item]) => key.length <= 80 && !['__proto__','prototype','constructor'].includes(key) && isSafeStateValue(item, depth + 1));
}

function previewInput(body, pack) {
  if (!pack?.guidedReply || !pack?.guidedContentDefaults) throw Object.assign(new Error('CATEGORY_GUIDED_FLOW_UNAVAILABLE'), { code: 'CATEGORY_GUIDED_FLOW_UNAVAILABLE' });
  const message = body?.message;
  if (typeof message !== 'string' || !message.trim() || message.length > 2000) throw Object.assign(new Error('INVALID_PREVIEW_REQUEST'), { code: 'INVALID_PREVIEW_REQUEST' });
  const state = body?.state ?? null;
  if (state !== null && (typeof state !== 'object' || Array.isArray(state) || Buffer.byteLength(JSON.stringify(state)) > 4096 || !isSafeStateValue(state))) {
    throw Object.assign(new Error('INVALID_PREVIEW_STATE'), { code: 'INVALID_PREVIEW_STATE' });
  }
  return { message: message.trim(), state, guidedContent: normalizeGuidedContent(body?.guidedContent, pack) };
}

async function previewGuidedTurn({ body, pack, db, tenantId, platformOrigin }) {
  const input = previewInput(body, pack);
  const facts = pack.requiresDatabase ? await pack.loadFacts({ db, tenantId, platformOrigin }) : [];
  const result = pack.guidedReply({ message: input.message, state: input.state, facts, config: input.guidedContent });
  if (!result || typeof result.reply !== 'string' || !result.reply.trim()) throw Object.assign(new Error('GUIDED_FLOW_UNAVAILABLE'), { code: 'GUIDED_FLOW_UNAVAILABLE' });
  return { reply: result.reply, state: result.state || null, handoff: result.handoff === true };
}

module.exports = { previewGuidedTurn, previewInput, isSafeStateValue };
