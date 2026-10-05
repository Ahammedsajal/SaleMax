'use strict';

const crypto = require('node:crypto');

function masterKey() {
  const encoded = process.env.SALEMAX_PLATFORM_KEY_BASE64;
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw Object.assign(new Error('ASTERISK_SECRET_KEY_UNAVAILABLE'), { code: 'ASTERISK_SECRET_KEY_UNAVAILABLE' });
  }
  const master = Buffer.from(encoded, 'base64');
  if (master.length !== 32 || master.toString('base64') !== encoded) {
    throw Object.assign(new Error('ASTERISK_SECRET_KEY_UNAVAILABLE'), { code: 'ASTERISK_SECRET_KEY_UNAVAILABLE' });
  }
  return master;
}

function key() {
  return Buffer.from(crypto.hkdfSync('sha256', masterKey(), Buffer.alloc(0), 'salemax/asterisk-ari-credential/v1', 32));
}

function endpointCredential({ tenantId, membershipId, extension, clientType, revision = 1 }) {
  if (![tenantId,membershipId].every(value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value))
    || !/^[0-9]{3,8}$/.test(extension || '') || !['mobile','browser'].includes(clientType)
    || !Number.isSafeInteger(Number(revision)) || Number(revision) < 1) {
    throw Object.assign(new Error('INVALID_SIP_ENDPOINT_IDENTITY'), { code: 'INVALID_SIP_ENDPOINT_IDENTITY' });
  }
  const info = `salemax/asterisk-sip-endpoint/v1/${membershipId}/${extension}/${clientType}/${Number(revision)}`;
  const derived = crypto.hkdfSync('sha256', masterKey(), Buffer.from(tenantId, 'utf8'), info, 32);
  return Buffer.from(derived).toString('base64url');
}

function encrypt(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 256 || /[\r\n]/.test(value)) {
    throw Object.assign(new Error('INVALID_ARI_CREDENTIAL'), { code: 'INVALID_ARI_CREDENTIAL' });
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

function decrypt(row) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(row.credential_iv));
  decipher.setAuthTag(Buffer.from(row.credential_auth_tag));
  return Buffer.concat([decipher.update(Buffer.from(row.credential_ciphertext)), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, endpointCredential };
