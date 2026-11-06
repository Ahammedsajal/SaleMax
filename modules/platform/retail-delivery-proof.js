'use strict';

const crypto = require('node:crypto');

function masterKey(env = process.env) {
  const value = env.SALEMAX_PLATFORM_KEY_BASE64;
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw Object.assign(new Error('RETAIL_PROOF_KEY_UNAVAILABLE'), {code: 'RETAIL_PROOF_KEY_UNAVAILABLE',status:503});
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw Object.assign(new Error('RETAIL_PROOF_KEY_UNAVAILABLE'), {code: 'RETAIL_PROOF_KEY_UNAVAILABLE',status:503});
  }
  return key;
}

function derive(tenantId, purpose, env) {
  return Buffer.from(crypto.hkdfSync('sha256', masterKey(env), Buffer.from(tenantId), `7network/retail-delivery-proof/${purpose}/v1`, 32));
}

function aad(tenantId, orderId) {
  return Buffer.from(`${tenantId}\0${orderId}`);
}

function proofHash(code, tenantId, orderId, env = process.env) {
  return crypto.createHmac('sha256', derive(tenantId, 'verification', env)).update(orderId).update('\0').update(code).digest('hex');
}

function create(tenantId, orderId, env = process.env) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derive(tenantId, 'encryption', env), iv);
  cipher.setAAD(aad(tenantId, orderId));
  const ciphertext = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return {code, hash: proofHash(code, tenantId, orderId, env), ciphertext, iv, authTag: cipher.getAuthTag()};
}

function reveal(row, tenantId, orderId, env = process.env) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', derive(tenantId, 'encryption', env), Buffer.from(row.code_iv));
    decipher.setAAD(aad(tenantId, orderId));
    decipher.setAuthTag(Buffer.from(row.code_auth_tag));
    const code = Buffer.concat([decipher.update(Buffer.from(row.code_ciphertext)), decipher.final()]).toString('utf8');
    const actual = Buffer.from(proofHash(code, tenantId, orderId, env), 'hex');
    const expected = Buffer.from(row.code_hash, 'hex');
    if (!/^\d{6}$/.test(code) || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error();
    return code;
  } catch {
    throw Object.assign(new Error('RETAIL_PROOF_UNAVAILABLE'), {code: 'RETAIL_PROOF_UNAVAILABLE', status: 503});
  }
}

function matches(code, row, tenantId, orderId, env = process.env) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
  const actual = Buffer.from(proofHash(code, tenantId, orderId, env), 'hex');
  const expected = Buffer.from(row.code_hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = {create, reveal, matches, proofHash};
