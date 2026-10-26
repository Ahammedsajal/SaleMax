'use strict';

const crypto = require('node:crypto');
const DEFAULT_TIMEOUT_MINUTES = 60;

async function arm(pool, { tenantId, channelKind, channelRef, conversationId }) {
  const db = await pool.getConnection();
  try {
    await db.query(`INSERT INTO sx_chatbot_conversation_controls
      (id,tenant_id,channel_kind,channel_ref,conversation_id,mode,pause_until,auto_pause_at,reason,revision,updated_by_kind,updated_by_identity_id)
      VALUES (?,?,?,?,?,'inherit',NULL,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ${DEFAULT_TIMEOUT_MINUTES} MINUTE),NULL,1,'system',NULL)
      ON DUPLICATE KEY UPDATE
        auto_pause_at=IF(mode='paused' AND (pause_until IS NULL OR pause_until>UTC_TIMESTAMP(3)),NULL,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ${DEFAULT_TIMEOUT_MINUTES} MINUTE)),
        reason=IF(mode='paused' AND (pause_until IS NULL OR pause_until>UTC_TIMESTAMP(3)),reason,NULL),
        pause_until=IF(mode='paused' AND (pause_until IS NULL OR pause_until>UTC_TIMESTAMP(3)),pause_until,NULL),
        updated_by_kind=IF(mode='paused' AND (pause_until IS NULL OR pause_until>UTC_TIMESTAMP(3)),updated_by_kind,'system'),
        updated_by_identity_id=IF(mode='paused' AND (pause_until IS NULL OR pause_until>UTC_TIMESTAMP(3)),updated_by_identity_id,NULL),
        mode=IF(mode='paused' AND (pause_until IS NULL OR pause_until>UTC_TIMESTAMP(3)),'paused','inherit'),revision=revision+1`,
    [crypto.randomUUID(), tenantId, channelKind, channelRef, conversationId]);
  } finally { db.release(); }
}

// Called for every inbound customer message before routing it to a bot. Locking
// the control row makes a reply and the deadline worker mutually exclusive.
async function inbound(pool, { tenantId, channelKind, channelRef, conversationId, inboundMessageId }) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[row]] = await db.query(`SELECT mode,auto_pause_at AS autoPauseAt,
      (auto_pause_at IS NOT NULL AND auto_pause_at<=UTC_TIMESTAMP(3)) AS deadlineReached
      FROM sx_chatbot_conversation_controls
      WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? FOR UPDATE`,
    [tenantId, channelKind, channelRef, conversationId]);
    if (!row?.autoPauseAt) { await db.commit(); return false; }
    if (typeof inboundMessageId === 'string' && inboundMessageId) {
      const [[priorTurn]] = await db.query(`SELECT status FROM sx_chatbot_turns WHERE tenant_id=? AND inbound_message_id=? LIMIT 1`, [tenantId, inboundMessageId]);
      if (priorTurn?.status === 'sent' || priorTurn?.status === 'processing') { await db.commit(); return false; }
    }
    if (Number(row.deadlineReached)) {
      await pauseRow(db, { tenantId, channelKind, channelRef, conversationId });
      await auditPause(db, { tenantId, conversationId });
      await db.commit();
      return true;
    }
    // Any customer reply before the deadline cancels this timer. The next
    // successfully sent bot turn starts a fresh one-hour window.
    await db.query(`UPDATE sx_chatbot_conversation_controls SET auto_pause_at=NULL,
      reason=IF(mode='paused' AND (pause_until IS NULL OR pause_until>UTC_TIMESTAMP(3)),reason,NULL),
      mode=IF(mode='paused' AND pause_until IS NOT NULL AND pause_until<=UTC_TIMESTAMP(3),'inherit',mode),
      pause_until=IF(mode='paused' AND pause_until IS NOT NULL AND pause_until<=UTC_TIMESTAMP(3),NULL,pause_until),
      revision=revision+1,updated_by_kind='system',updated_by_identity_id=NULL
      WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=?`,
    [tenantId, channelKind, channelRef, conversationId]);
    await db.commit();
    return false;
  } catch (error) { await db.rollback().catch(() => {}); throw error; }
  finally { db.release(); }
}

async function pauseRow(db, scope) {
  await db.query(`UPDATE sx_chatbot_conversation_controls SET mode='paused',pause_until=NULL,auto_pause_at=NULL,
    reason='no-reply-timeout',revision=revision+1,updated_by_kind='system',updated_by_identity_id=NULL
    WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? AND auto_pause_at IS NOT NULL`,
  [scope.tenantId, scope.channelKind, scope.channelRef, scope.conversationId]);
}

async function auditPause(db, { tenantId, conversationId }) {
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?,?,NULL,'system','chatbot.conversation-auto-pause','chatbot-conversation',?,?,?)`,
  [crypto.randomUUID(), tenantId, conversationId, JSON.stringify({ mode: 'paused', reason: 'no-reply-timeout', timeoutMinutes: DEFAULT_TIMEOUT_MINUTES }), crypto.randomUUID()]);
}

async function tick(pool, { limit = 100 } = {}) {
  const db = await pool.getConnection();
  let count = 0;
  try {
    await db.beginTransaction();
    const [rows] = await db.query(`SELECT tenant_id AS tenantId,channel_kind AS channelKind,channel_ref AS channelRef,conversation_id AS conversationId
      FROM sx_chatbot_conversation_controls
      WHERE mode='inherit' AND auto_pause_at IS NOT NULL AND auto_pause_at<=UTC_TIMESTAMP(3)
      ORDER BY auto_pause_at LIMIT ? FOR UPDATE`, [limit]);
    for (const row of rows) {
      await pauseRow(db, row);
      await auditPause(db, row);
      count++;
    }
    await db.commit();
    return { paused: count };
  } catch (error) { await db.rollback().catch(() => {}); throw error; }
  finally { db.release(); }
}

function start({ pool = require('../../database/config').promise(), env = process.env } = {}) {
  if (env.CHATBOT_NO_REPLY_TIMEOUT_ENABLED === 'false') return { stop() {} };
  let stopped = false, busy = false, timer = null;
  const loop = async () => {
    if (stopped || busy) return;
    busy = true;
    try { const result = await tick(pool); if (result.paused) console.log(JSON.stringify({ chatbotNoReplyPauses: result.paused })); }
    catch (error) { console.error(JSON.stringify({ event: 'chatbot_no_reply_timeout_failed', code: error.code || 'WORKER_FAILED' })); }
    finally { busy = false; if (!stopped) timer = setTimeout(loop, 15000); }
  };
  timer = setTimeout(loop, 15000);
  return { stop() { stopped = true; clearTimeout(timer); } };
}

module.exports = { arm, inbound, tick, start, DEFAULT_TIMEOUT_MINUTES };
