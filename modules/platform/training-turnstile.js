'use strict';

const crypto = require('node:crypto');

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const ACTION = 'training_form_submit';

function fail(code) { throw Object.assign(new Error(code), { code }); }
function validKey(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{16,256}$/.test(value); }
function isUuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }

function retryKey(secret, submissionToken, scope) {
  const bytes = crypto.createHmac('sha256', secret).update(`training-form:${scope}:${submissionToken}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createTrainingTurnstile({ siteKey, secretKey, hostname, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const supplied = Boolean(siteKey || secretKey);
  if (supplied && (!validKey(siteKey) || !validKey(secretKey))) fail('TURNSTILE_CONFIG_INVALID');
  if (supplied && (typeof hostname !== 'string' || !/^[a-z0-9.-]{1,253}$/i.test(hostname))) fail('TURNSTILE_HOST_INVALID');
  if (supplied && typeof fetchImpl !== 'function') fail('TURNSTILE_FETCH_UNAVAILABLE');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 15000) fail('TURNSTILE_TIMEOUT_INVALID');

  const enabled = supplied;
  async function verify(token, submissionToken, { tenantSlug, formSlug } = {}) {
    if (!enabled) return { enabled: false, verified: false };
    if (typeof token !== 'string' || token.length < 1 || token.length > 2048 || !isUuid(submissionToken) || typeof tenantSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(tenantSlug) || typeof formSlug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(formSlug)) fail('BOT_CHALLENGE_REQUIRED');
    let response;
    try {
      response = await fetchImpl(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: secretKey, response: token, idempotency_key: retryKey(secretKey, submissionToken, `${tenantSlug}/${formSlug}`) }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response || !response.ok) fail('BOT_CHALLENGE_UNAVAILABLE');
      const result = await response.json();
      if (result?.success !== true || String(result.hostname || '').toLowerCase() !== hostname.toLowerCase() || result.action !== ACTION) fail('BOT_CHALLENGE_FAILED');
      return { enabled: true, verified: true };
    } catch (error) {
      if (error.code === 'BOT_CHALLENGE_FAILED' || error.code === 'BOT_CHALLENGE_REQUIRED' || error.code === 'BOT_CHALLENGE_UNAVAILABLE') throw error;
      fail('BOT_CHALLENGE_UNAVAILABLE');
    }
  }

  return Object.freeze({
    enabled,
    action: ACTION,
    publicConfig: enabled ? Object.freeze({ provider: 'turnstile', siteKey, action: ACTION }) : null,
    verify
  });
}

module.exports = { createTrainingTurnstile, SITEVERIFY_URL, ACTION };
