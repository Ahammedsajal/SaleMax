'use strict';

function keys(uid, uniqueId) {
  if (uid === null || uid === undefined || String(uid).trim() === '' ||
      uniqueId === null || uniqueId === undefined || String(uniqueId).trim() === '') {
    throw Object.assign(new Error('LEGACY_FLOW_OWNER_REQUIRED'), {
      code: 'LEGACY_FLOW_OWNER_REQUIRED', status: 403,
    });
  }
  return [String(uid), String(uniqueId)];
}

function profileConversationKey(uid, profileId, senderNumber, chatId) {
  keys(uid, 'conversation');
  const profile = String(profileId ?? '').trim();
  const sender = String(senderNumber ?? '').trim();
  const conversation = String(chatId ?? '').trim();
  if (!/^[1-9]\d*$/.test(profile) || !sender || !conversation) {
    throw Object.assign(new Error('LEGACY_FLOW_PROFILE_REQUIRED'), {
      code: 'LEGACY_FLOW_PROFILE_REQUIRED', status: 403,
    });
  }
  return `profile:${profile}:${sender}:${conversation}`;
}

async function find(query, uid, uniqueId) {
  const [owner, key] = keys(uid, uniqueId);
  const rows = await query(
    'SELECT * FROM flow_data WHERE uid = ? AND uniqueId = ?',
    [owner, key],
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
  const [owner, key] = keys(uid, uniqueId);
  return query('UPDATE flow_data SET other = ? WHERE uid = ? AND uniqueId = ?', [other, owner, key]);
}

async function setInputs(query, uid, uniqueId, inputs) {
  const [owner, key] = keys(uid, uniqueId);
  return query('UPDATE flow_data SET inputs = ? WHERE uid = ? AND uniqueId = ?', [inputs, owner, key]);
}

async function saveAnswer(query, uid, uniqueId, inputs) {
  const [owner, key] = keys(uid, uniqueId);
  return query('UPDATE flow_data SET inputs = ?, other = ? WHERE uid = ? AND uniqueId = ?', [inputs, null, owner, key]);
}

module.exports = { profileConversationKey, find, insertOther, insertInputs, setOther, setInputs, saveAnswer };
