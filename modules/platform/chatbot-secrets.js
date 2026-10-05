'use strict';
const crypto = require('node:crypto');

function encryptionKey() {
  const value = process.env.SALEMAX_PLATFORM_KEY_BASE64;
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw Object.assign(new Error('CHATBOT_SECRET_KEY_UNAVAILABLE'), { code: 'CHATBOT_SECRET_KEY_UNAVAILABLE' });
  const master = Buffer.from(value, 'base64');
  if (master.length !== 32 || master.toString('base64') !== value) throw Object.assign(new Error('CHATBOT_SECRET_KEY_UNAVAILABLE'), { code: 'CHATBOT_SECRET_KEY_UNAVAILABLE' });
  return crypto.createHmac('sha256', master).update('salemax/chatbot/provider-key/v1').digest();
}

function encrypt(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 2048 || /\s/.test(value)) throw Object.assign(new Error('INVALID_PROVIDER_KEY'), { code: 'INVALID_PROVIDER_KEY' });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

function decrypt(row) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(row.key_iv));
  decipher.setAuthTag(Buffer.from(row.key_auth_tag));
  return Buffer.concat([decipher.update(Buffer.from(row.key_ciphertext)), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
