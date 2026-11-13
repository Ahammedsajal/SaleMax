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

async function pauseForStaffReply(uid, conversationId, channelKind, channelRef, execute = query) {
  if (!uid || !conversationId || !channelRef || !['whatsapp_meta', 'whatsapp_qr'].includes(channelKind)) return;
  const uidHash = crypto.createHash('sha256').update(uid).digest('hex');
  await execute(`INSERT INTO sx_chatbot_conversation_controls
    (id,tenant_id,channel_kind,channel_ref,conversation_id,mode,pause_until,reason,revision,updated_by_kind,updated_by_identity_id)
    SELECT ?,o.tenant_id,?,?,?,'paused',NULL,'staff-replied',1,'system',NULL
    FROM sx_legacy_ownership o JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED)
    JOIN sx_tenants t ON t.id=o.tenant_id
    WHERE o.source_table='user' AND o.legacy_uid_hash=? AND u.uid=? AND u.role='user'
      AND t.category_key='training_center'
    LIMIT 1
    ON DUPLICATE KEY UPDATE mode='paused',pause_until=NULL,reason='staff-replied',
      revision=sx_chatbot_conversation_controls.revision+1,updated_by_kind='system',updated_by_identity_id=NULL`,
  [crypto.randomUUID(), channelKind, channelRef, conversationId, uidHash, uid]);
}

const automatedQrIds = new Map();
async function sendAutomatedQr(session, jid, content, senderKind = 'bot') {
  const messageId = '3EB0' + crypto.randomBytes(9).toString('hex').toUpperCase();
  const now = Date.now();
  for (const [id, item] of automatedQrIds) {
    if (item.expiry > now && automatedQrIds.size < 10000) break;
    automatedQrIds.delete(id);
  }
  automatedQrIds.set(messageId, { expiry: now + 300000, senderKind });
  return session?.sendMessage(jid, content, { messageId });
}
function automatedQrSender(id) {
  const item = automatedQrIds.get(id);
  return item?.expiry > Date.now() ? item.senderKind : null;
}

module.exports = { shouldPause, readPause, pauseForStaffReply, sendAutomatedQr, automatedQrSender };
