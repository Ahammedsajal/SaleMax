'use strict';
const crypto = require('node:crypto');

// The QR echo and the bot's own persistence race on the same provider ID.
// An advisory lock gives both writers one atomic insert without rewriting or
// adding a unique index over historical conversation rows.
async function persistConversationMessage({ uid, chatId, data, pool = null }) {
  const db = await (pool || require('../../database/config').promise()).getConnection();
  const id = typeof data.metaChatId === 'string' ? data.metaChatId.trim() : '';
  const lock = id ? 'history:' + crypto.createHash('sha256').update(JSON.stringify([uid, chatId, id])).digest('hex').slice(0, 56) : null;
  let held = false;
  try {
    if (lock) {
      const [[row]] = await db.query('SELECT GET_LOCK(?,5) AS acquired', [lock]);
      if (Number(row.acquired) !== 1) throw Object.assign(new Error('CONVERSATION_STORE_BUSY'), { code: 'CONVERSATION_STORE_BUSY' });
      held = true;
      const [[existing]] = await db.query('SELECT 1 AS found FROM beta_conversation WHERE uid=? AND chat_id=? AND metaChatId=? LIMIT 1', [uid, chatId, id]);
      if (existing) return { inserted: false };
    }
    await db.query('INSERT INTO beta_conversation SET ?', { ...data, uid, chat_id: chatId });
    return { inserted: true };
  } finally {
    if (held) await db.query('SELECT RELEASE_LOCK(?)', [lock]).catch(() => {});
    db.release();
  }
}

module.exports = { persistConversationMessage };
