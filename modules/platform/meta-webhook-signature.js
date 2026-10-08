'use strict';

const crypto = require('node:crypto');

function isMetaWebhookRequest(req) {
  const path = String(req?.originalUrl || req?.url || '');
  return /^\/api\/inbox\/(?:embed\/)?webhook\//.test(path);
}

function captureRawBody(req, _res, body) {
  if (isMetaWebhookRequest(req) && Buffer.isBuffer(body)) req.rawBody = body;
}

function verifySignature(rawBody, signature, appSecret) {
  if (!Buffer.isBuffer(rawBody) || typeof appSecret !== 'string' || !appSecret.trim()) return false;
  if (typeof signature !== 'string' || !/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;
  const received = Buffer.from(signature.slice(7), 'hex');
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function requireMetaSignature(req, appSecret) {
  return verifySignature(req?.rawBody, req?.headers?.['x-hub-signature-256'], appSecret);
}

module.exports = { isMetaWebhookRequest, captureRawBody, verifySignature, requireMetaSignature };
