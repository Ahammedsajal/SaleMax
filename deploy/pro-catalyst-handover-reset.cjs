'use strict';

// Run inside the live app through the locked deployment helper. The helper
// acknowledges the persisted preimage before the transaction may change rows.
const readline = require('node:readline');
const root = process.cwd();
const claims = require(root + '/modules/platform/chatbot-handoff-claims');
const { executionFlowId } = require(root + '/modules/platform/chatbot-profile-utils');
const tenantId = process.env.SALEMAX_CHATBOT_ONE_HOUR_HANDOFF_TENANT_ID;
console.log = () => {};
const pool = require(root + '/database/config').promise();
const write = data => process.stdout.write(JSON.stringify(data) + '\n');

async function beforeReset(db, rows) {
  if (rows.length === 500) throw Error('HANDOFF_RESET_BATCH_LIMIT');
  const preimage = [];
  for (const claim of rows) {
    const scope = [tenantId, claim.channelKind, claim.channelRef, claim.conversationId];
    const [claimRows] = await db.query('SELECT * FROM sx_chatbot_handoff_claims WHERE tenant_id=? AND id=?', [tenantId, claim.id]);
    const [controls] = await db.query(`SELECT * FROM sx_chatbot_conversation_controls
      WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? FOR UPDATE`, scope);
    const [guided] = await db.query(`SELECT * FROM sx_chatbot_guided_sessions
      WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? AND profile_id=? FOR UPDATE`, [...scope, claim.profileId]);
    const [tasks] = await db.query('SELECT * FROM sx_tasks WHERE tenant_id=? AND id=? FOR UPDATE', [tenantId, claim.handoffTaskId]);
    const [events] = await db.query('SELECT * FROM sx_business_notification_events WHERE tenant_id=? AND event_key=? FOR UPDATE', [tenantId, claim.notificationEventKey]);
    const [deliveries] = await db.query('SELECT * FROM sx_business_notification_deliveries WHERE tenant_id=? AND event_id=? FOR UPDATE', [tenantId, events[0]?.id ?? null]);
    const [[profile]] = await db.query('SELECT engine,config FROM sx_chatbot_profiles WHERE tenant_id=? AND id=?', [tenantId, claim.profileId]);
    let config = profile?.config;
    if (typeof config === 'string') {
      try { config = JSON.parse(config); } catch { config = null; }
    }
    let legacyFlow = [];
    if (profile?.engine === 'guided' && config?.flowId) {
      const [[chat]] = await db.query(`SELECT uid,sender_mobile AS senderMobile,origin FROM beta_chats
        WHERE BINARY chat_id=BINARY ? AND BINARY SHA2(uid,256)=BINARY ? LIMIT 1`, [claim.conversationId, claim.ownerUidHash]);
      if (chat?.uid && chat.senderMobile) {
        const origin = chat.origin === 'qr' ? 'qr' : 'meta';
        const originId = origin === 'qr' ? claim.channelRef : 'META';
        const flowId = executionFlowId({ id: claim.profileId, channelRef: claim.channelRef });
        [legacyFlow] = await db.query(`SELECT * FROM flow_session
          WHERE uid=? AND origin=? AND origin_id=? AND flow_id=? AND sender_mobile=? FOR UPDATE`,
        [chat.uid, origin, originId, flowId, chat.senderMobile]);
      }
    }
    preimage.push({ claim: claimRows[0], controls, guided, legacyFlow, tasks, events, deliveries });
  }
  write({ preimage });
  const input = readline.createInterface({ input: process.stdin });
  const lines = input[Symbol.asyncIterator]();
  try {
    const reply = await lines.next();
    if (reply.value !== 'PREIMAGE_SAVED') throw Error('HANDOFF_RESET_PREIMAGE_NOT_SAVED');
  } finally { input.close(); }
}

(async () => {
  const [[tenant]] = await pool.query("SELECT id FROM sx_tenants WHERE id=? AND name='Pro Catalyst' AND category_key='training_center' AND status='active'", [tenantId]);
  if (!tenant) throw Error('HANDOFF_RESET_SCOPE_REQUIRED');
  const totals = await claims.expireDue(pool, { tenantId, resetAll: true, beforeReset, limit: 500 });
  const [[counts]] = await pool.query(`SELECT
    (SELECT COUNT(*) FROM sx_chatbot_handoff_claims WHERE tenant_id=? AND status IN ('open','claimed')) AS activeHandoffs,
    (SELECT COUNT(*) FROM sx_chatbot_conversation_controls WHERE tenant_id=? AND mode='paused' AND updated_by_kind='system'
      AND (pause_until IS NULL OR pause_until>UTC_TIMESTAMP(3))) AS systemPauses,
    (SELECT COUNT(*) FROM sx_tasks WHERE tenant_id=? AND task_type='chatbot_handoff'
      AND deleted_at IS NULL AND status IN ('open','in_progress','blocked')) AS activeHandoffTasks`, [tenantId, tenantId, tenantId]);
  write({ totals, counts });
})().catch(error => { write({ error: error.code || error.message }); process.exitCode = 1; }).finally(() => pool.end());
