'use strict';

const fail = code => { throw Object.assign(new Error(code), { code }); };

function normalizedContactId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2147483647) return value;
  if (typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value)) {
    const id = Number(value);
    if (Number.isSafeInteger(id) && id <= 2147483647) return id;
  }
  fail('INVALID_CONTACT_ID');
}

async function removeContact(query, ownerUid, rawId) {
  if (typeof query !== 'function' || typeof ownerUid !== 'string' || !ownerUid || ownerUid.length > 255) fail('INVALID_CONTACT_SCOPE');
  const id = normalizedContactId(rawId);
  await query('DELETE FROM contact WHERE id = ? AND uid = ?', [id, ownerUid]);
  return { id, deleted: true };
}

module.exports = { normalizedContactId, removeContact };
