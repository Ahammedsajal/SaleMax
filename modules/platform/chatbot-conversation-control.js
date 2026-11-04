'use strict';
const crypto = require('node:crypto');
const { query } = require('../../database/dbpromise');

async function readPause(uid, conversationId, channelKind, channelRef) {
  if (typeof uid !== 'string' || !uid || typeof conversationId !== 'string' || !conversationId ||
      !['whatsapp_meta', 'whatsapp_qr'].includes(channelKind) || typeof channelRef !== 'string' || !channelRef) return null;
  const uidHash = crypto.createHash('sha256').update(uid).digest('hex');
  let rows;
  try { rows = await query(`SELECT c.mode,c.pause_until AS pauseUntil,c.reason,c.updated_by_kind AS updatedByKind
    FROM sx_chatbot_conversation_controls c
    JOIN sx_legacy_ownership o ON o.tenant_id=c.tenant_id AND o.source_table='user'
    JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED) AND u.role='user'
    WHERE u.uid=? AND o.legacy_uid_hash=? AND c.conversation_id=? AND c.channel_kind=? AND c.channel_ref=?
      AND c.mode='paused' AND (c.pause_until IS NULL OR c.pause_until>UTC_TIMESTAMP(3))
    LIMIT 2`, [uid, uidHash, conversationId, channelKind, channelRef]); }
  catch (error) {
    // The additive migration may not yet be applied in a local/rolling deploy.
    // Preserve pre-existing bot behavior until the table exists; other DB
    // failures fail closed so a saved pause is never silently ignored.
    if (error.code === 'ER_NO_SUCH_TABLE') return null;
    return { mode: 'paused', updatedByKind: null, reason: null, failClosed: true };
  }
  // Any active match pauses the chat. Multiple matches are ambiguous and must
  // also fail closed rather than allowing a reply through.
  return rows.length === 1 ? rows[0] : rows.length > 1 ? { mode: 'paused', updatedByKind: null, reason: null, ambiguous: true } : null;
}

async function shouldPause(uid, conversationId, channelKind, channelRef) {
  return Boolean(await readPause(uid, conversationId, channelKind, channelRef));
}

module.exports = { shouldPause, readPause };
