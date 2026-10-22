'use strict';
const crypto = require('node:crypto');

function keys(uid, uniqueId) {
  if (uid === null || uid === undefined || String(uid).trim() === '' ||
      uniqueId === null || uniqueId === undefined || String(uniqueId).trim() === '') {
    throw Object.assign(new Error('LEGACY_FLOW_OWNER_REQUIRED'), {
      code: 'LEGACY_FLOW_OWNER_REQUIRED', status: 403,
    });
  }
  const owner = String(uid), key = String(uniqueId);
  if (owner.includes('\0') || key.includes('\0')) {
    throw Object.assign(new Error('LEGACY_FLOW_KEY_INVALID'), {
      code: 'LEGACY_FLOW_KEY_INVALID', status: 400,
    });
  }
  // Keep this byte contract in sync with the generated MariaDB column. The
  // separator makes the two variable-length identifiers unambiguous.
  const ownerKeyHash = crypto.createHash('sha256').update(owner).update('\0').update(key).digest();
  return [owner, key, ownerKeyHash];
}

function profileConversationKey(uid, profileId, senderNumber, chatId) {
  keys(uid, 'conversation');
  const profile = String(profileId ?? '').trim();
  const sender = String(senderNumber ?? '').trim();
  const conversation = String(chatId ?? '').trim();
  if (!/^[1-9]\d*$/.test(profile) || !sender || !conversation || sender.includes('\0') || conversation.includes('\0')) {
    throw Object.assign(new Error('LEGACY_FLOW_PROFILE_REQUIRED'), {
      code: 'LEGACY_FLOW_PROFILE_REQUIRED', status: 403,
    });
  }
  return `profile:${profile}:${sender}:${conversation}`;
}

async function find(query, uid, uniqueId) {
  const [owner, key, ownerKeyHash] = keys(uid, uniqueId);
  const rows = await query(
    'SELECT * FROM flow_data WHERE owner_key_hash = ? AND uid = ? AND uniqueId = ?',
    [ownerKeyHash, owner, key],
  );
  return rows?.[0] || null;
}

async function insertOther(query, uid, uniqueId, other) {
  const [owner, key] = keys(uid, uniqueId);
  return query('INSERT INTO flow_data (uid, uniqueId, other) VALUES (?,?,?)', [owner, key, other]);
}

async function insertInputs(query, uid, uniqueId, inputs, other) {
  const [owner, key] = keys(uid, uniqueId);
  return query('INSERT INTO flow_data (uid, uniqueId, inputs, other) VALUES (?,?,?,?)', [owner, key, inputs, other]);
}

async function setOther(query, uid, uniqueId, other) {
  const [owner, key, ownerKeyHash] = keys(uid, uniqueId);
  return query('UPDATE flow_data SET other = ? WHERE owner_key_hash = ? AND uid = ? AND uniqueId = ?', [other, ownerKeyHash, owner, key]);
}

async function setInputs(query, uid, uniqueId, inputs) {
  const [owner, key, ownerKeyHash] = keys(uid, uniqueId);
  return query('UPDATE flow_data SET inputs = ? WHERE owner_key_hash = ? AND uid = ? AND uniqueId = ?', [inputs, ownerKeyHash, owner, key]);
}

async function saveAnswer(query, uid, uniqueId, inputs) {
  const [owner, key, ownerKeyHash] = keys(uid, uniqueId);
  return query('UPDATE flow_data SET inputs = ?, other = ? WHERE owner_key_hash = ? AND uid = ? AND uniqueId = ?', [inputs, null, ownerKeyHash, owner, key]);
}

module.exports = { profileConversationKey, find, insertOther, insertInputs, setOther, setInputs, saveAnswer };
