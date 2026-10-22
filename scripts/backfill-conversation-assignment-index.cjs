'use strict';

const pool = require('../database/config.js').promise();
const { replaceConversationAssignments } = require('../modules/platform/conversation-assignment-index');

async function backfillTenant(tenantId) {
  const [[tenant]] = await pool.query(`SELECT t.id,t.conversation_assignment_index_ready_at AS readyAt,u.uid
    FROM sx_tenants t JOIN sx_memberships m ON m.tenant_id=t.id AND m.role='owner' AND m.status='active'
    JOIN sx_legacy_ownership o ON o.tenant_id=t.id AND o.membership_id=m.id AND o.source_table='user'
    JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED)
    WHERE t.id=? AND t.status='active' LIMIT 2`, [tenantId]);
  if (!tenant) return { skipped: 'tenant-unavailable', indexed: 0 };
  if (tenant.readyAt) return { skipped: 'already-ready', indexed: 0 };
  const [[ownerCount]] = await pool.query(`SELECT COUNT(*) AS count FROM sx_memberships m
    JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='user'
    WHERE m.tenant_id=? AND m.role='owner' AND m.status='active'`, [tenantId]);
  if (Number(ownerCount.count) !== 1) throw Object.assign(new Error('ASSIGNMENT_INDEX_OWNER_MAPPING_AMBIGUOUS'), { code: 'ASSIGNMENT_INDEX_OWNER_MAPPING_AMBIGUOUS' });
  const [[unmappedSeats]] = await pool.query(`SELECT COUNT(*) AS count FROM agents a
    WHERE a.owner_uid=? AND (a.is_active IS NULL OR a.is_active<>0) AND NOT EXISTS (
      SELECT 1 FROM sx_legacy_ownership o JOIN sx_memberships m
        ON m.tenant_id=o.tenant_id AND m.id=o.membership_id
      JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
      WHERE o.tenant_id=? AND o.source_table='agents' AND o.source_id=CAST(a.id AS CHAR)
        AND m.role='agent' AND m.status='active'
    )`, [tenant.uid, tenantId]);
  if (Number(unmappedSeats.count) > 0) return { skipped: 'legacy-seat-mappings-pending', indexed: 0 };

  let cursor = '0', indexed = 0, expectedRows = 0;
  while (true) {
    const [batch] = await pool.query('SELECT id,chat_id FROM beta_chats WHERE uid=? AND id>? ORDER BY id LIMIT 200', [tenant.uid, cursor]);
    if (!batch.length) break;
    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      for (const candidate of batch) {
        const [[chat]] = await db.query('SELECT chat_id,assigned_agent FROM beta_chats WHERE uid=? AND id=? FOR UPDATE', [tenant.uid, candidate.id]);
        if (!chat) continue;
        const result = await replaceConversationAssignments(db, { uid: tenant.uid, chatId: chat.chat_id, assignedAgent: chat.assigned_agent });
        expectedRows += result.count;
        indexed++;
      }
      await db.commit();
    } catch (error) {
      await db.rollback();
      throw error;
    } finally { db.release(); }
    cursor = String(batch[batch.length - 1].id);
  }
  await pool.query(`DELETE FROM sx_conversation_assignments
    WHERE tenant_id=? AND owner_uid_hash=SHA2(?,256)
      AND NOT EXISTS (SELECT 1 FROM beta_chats bc WHERE bc.uid=? AND bc.chat_id=sx_conversation_assignments.chat_id)`, [tenantId, tenant.uid, tenant.uid]);
  const [[indexedRows]] = await pool.query('SELECT COUNT(*) AS count FROM sx_conversation_assignments WHERE tenant_id=? AND owner_uid_hash=SHA2(?,256)', [tenantId, tenant.uid]);
  if (Number(indexedRows.count) !== expectedRows) throw Object.assign(new Error('ASSIGNMENT_INDEX_BACKFILL_VERIFY_FAILED'), { code: 'ASSIGNMENT_INDEX_BACKFILL_VERIFY_FAILED' });
  await pool.query('UPDATE sx_tenants SET conversation_assignment_index_ready_at=UTC_TIMESTAMP(3) WHERE id=? AND conversation_assignment_index_ready_at IS NULL', [tenantId]);
  return { indexed, skipped: null };
}

async function main() {
  const tenantId = process.argv[2];
  if (tenantId && !/^[0-9a-f-]{36}$/i.test(tenantId)) throw Object.assign(new Error('INVALID_TENANT_ID'), { code: 'INVALID_TENANT_ID' });
  const [tenants] = tenantId
    ? [[{ id: tenantId }]]
    : await pool.query("SELECT id FROM sx_tenants WHERE status='active' AND conversation_assignment_index_ready_at IS NULL ORDER BY id");
  let total = 0;
  for (const tenant of tenants) {
    const result = await backfillTenant(tenant.id);
    total += result.indexed;
    console.log(JSON.stringify({ tenantId: tenant.id, ...result }));
  }
  console.log(JSON.stringify({ tenants: tenants.length, conversationsScanned: total }));
}

if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ error: error.code || 'ASSIGNMENT_INDEX_BACKFILL_FAILED' }));
  process.exitCode = 1;
}).finally(() => pool.end());

module.exports = { backfillTenant };
