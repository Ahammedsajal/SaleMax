'use strict';

const crypto = require('node:crypto');
const localLocks = new Set();
const queuedTurns = new Map();

function lockName({ uid, origin, channelRef, chatId, scope = 'guided' }) {
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify([uid, origin, channelRef, chatId, scope]))
    .digest('hex').slice(0, 48);
  return `bot-turn:${digest}`;
}

async function runWithTurnLock({ pool, uid, origin, channelRef, chatId, scope }, operation, { onOverflow = null } = {}) {
  if (!pool || !uid || !chatId || typeof operation !== 'function') throw new TypeError('CHATBOT_TURN_LOCK_ARGUMENTS_REQUIRED');
  const db = await pool.getConnection();
  const lock = lockName({ uid, origin, channelRef, chatId, scope });
  let acquired = false;
  let released = false;
  try {
    const [[row]] = await db.query('SELECT GET_LOCK(?,0) AS acquired', [lock]);
    acquired = Number(row?.acquired) === 1;
    if (!acquired) {
      const queued = queuedTurns.get(lock);
      if (queued) {
        queued.overflow = true;
        queued.onOverflow ||= onOverflow;
        return { acquired: false, overflowed: true };
      }
      if (!localLocks.has(lock)) return { acquired: false };
      db.release();
      released = true;
      return await new Promise((resolve, reject) => queuedTurns.set(lock, { operation, onOverflow, overflow: false, resolve, reject }));
    }
    localLocks.add(lock);
    let value, operationError;
    try { value = await operation(); } catch (error) { operationError = error; }
    const queued = queuedTurns.get(lock);
    if (queued) {
      try {
        const queuedValue = await queued.operation();
        if (queued.overflow && queued.onOverflow) await queued.onOverflow();
        queued.resolve({ acquired: true, value: queuedValue });
      } catch (error) {
        queued.reject(error);
      } finally {
        queuedTurns.delete(lock);
      }
    }
    if (operationError) throw operationError;
    return { acquired: true, value };
  } finally {
    if (acquired) localLocks.delete(lock);
    if (acquired) await db.query('SELECT RELEASE_LOCK(?)', [lock]).catch(() => {});
    if (!released) db.release();
  }
}

module.exports = { lockName, runWithTurnLock };
