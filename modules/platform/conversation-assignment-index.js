'use strict';

const crypto = require('node:crypto');

const hash = value => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
function parseAssignments(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch { return []; }
}

// Call in the same transaction as the beta_chats assignment update. The index
// stores canonical identities and hashes of legacy UIDs, never raw account UIDs.
async function replaceConversationAssignments(db, { uid, chatId, assignedAgent }) {
  if (typeof uid !== 'string' || !uid || typeof chatId !== 'string' || !chatId || chatId.length > 255) {
    throw Object.assign(new Error('CONVERSATION_ASSIGNMENT_INVALID'), { code: 'CONVERSATION_ASSIGNMENT_INVALID' });
  }
  const ownerUidHash = hash(uid);
  const [owners] = await db.query(`SELECT o.tenant_id AS tenantId FROM sx_legacy_ownership o
    JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id
    JOIN sx_tenants t ON t.id=o.tenant_id
    WHERE o.source_table='user' AND o.legacy_uid_hash=? AND m.role='owner' AND m.status='active'
      AND t.status='active' LIMIT 2`, [ownerUidHash]);
  if (!owners.length) return { indexed: false, count: 0 };
  if (owners.length !== 1) throw Object.assign(new Error('CONVERSATION_ASSIGNMENT_INDEX_MAPPING_AMBIGUOUS'), { code: 'CONVERSATION_ASSIGNMENT_INDEX_MAPPING_AMBIGUOUS' });
  const owner = owners[0];

  const assigneeHashes = [...new Set(parseAssignments(assignedAgent)
    .map(item => item?.uid)
    .filter(value => typeof value === 'string' && value.length > 0 && value.length <= 191)
    .map(hash))];
  const identities = new Map();
  if (assigneeHashes.length) {
    const [rows] = await db.query(`SELECT o.legacy_uid_hash AS uidHash,m.identity_id AS identityId
      FROM sx_legacy_ownership o JOIN sx_memberships m
        ON m.tenant_id=o.tenant_id AND m.id=o.membership_id
      JOIN sx_identities i ON i.id=m.identity_id
      WHERE o.tenant_id=? AND o.source_table IN ('user','agents')
        AND o.legacy_uid_hash IN (${assigneeHashes.map(() => '?').join(',')})`, [owner.tenantId, ...assigneeHashes]);
    for (const row of rows) {
      if (identities.has(row.uidHash) && identities.get(row.uidHash) !== row.identityId) {
        throw Object.assign(new Error('CONVERSATION_ASSIGNMENT_INDEX_MAPPING_AMBIGUOUS'), { code: 'CONVERSATION_ASSIGNMENT_INDEX_MAPPING_AMBIGUOUS' });
      }
      identities.set(row.uidHash, row.identityId);
    }
  }

  for (const item of parseAssignments(assignedAgent)) {
    if (item?.kind !== 'identity' || typeof item.identityId !== 'string') continue;
    if (typeof item.uid !== 'string' || identities.get(hash(item.uid)) !== item.identityId) {
      throw Object.assign(new Error('CONVERSATION_ASSIGNMENT_INDEX_MAPPING_MISMATCH'), { code: 'CONVERSATION_ASSIGNMENT_INDEX_MAPPING_MISMATCH' });
    }
  }

  await db.query('DELETE FROM sx_conversation_assignments WHERE tenant_id=? AND owner_uid_hash=? AND chat_id=?', [owner.tenantId, ownerUidHash, chatId]);
  const identityIds = [...new Set(assigneeHashes.map(uidHash => identities.get(uidHash)).filter(Boolean))];
  for (const identityId of identityIds) {
    await db.query(`INSERT INTO sx_conversation_assignments(tenant_id,owner_uid_hash,identity_id,chat_id)
      VALUES (?,?,?,?)`, [owner.tenantId, ownerUidHash, identityId, chatId]);
  }
  return { indexed: true, count: identityIds.length };
}

module.exports = { hash, parseAssignments, replaceConversationAssignments };
