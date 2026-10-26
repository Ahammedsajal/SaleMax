'use strict';

const crypto = require('node:crypto');

function lockName({ uid, origin, channelRef, chatId, scope = 'guided' }) {
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify([uid, origin, channelRef, chatId, scope]))
    .digest('hex').slice(0, 48);
  return `bot-turn:${digest}`;
}

async function runWithTurnLock({ pool, uid, origin, channelRef, chatId, scope }, operation) {
  if (!pool || !uid || !chatId || typeof operation !== 'function') throw new TypeError('CHATBOT_TURN_LOCK_ARGUMENTS_REQUIRED');
  const db = await pool.getConnection();
  const lock = lockName({ uid, origin, channelRef, chatId, scope });
  let acquired = false;
  try {
    const [[row]] = await db.query('SELECT GET_LOCK(?,0) AS acquired', [lock]);
    acquired = Number(row?.acquired) === 1;
    if (!acquired) return { acquired: false };
    return { acquired: true, value: await operation() };
  } finally {
    if (acquired) await db.query('SELECT RELEASE_LOCK(?)', [lock]).catch(() => {});
    db.release();
  }
}

module.exports = { lockName, runWithTurnLock };
