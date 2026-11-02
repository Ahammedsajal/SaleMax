'use strict';
const crypto = require('node:crypto');

function recipientPhone(value) {
  if (typeof value !== 'string' || /@(?:lid|g\.us)/i.test(value)) return null;
  const phone = value.trim().replace(/@s\.whatsapp\.net$/, '').replace(/^\+/, '');
  return /^[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

function normalizeAudience(value) {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > 100 || value.some(phone => !recipientPhone(phone))) {
    throw Object.assign(new Error('INVALID_BOT_AUDIENCE'), { code: 'INVALID_BOT_AUDIENCE' });
  }
  return [...new Set(value.map(recipientPhone))];
}

function recipientAllowed(config, value, profileId = '') {
  const phone = recipientPhone(value);
  if (!phone) return false;
  const hasList = Object.hasOwn(config || {}, 'allowedRecipientPhones');
  const list = config?.allowedRecipientPhones;
  if (hasList && Array.isArray(list) && list.includes(phone)) return true;
  if (Number.isSafeInteger(config?.rolloutPercent) && config.rolloutPercent >= 0 && config.rolloutPercent <= 100) {
    if (config.rolloutPercent === 0) return false;
    if (config.rolloutPercent === 100) return true;
    const hash = crypto.createHash('sha256').update(`${String(profileId)}:${phone}`).digest();
    const bucket = hash.readUInt32BE(0) % 10000;
    return bucket < config.rolloutPercent * 100;
  }
  return !hasList;
}

module.exports = { recipientPhone, normalizeAudience, recipientAllowed };
