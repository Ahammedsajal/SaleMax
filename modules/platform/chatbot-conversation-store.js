'use strict';
const crypto = require('node:crypto');
const automatedSenders = new Set(['bot', 'ai', 'automation', 'chatbot']);

function isAutomated(sender) {
  return automatedSenders.has(String(sender || '').trim().toLowerCase());
}

async function pauseForStaff(db, staffReply, route, sender) {
  if (!staffReply?.channelKind || !staffReply?.channelRef || route !== 'OUTGOING' || isAutomated(sender)) return false;
  await require('./chatbot-conversation-control').pauseForStaffReply(staffReply.uid, staffReply.chatId,
    staffReply.channelKind, staffReply.channelRef, (sql, values) => db.query(sql, values));
  return true;
}

// The QR echo and the bot's own persistence race on the same provider ID.
// An advisory lock gives both writers one atomic insert without rewriting or
// adding a unique index over historical conversation rows.
async function persistConversationMessage({ uid, chatId, data, pool = null, staffReply = null }) {
  const db = await (pool || require('../../database/config').promise()).getConnection();
  const id = typeof data.metaChatId === 'string' ? data.metaChatId.trim() : '';
  const lock = id ? 'history:' + crypto.createHash('sha256').update(JSON.stringify([uid, chatId, id])).digest('hex').slice(0, 56) : null;
  let held = false;
  try {
    if (lock) {
      const [[row]] = await db.query('SELECT GET_LOCK(?,5) AS acquired', [lock]);
      if (Number(row.acquired) !== 1) throw Object.assign(new Error('CONVERSATION_STORE_BUSY'), { code: 'CONVERSATION_STORE_BUSY' });
      held = true;
      const [[existing]] = await db.query('SELECT route,sentBy FROM beta_conversation WHERE uid=? AND chat_id=? AND metaChatId=? LIMIT 1', [uid, chatId, id]);
      if (existing) {
        const staffPaused = await pauseForStaff(db, staffReply ? { ...staffReply, uid, chatId } : null, existing.route, existing.sentBy);
        return { inserted: false, staffPaused };
      }
    }
    const staffPaused = await pauseForStaff(db, staffReply ? { ...staffReply, uid, chatId } : null, data.route, data.sentBy);
    await db.query('INSERT INTO beta_conversation SET ?', { ...data, uid, chat_id: chatId });
    return { inserted: true, staffPaused };
  } finally {
    if (held) await db.query('SELECT RELEASE_LOCK(?)', [lock]).catch(() => {});
    db.release();
  }
}

module.exports = { persistConversationMessage };
