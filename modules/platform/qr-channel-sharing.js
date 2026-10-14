'use strict';

const crypto = require('node:crypto');
const policy = require('./policy');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const digest = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function ownerScope(db, ownerUid, lock = false) {
  const [rows] = await db.query(`SELECT u.id AS userId,u.uid,t.id AS tenantId,t.status AS tenantStatus,
      m.id AS membershipId,m.identity_id AS identityId,m.role,m.status AS membershipStatus,
      i.status AS identityStatus,o.legacy_uid_hash AS uidHash
    FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
    JOIN sx_tenants t ON t.id=o.tenant_id
    JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=t.id
    JOIN sx_identities i ON i.id=m.identity_id
    WHERE u.uid=?${lock ? ' FOR UPDATE' : ''}`, [ownerUid]);
  if (rows.length !== 1 || rows[0].uidHash !== digest(ownerUid)) fail('BUSINESS_LINK_INVALID');
  const scope = rows[0];
  if (scope.tenantStatus !== 'active' || scope.membershipStatus !== 'active' || scope.identityStatus !== 'active') fail('BUSINESS_INACTIVE');
  if (scope.role !== 'owner') fail('PERMISSION_DENIED');
  return scope;
}

async function list(pool, ownerUid) {
  const db = await pool.getConnection();
  try {
    const scope = await ownerScope(db, ownerUid);
    const [channels] = await db.query(`SELECT i.id,i.title,i.number,i.status,i.uniqueId,i.createdAt,
        COUNT(chat.id) AS conversationCount
      FROM instance i LEFT JOIN beta_chats chat
        ON chat.uid=i.uid AND chat.origin='qr' AND chat.origin_instance_unique_id=i.uniqueId
      WHERE i.uid=? GROUP BY i.id,i.title,i.number,i.status,i.uniqueId,i.createdAt ORDER BY i.createdAt DESC,i.id DESC`, [ownerUid]);
    const [members] = await db.query(`SELECT m.id AS membershipId,m.identity_id AS identityId,
        i.display_name AS displayName,i.email_normalized AS email,r.permissions AS rolePermissions,
        o.legacy_uid_hash AS uidHash,u.uid
      FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id
      JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='user'
      JOIN user u ON CAST(u.id AS CHAR)=o.source_id
      LEFT JOIN sx_team_roles r ON r.tenant_id=m.tenant_id AND r.id=m.role_profile_id
      WHERE m.tenant_id=? AND m.role='manager' AND m.status='active' AND i.status='active'
        AND u.role='user' ORDER BY i.display_name,i.email_normalized`, [scope.tenantId]);
    const validMembers = members.filter(member => {
      if (member.uidHash !== digest(member.uid)) return false;
      const permissions = typeof member.rolePermissions === 'string' ? JSON.parse(member.rolePermissions) : member.rolePermissions;
      const membership = { role: 'manager', customPermissions: permissions || undefined };
      return policy.scopeFor(membership, 'conversations.read') && policy.scopeFor(membership, 'conversations.reply');
    });
    const [shares] = await db.query('SELECT instance_id AS instanceId,membership_id AS membershipId FROM sx_qr_channel_shares WHERE tenant_id=?', [scope.tenantId]);
    const byChannel = new Map();
    for (const share of shares) {
      if (!byChannel.has(Number(share.instanceId))) byChannel.set(Number(share.instanceId), []);
      byChannel.get(Number(share.instanceId)).push(share.membershipId);
    }
    return {
      channels: channels.map(channel => ({
        id: Number(channel.id), title: channel.title || 'WhatsApp', number: channel.number || '',
        status: channel.status, conversationCount: Number(channel.conversationCount),
        managerMembershipIds: byChannel.get(Number(channel.id)) || [],
      })),
      managers: validMembers.map(({ membershipId, displayName, email }) => ({ membershipId, displayName, email })),
    };
  } finally { db.release(); }
}

async function saveManagerShares(pool, ownerUid, instanceIdValue, managerMembershipIdsValue) {
  const instanceId = Number(instanceIdValue);
  if (!Number.isSafeInteger(instanceId) || instanceId < 1) fail('INVALID_INSTANCE_ID');
  if (!Array.isArray(managerMembershipIdsValue) || managerMembershipIdsValue.length > 100 || managerMembershipIdsValue.some(id => typeof id !== 'string' || !idPattern.test(id))) fail('INVALID_MANAGER_ASSIGNMENTS');
  const managerMembershipIds = [...new Set(managerMembershipIdsValue)];
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const scope = await ownerScope(db, ownerUid, true);
    const [[channel]] = await db.query('SELECT id,title,uniqueId FROM instance WHERE id=? AND uid=? FOR UPDATE', [instanceId, ownerUid]);
    if (!channel) fail('QR_CHANNEL_NOT_FOUND');
    const [members] = managerMembershipIds.length ? await db.query(`SELECT m.id AS membershipId,m.identity_id AS identityId,
        i.display_name AS displayName,i.status AS identityStatus,m.status AS membershipStatus,
        r.permissions AS rolePermissions,o.legacy_uid_hash AS uidHash,u.uid
      FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id
      JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='user'
      JOIN user u ON CAST(u.id AS CHAR)=o.source_id
      LEFT JOIN sx_team_roles r ON r.tenant_id=m.tenant_id AND r.id=m.role_profile_id
      WHERE m.tenant_id=? AND m.role='manager' AND m.status='active' AND i.status='active' AND u.role='user' AND m.id IN (?) FOR UPDATE`, [scope.tenantId, managerMembershipIds]) : [[]];
    if (members.length !== managerMembershipIds.length || members.some(member => member.uidHash !== digest(member.uid))) fail('INVALID_MANAGER_ASSIGNMENTS');
    for (const member of members) {
      const permissions = typeof member.rolePermissions === 'string' ? JSON.parse(member.rolePermissions) : member.rolePermissions;
      const membership = { role: 'manager', customPermissions: permissions || undefined };
      if (!policy.scopeFor(membership, 'conversations.read') || !policy.scopeFor(membership, 'conversations.reply')) fail('MANAGER_INBOX_ACCESS_REQUIRED');
    }
    const [oldRows] = await db.query('SELECT membership_id AS membershipId FROM sx_qr_channel_shares WHERE tenant_id=? AND instance_id=? FOR UPDATE', [scope.tenantId, instanceId]);
    await db.query('DELETE FROM sx_qr_channel_shares WHERE tenant_id=? AND instance_id=?', [scope.tenantId, instanceId]);
    for (const membershipId of managerMembershipIds) {
      await db.query('INSERT INTO sx_qr_channel_shares(tenant_id,instance_id,membership_id,granted_by_identity_id) VALUES (?,?,?,?)', [scope.tenantId, instanceId, membershipId, scope.identityId]);
    }
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','whatsapp.qr-channel-access-updated','whatsapp-channel',?,?,?)`, [
      crypto.randomUUID(), scope.tenantId, scope.identityId, String(instanceId),
      JSON.stringify({ channelTitle: channel.title, previousManagerMembershipIds: oldRows.map(row => row.membershipId), managerMembershipIds }),
      crypto.randomUUID(),
    ]);
    await db.commit();
    return { instanceId, managerMembershipIds };
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}

module.exports = { list, saveManagerShares };
