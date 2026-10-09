'use strict';
const crypto = require('node:crypto');
const { scopeFor } = require('./policy');
const EVENT_PERMISSIONS = Object.freeze({
  get_chat_list: 'conversations.read', load_conversation: 'conversations.read', export_chats: 'conversations.read', export_conversation: 'conversations.read',
  send_chat_message: 'conversations.reply', send_new_message: 'conversations.reply', save_chat_note: 'conversations.reply', delete_chat_note: 'conversations.reply',
  update_spend_time: 'conversations.read', translate_message: 'conversations.reply', suggest_reply: 'conversations.reply',
  add_label: 'contacts.manage', on_label_delete: 'contacts.manage', set_chat_label: 'contacts.manage', remove_chat_label: 'contacts.manage', save_as_context: 'contacts.manage',
  assign_agent_to_chat: 'leads.assign', unasign_chat_agent: 'leads.assign',
});
const fail = () => { throw Object.assign(new Error('TEAM_INBOX_PERMISSION_DENIED'), { code: 'TEAM_INBOX_PERMISSION_DENIED' }); };
const parse = value => { try { const list = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(list) && list.every(x => typeof x === 'string') ? list : null; } catch { return null; } };

async function resolveInboxUid(query, user, event) {
  const [rows] = [await query(`SELECT t.id AS tenantId,t.status AS tenantStatus,m.role,m.status AS membershipStatus,
      i.status AS identityStatus,o.legacy_uid_hash AS uidHash,m.role_profile_id AS roleProfileId,
      m.delegated_permissions AS delegatedPermissions,r.permissions AS rolePermissions,r.seat_role AS seatRole,r.status AS roleStatus
    FROM sx_legacy_ownership o JOIN sx_tenants t ON t.id=o.tenant_id
    JOIN sx_memberships m ON m.tenant_id=t.id AND m.id=o.membership_id JOIN sx_identities i ON i.id=m.identity_id
    LEFT JOIN sx_team_roles r ON r.tenant_id=m.tenant_id AND r.id=m.role_profile_id
    WHERE o.source_table='user' AND o.source_id=? LIMIT 2`, [String(user.id)])];
  if (!rows.length) return user.uid;
  const row = rows[0];
  if (rows.length !== 1 || row.uidHash !== crypto.createHash('sha256').update(user.uid).digest('hex') || row.tenantStatus !== 'active' || row.membershipStatus !== 'active' || row.identityStatus !== 'active') fail();
  if (row.role === 'owner') return user.uid;
  const permission = EVENT_PERMISSIONS[event];
  if (!permission) fail();
  const delegatedPermissions = parse(row.delegatedPermissions) || [];
  const membership = { role: row.role, delegatedPermissions };
  if (row.roleProfileId) {
    const permissions = parse(row.rolePermissions);
    if (!permissions || row.seatRole !== row.role || !['active','archived'].includes(row.roleStatus) || !permissions.includes(permission)) fail();
    membership.customPermissions = permissions;
  }
  if (scopeFor(membership, permission) !== 'tenant') fail();
  const owners = await query(`SELECT u.uid,o.legacy_uid_hash AS uidHash FROM sx_memberships m
    JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='user'
    JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED) JOIN sx_identities i ON i.id=m.identity_id
    WHERE m.tenant_id=? AND m.role='owner' AND m.status='active' AND i.status='active' AND u.role='user' LIMIT 2`, [row.tenantId]);
  if (owners.length !== 1 || owners[0].uidHash !== crypto.createHash('sha256').update(owners[0].uid).digest('hex')) fail();
  return owners[0].uid;
}

module.exports = { resolveInboxUid, EVENT_PERMISSIONS };
