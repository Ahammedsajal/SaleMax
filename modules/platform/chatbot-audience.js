'use strict';

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

function recipientAllowed(config, value) {
  if (!Object.hasOwn(config || {}, 'allowedRecipientPhones')) return true;
  const list = config.allowedRecipientPhones;
  const phone = recipientPhone(value);
  return Array.isArray(list) && !!phone && list.includes(phone);
}

module.exports = { recipientPhone, normalizeAudience, recipientAllowed };
