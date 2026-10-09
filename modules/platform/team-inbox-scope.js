'use strict';
const crypto = require('node:crypto');
const { scopeFor } = require('./policy');
const EVENT_PERMISSIONS = Object.freeze({
  get_chat_list: 'conversations.read', load_conversation: 'conversations.read', export_chats: 'conversations.read', export_conversation: 'conversations.read',
  send_chat_message: 'conversations.reply', send_new_message: 'conversations.reply', save_chat_note: 'conversations.reply', delete_chat_note: 'conversations.reply',
  update_spend_time: 'conversations.read', translate_message: 'conversations.reply', suggest_reply: 'conversations.reply',
  add_label: 'contacts.manage', on_label_delete: 'contacts.manage', set_chat_label: 'contacts.manage', remove_chat_label: 'contacts.manage', save_as_context: 'contacts.manage',
  assign_agent_to_chat: 'conversations.reply', unasign_chat_agent: 'leads.assign',
});
const fail = () => { throw Object.assign(new Error('TEAM_INBOX_PERMISSION_DENIED'), { code: 'TEAM_INBOX_PERMISSION_DENIED' }); };
const parse = value => { try { const list = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(list) && list.every(x => typeof x === 'string') ? list : null; } catch { return null; } };

async function resolveInboxScope(query, user, event) {
  const [rows] = [await query(`SELECT t.id AS tenantId,t.status AS tenantStatus,m.identity_id AS identityId,m.role,m.status AS membershipStatus,
      i.status AS identityStatus,o.legacy_uid_hash AS uidHash,m.role_profile_id AS roleProfileId,
      m.delegated_permissions AS delegatedPermissions,r.permissions AS rolePermissions,r.seat_role AS seatRole,r.status AS roleStatus
    FROM sx_legacy_ownership o JOIN sx_tenants t ON t.id=o.tenant_id
    JOIN sx_memberships m ON m.tenant_id=t.id AND m.id=o.membership_id JOIN sx_identities i ON i.id=m.identity_id
    LEFT JOIN sx_team_roles r ON r.tenant_id=m.tenant_id AND r.id=m.role_profile_id
    WHERE o.source_table='user' AND o.source_id=? LIMIT 2`, [String(user.id)])];
  if (!rows.length) return { uid: user.uid, canonical: false, assignedOnly: false };
  const row = rows[0];
  if (rows.length !== 1 || row.uidHash !== crypto.createHash('sha256').update(user.uid).digest('hex') || row.tenantStatus !== 'active' || row.membershipStatus !== 'active' || row.identityStatus !== 'active') fail();

  const permission = EVENT_PERMISSIONS[event];
  if (!permission && row.role !== 'owner') fail();
  const delegatedPermissions = parse(row.delegatedPermissions) || [];
  const membership = { role: row.role, delegatedPermissions };
  if (row.roleProfileId) {
    const permissions = parse(row.rolePermissions);
    if (!permissions || row.seatRole !== row.role || !['active','archived'].includes(row.roleStatus) || (permission && !permissions.includes(permission))) fail();
    membership.customPermissions = permissions;
  }
  if (row.role !== 'owner' && !scopeFor(membership, permission)) fail();
  const base = { canonical: true, assignedOnly: row.role !== 'owner', identityId: row.identityId, ctx: { tenant: { id: row.tenantId }, identity: { id: row.identityId }, membership } };
  if (row.role === 'owner') return { ...base, uid: user.uid };
  const owners = await query(`SELECT u.uid,o.legacy_uid_hash AS uidHash FROM sx_memberships m
    JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='user'
    JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED) JOIN sx_identities i ON i.id=m.identity_id
    WHERE m.tenant_id=? AND m.role='owner' AND m.status='active' AND i.status='active' AND u.role='user' LIMIT 2`, [row.tenantId]);
  if (owners.length !== 1 || owners[0].uidHash !== crypto.createHash('sha256').update(owners[0].uid).digest('hex')) fail();
  return { ...base, uid: owners[0].uid };
}

async function resolveInboxUid(query, user, event) {
  return (await resolveInboxScope(query, user, event)).uid;
}

function filterAssignedChats(chats, scope) {
  const { ownsConversation } = require('./team-conversation-assignment');
  return scope.assignedOnly ? chats.filter(chat => ownsConversation(chat.assigned_agent, scope.identityId)) : chats;
}

async function authorizeInboxPayload(query, scope, event, payload) {
  if (!scope.canonical) return payload;
  // Staff never initiate a different WhatsApp conversation through the shared
  // number. Reply only to the persisted, currently assigned customer/channel.
  if (scope.assignedOnly && ['send_new_message', 'unasign_chat_agent'].includes(event)) fail();
  if (['get_chat_list','export_chats','add_label','on_label_delete','update_spend_time','translate_message'].includes(event)) return payload;
  const ids = {
    load_conversation: payload.chat?.chat_id, export_conversation: payload.chatId,
    send_chat_message: payload.chatInfo?.chat_id, assign_agent_to_chat: payload.chatId,
    unasign_chat_agent: payload.cId, suggest_reply: payload.chatId,
    save_as_context: payload.chatId,
  };
  const rowIds = { set_chat_label: payload.chatIdRow, remove_chat_label: payload.chatId, delete_chat_note: payload.chatRealId, save_chat_note: payload.id };
  const rowId = rowIds[event];
  const chatId = ids[event];
  if (!chatId && !rowId) { if (scope.assignedOnly) fail(); return payload; }
  const rows = await query(`SELECT * FROM beta_chats WHERE uid=? AND ${rowId ? 'id' : 'chat_id'}=? LIMIT 1`, [scope.uid, rowId || chatId]);
  if (rows.length !== 1 || (scope.assignedOnly && !filterAssignedChats(rows, scope).length)) fail();
  if (event === 'send_chat_message') return { ...payload, chatInfo: rows[0] };
  if (event === 'load_conversation') return { ...payload, chat: rows[0] };
  return payload;
}

module.exports = { resolveInboxUid, resolveInboxScope, filterAssignedChats, authorizeInboxPayload, EVENT_PERMISSIONS };
