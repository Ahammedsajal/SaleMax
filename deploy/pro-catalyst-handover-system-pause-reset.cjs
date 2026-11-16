'use strict';

// Clears system-owned chatbot pauses left after their handoff claims expired.
// Run inside the live app only through the locked, preimage-saving release helper.
const readline = require('node:readline');
const crypto = require('node:crypto');
const root = process.cwd();
const tenantId = process.env.SALEMAX_CHATBOT_ONE_HOUR_HANDOFF_TENANT_ID;
const pool = require(root + '/database/config').promise();
const write = value => process.stdout.write(JSON.stringify(value) + '\n');

(async () => {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[tenant]] = await db.query(`SELECT id FROM sx_tenants
      WHERE id=? AND name='Pro Catalyst' AND category_key='training_center' AND status='active' FOR UPDATE`, [tenantId]);
    if (!tenant) throw Object.assign(new Error('HANDOFF_RESET_SCOPE_REQUIRED'), { code: 'HANDOFF_RESET_SCOPE_REQUIRED' });
    const [activeClaims] = await db.query(`SELECT id FROM sx_chatbot_handoff_claims
      WHERE tenant_id=? AND status IN ('open','claimed') FOR UPDATE`, [tenantId]);
    if (activeClaims.length) throw Object.assign(new Error('ACTIVE_HANDOFFS_MUST_BE_RESET_FIRST'), { code: 'ACTIVE_HANDOFFS_MUST_BE_RESET_FIRST' });

    const [controls] = await db.query(`SELECT * FROM sx_chatbot_conversation_controls
      WHERE tenant_id=? AND mode='paused' AND updated_by_kind='system'
      ORDER BY channel_kind,channel_ref,conversation_id LIMIT 500 FOR UPDATE`, [tenantId]);
    if (controls.length === 500) throw Object.assign(new Error('HANDOFF_RESET_BATCH_LIMIT'), { code: 'HANDOFF_RESET_BATCH_LIMIT' });
    const sessions = [];
    for (const control of controls) {
      const [rows] = await db.query(`SELECT * FROM sx_chatbot_guided_sessions
        WHERE tenant_id=? AND profile_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? FOR UPDATE`,
      [tenantId, control.profile_id, control.channel_kind, control.channel_ref, control.conversation_id]);
      sessions.push(...rows);
    }

    write({ preimage: { controls, sessions } });
    const input = readline.createInterface({ input: process.stdin });
    const lines = input[Symbol.asyncIterator]();
    try {
      const reply = await lines.next();
      if (reply.value !== 'PREIMAGE_SAVED') throw Object.assign(new Error('HANDOFF_RESET_PREIMAGE_NOT_SAVED'), { code: 'HANDOFF_RESET_PREIMAGE_NOT_SAVED' });
    } finally { input.close(); }

    let controlsReset = 0;
    let guidedSessionsReset = 0;
    for (const control of controls) {
      const scope = [tenantId, control.channel_kind, control.channel_ref, control.conversation_id];
      const [updated] = await db.query(`UPDATE sx_chatbot_conversation_controls
        SET mode='inherit',pause_until=NULL,reason=NULL,revision=revision+1,
          updated_by_kind='system',updated_by_identity_id=NULL
        WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=?
          AND mode='paused' AND updated_by_kind='system'`, scope);
      controlsReset += Number(updated.affectedRows || 0);
      const [removed] = await db.query(`DELETE FROM sx_chatbot_guided_sessions
        WHERE tenant_id=? AND profile_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=?`,
      [tenantId, control.profile_id, ...scope.slice(1)]);
      guidedSessionsReset += Number(removed.affectedRows || 0);
      if (updated.affectedRows) await db.query(`INSERT INTO sx_audit_events
        (id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
        VALUES (?, ?, NULL, 'system', 'chatbot.handoff-orphan-pause-reset', 'chatbot-conversation', ?, ?, ?)`,
      [crypto.randomUUID(), tenantId, control.conversation_id,
        JSON.stringify({ previousReason: control.reason, guidedSessionReset: Number(removed.affectedRows || 0) > 0, result: 'operator-reset' }),
        crypto.randomUUID()]);
    }
    const [[remaining]] = await db.query(`SELECT
      SUM(mode='paused' AND updated_by_kind='system') AS systemPauses,
      SUM(mode='paused' AND updated_by_kind='identity') AS identityPauses
      FROM sx_chatbot_conversation_controls WHERE tenant_id=?`, [tenantId]);
    await db.commit();
    write({ controlsFound: controls.length, controlsReset, guidedSessionsReset,
      remainingSystemPauses: Number(remaining?.systemPauses || 0), identityPausesPreserved: Number(remaining?.identityPauses || 0) });
  } catch (error) {
    await db.rollback().catch(() => {});
    write({ error: error.code || 'HANDOFF_RESET_FAILED' });
    process.exitCode = 1;
  } finally { db.release(); await pool.end(); }
})().catch(() => { write({ error: 'HANDOFF_RESET_FAILED' }); process.exitCode = 1; pool.end(); });
