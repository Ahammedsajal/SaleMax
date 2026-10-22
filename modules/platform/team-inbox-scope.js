'use strict';
const crypto = require('node:crypto');
const { scopeFor } = require('./policy');
const EVENT_PERMISSIONS = Object.freeze({
  get_chat_list: 'conversations.read', load_conversation: 'conversations.read', export_chats: 'conversations.read', export_conversation: 'conversations.read',
  send_chat_message: 'conversations.reply', send_new_message: 'conversations.reply', save_chat_note: 'conversations.reply', delete_chat_note: 'conversations.reply',
  update_spend_time: 'conversations.read', translate_message: 'conversations.reply', suggest_reply: 'conversations.reply',
  add_label: 'contacts.manage', on_label_delete: 'contacts.manage', set_chat_label: 'contacts.manage', remove_chat_label: 'contacts.manage', save_as_context: 'contacts.manage', del_contact: 'contacts.manage',
  assign_agent_to_chat: 'conversations.reply', unasign_chat_agent: 'leads.assign',
});
const fail = () => { throw Object.assign(new Error('TEAM_INBOX_PERMISSION_DENIED'), { code: 'TEAM_INBOX_PERMISSION_DENIED' }); };
const parse = value => { try { const list = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(list) && list.every(x => typeof x === 'string') ? list : null; } catch { return null; } };

async function resolveInboxScope(query, user, event) {
  const source=user.isAgent||user.role==='agent'?'agents':'user';
  const [rows] = [await query(`SELECT t.id AS tenantId,t.status AS tenantStatus,t.category_key AS categoryKey,m.id AS membershipId,m.identity_id AS identityId,m.role,m.status AS membershipStatus,
      i.status AS identityStatus,o.legacy_uid_hash AS uidHash,m.role_profile_id AS roleProfileId,
      m.delegated_permissions AS delegatedPermissions,r.permissions AS rolePermissions,r.seat_role AS seatRole,r.status AS roleStatus
    FROM sx_legacy_ownership o JOIN sx_tenants t ON t.id=o.tenant_id
    JOIN sx_memberships m ON m.tenant_id=t.id AND m.id=o.membership_id JOIN sx_identities i ON i.id=m.identity_id
    LEFT JOIN sx_team_roles r ON r.tenant_id=m.tenant_id AND r.id=m.role_profile_id
    WHERE o.source_table='${source}' AND o.source_id=? LIMIT 2`, [String(user.id)])];
  if (!rows.length) return { uid: user.uid, canonical: false, assignedOnly: false };
  const row = rows[0];
  if (rows.length !== 1 || row.uidHash !== crypto.createHash('sha256').update(user.uid).digest('hex') || row.tenantStatus !== 'active' || row.membershipStatus !== 'active' || row.identityStatus !== 'active') fail();

  const permission = EVENT_PERMISSIONS[event];
  if (!permission && row.role !== 'owner') fail();
  const qrAccountant = row.role==='accountant' && row.categoryKey==='training_center' && ['conversations.read','conversations.reply'].includes(permission);
  const delegatedPermissions = parse(row.delegatedPermissions) || [];
  const membership = { id: row.membershipId, tenantId: row.tenantId, identityId: row.identityId, role: row.role, status: row.membershipStatus, delegatedPermissions };
  if (row.roleProfileId) {
    const permissions = parse(row.rolePermissions);
    if (!permissions || row.seatRole !== row.role || !['active','archived'].includes(row.roleStatus) || (permission && !permissions.includes(permission) && !qrAccountant)) fail();
    membership.customPermissions = permissions;
  }
  if (row.role !== 'owner' && !qrAccountant && !scopeFor(membership, permission)) fail();
  const base = { canonical: true, assignedOnly: row.role !== 'owner', identityId: row.identityId, ctx: { tenant: { id: row.tenantId, status: row.tenantStatus, categoryKey: row.categoryKey }, identity: { id: row.identityId }, membership } };
  if (row.role === 'owner') return { ...base, uid: user.uid };
  const owners = await query(`SELECT u.uid,m.id AS membershipId,m.identity_id AS identityId,o.legacy_uid_hash AS uidHash FROM sx_memberships m
    JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='user'
    JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED) JOIN sx_identities i ON i.id=m.identity_id
    WHERE m.tenant_id=? AND m.role='owner' AND m.status='active' AND i.status='active' AND u.role='user' LIMIT 2`, [row.tenantId]);
  if (owners.length !== 1 || owners[0].uidHash !== crypto.createHash('sha256').update(owners[0].uid).digest('hex')) fail();
  if(source==='agents'&&(user.is_active===0||user.owner_uid!==owners[0].uid))fail();
  const sharedQrInstances = ['manager','agent','accountant'].includes(row.role)
    ? await query(`SELECT instance.id AS instanceId,instance.uniqueId,instance.number,instance.title,instance.status
        FROM sx_qr_channel_shares share JOIN instance ON instance.id=share.instance_id AND instance.uid=?
        WHERE share.tenant_id=? AND share.membership_id=? AND (
          share.granted_by_identity_id=? OR share.granted_by_identity_id=? OR EXISTS (
            SELECT 1 FROM sx_memberships manager
            JOIN sx_qr_channel_shares manager_share ON manager_share.tenant_id=share.tenant_id AND manager_share.instance_id=share.instance_id AND manager_share.membership_id=manager.id
            JOIN sx_tenants tenant ON tenant.id=manager.tenant_id
            WHERE manager.tenant_id=share.tenant_id AND manager.role='manager' AND manager.status='active'
              AND manager.identity_id=share.granted_by_identity_id AND (
                tenant.category_key='training_center' OR EXISTS (
                  SELECT 1 FROM sx_sales_org_history org WHERE org.tenant_id=share.tenant_id
                    AND org.membership_id=share.membership_id AND org.manager_membership_id=manager.id AND org.ended_at IS NULL
                )
              )
          )
        )`, [owners[0].uid,row.tenantId,row.membershipId,owners[0].identityId,row.identityId])
    : [];
  if(qrAccountant&&!sharedQrInstances.length)fail();
  return { ...base, uid: owners[0].uid, sharedQrInstances, sharedQrInstanceIds: sharedQrInstances.map(channel => Number(channel.instanceId)), qrOnly:qrAccountant };
}

async function resolveInboxUid(query, user, event) {
  return (await resolveInboxScope(query, user, event)).uid;
}

function filterAssignedChats(chats, scope) {
  const { ownsConversation } = require('./team-conversation-assignment');
  if (!scope.assignedOnly) return chats;
  const channelIds = new Set((scope.sharedQrInstances || []).map(channel => String(channel.uniqueId)));
  return chats.filter(chat => (!scope.qrOnly&&ownsConversation(chat.assigned_agent, scope.identityId)) ||
    (chat.origin === 'qr' && chat.origin_instance_unique_id && channelIds.has(String(chat.origin_instance_unique_id))));
}

function filterQrInstances(instances, scope) {
  if (!scope?.canonical || scope.ctx?.membership?.role === 'owner') return instances;
  const allowed = new Set((scope.sharedQrInstanceIds || []).map(Number));
  return instances.filter(instance => allowed.has(Number(instance.id)));
}

async function payloadOwnerUid(query, scope, actor) {
  if (scope?.canonical) {
    if (typeof scope.uid !== 'string' || !scope.uid) fail();
    return scope.uid;
  }
  if (actor?.isAgent === true || actor?.role === 'agent') {
    const agentUid = typeof actor.uid === 'string' ? actor.uid : '';
    const ownerUid = typeof actor.owner_uid === 'string' ? actor.owner_uid : '';
    if (!agentUid || !ownerUid) fail();
    const agents = await query('SELECT uid FROM agents WHERE uid=? AND owner_uid=? AND (is_active IS NULL OR is_active<>0) LIMIT 2', [agentUid, ownerUid]);
    if (agents.length !== 1) fail();
    return ownerUid;
  }
  if (typeof scope?.uid !== 'string' || !scope.uid) fail();
  return scope.uid;
}

function legacyAgentOwnsConversation(chat, actor) {
  try {
    const parsed = typeof chat?.assigned_agent === 'string' ? JSON.parse(chat.assigned_agent) : chat?.assigned_agent;
    const assigned = Array.isArray(parsed) ? parsed : [parsed];
    return assigned.some(agent => agent && (
      (actor?.id != null && String(agent.id) === String(actor.id)) ||
      (typeof actor?.uid === 'string' && agent.uid === actor.uid)
    ));
  } catch { return false; }
}

async function authorizeInboxPayload(query, scope, event, payload, actor) {
  if (event === 'update_spend_time') return authorizeAgentSpendTime(query, scope, payload, actor);
  if (event === 'del_contact') return authorizeContactDelete(scope, payload, actor);
  const targetOwnerUid = await payloadOwnerUid(query, scope, actor);
  if (scope.assignedOnly && event === 'send_new_message') fail();
  if (event === 'on_label_delete') {
    const labelId = Number(payload?.labelId);
    if (!Number.isSafeInteger(labelId) || labelId < 1) fail();
    const labels = await query('SELECT id FROM chat_tags WHERE id=? AND uid=? LIMIT 1', [labelId, targetOwnerUid]);
    if (labels.length !== 1) fail();
    return { ...payload, labelId, ownerUid: targetOwnerUid };
  }
  if ((event === 'unasign_chat_agent' || (event === 'assign_agent_to_chat' && payload?.unAssign)) &&
      (actor?.isAgent === true || actor?.role === 'agent')) {
    const requestedUid = event === 'unasign_chat_agent' ? payload?.aUid : payload?.agentUid;
    if (requestedUid !== actor.uid) fail();
  }
  if (event === 'send_new_message') {
    if (actor?.isAgent === true || actor?.role === 'agent') {
      if (scope.canonical) fail();
      const agents = await query('SELECT uid,allow_send_new_qr FROM agents WHERE uid=? AND owner_uid=? AND (is_active IS NULL OR is_active<>0) LIMIT 2', [actor.uid, targetOwnerUid]);
      if (agents.length !== 1 || Number(agents[0].allow_send_new_qr) !== 1) fail();
    }
    const uniqueId = payload?.instance?.uniqueId;
    if (typeof uniqueId !== 'string' || !uniqueId || uniqueId.length > 255) fail();
    const instances = await query('SELECT id,uid,uniqueId,number,status FROM instance WHERE uid=? AND uniqueId=? LIMIT 2', [targetOwnerUid, uniqueId]);
    if (instances.length !== 1) fail();
    return { ...payload, instance: instances[0], ownerUid: targetOwnerUid };
  }
  if(scope.qrOnly&&!['get_chat_list','load_conversation','export_chats','export_conversation','send_chat_message'].includes(event))fail();
  // Staff never initiate a different WhatsApp conversation through the shared
  // number. Reply only to the persisted, currently assigned customer/channel.
  if (event === 'add_label') return { ...payload, ownerUid: targetOwnerUid };
  if (['get_chat_list','export_chats','update_spend_time','translate_message'].includes(event)) return payload;
  const ids = {
    load_conversation: payload.chat?.chat_id, export_conversation: payload.chatId,
    send_chat_message: payload.chatInfo?.chat_id, assign_agent_to_chat: payload.chatId,
    unasign_chat_agent: payload.cId, suggest_reply: payload.chatId, delete_chat: payload.chatId,
    save_as_context: payload.chatId,
  };
  const rowIds = { set_chat_label: payload.chatIdRow, remove_chat_label: payload.chatId, delete_chat_note: payload.chatRealId, save_chat_note: payload.id };
  const rowId = rowIds[event];
  const chatId = ids[event];
  const targetEvents = ['load_conversation','export_conversation','send_chat_message','assign_agent_to_chat','unasign_chat_agent','suggest_reply','delete_chat','set_chat_label','remove_chat_label','delete_chat_note','save_chat_note'];
  if (!chatId && !rowId) { if (scope.assignedOnly || targetEvents.includes(event)) fail(); return payload; }
  const rows = await query(`SELECT * FROM beta_chats WHERE uid=? AND ${rowId ? 'id' : 'chat_id'}=? LIMIT 1`, [targetOwnerUid, rowId || chatId]);
  if (rows.length !== 1 ||
      (scope.canonical && scope.assignedOnly && !filterAssignedChats(rows, scope).length) ||
      (!scope.canonical && (actor?.isAgent === true || actor?.role === 'agent') && !legacyAgentOwnsConversation(rows[0], actor))) fail();
  if (event === 'send_chat_message') return { ...payload, chatInfo: rows[0], ownerUid: targetOwnerUid };
  if (event === 'load_conversation') return { ...payload, chat: rows[0], ownerUid: targetOwnerUid };
  return { ...payload, ownerUid: targetOwnerUid };
}

async function authorizeAgentSpendTime(query, scope, payload, actor) {
  const agentUid = typeof actor?.uid === 'string' ? actor.uid : '';
  const isAgent = actor?.isAgent === true || actor?.role === 'agent';
  if (!isAgent || !agentUid || (scope?.canonical && scope.ctx?.membership?.role !== 'agent')) fail();
  if (typeof payload?.uid !== 'string' || payload.uid !== agentUid) fail();
  const timeSpent = payload.timeSpent;
  if (!Number.isSafeInteger(timeSpent) || timeSpent < 1 || timeSpent > 300) fail();
  const ownerUid = scope?.canonical ? scope.uid : actor.owner_uid;
  if (typeof ownerUid !== 'string' || !ownerUid) fail();
  const rows = await query('SELECT uid FROM agents WHERE uid=? AND owner_uid=? AND is_active=1 LIMIT 2', [agentUid, ownerUid]);
  if (rows.length !== 1) fail();
  return { uid: agentUid, ownerUid, timeSpent };
}

async function authorizeInboxFeature(scope, event, featureSession) {
  if (!scope?.canonical) return featureSession;
  const permission = EVENT_PERMISSIONS[event];
  if (!permission) return featureSession;
  const { capabilities, decision } = require('./policy');
  const capability = Object.entries(capabilities).find(([, permissions]) => permissions.includes(permission))?.[0];
  if (!capability || typeof featureSession?.refresh !== 'function') fail();
  const current = await featureSession.refresh();
  const context = current?.context;
  if (!context || current.ownerUid !== scope.uid || context.tenant?.id !== scope.ctx?.tenant?.id ||
      context.membership?.id !== scope.ctx?.membership?.id || context.identity?.id !== scope.ctx?.identity?.id) fail();
  const result = decision(context, { capability, permission });
  if (!result.allowed) throw Object.assign(new Error(result.code), { code: result.code });
  return current;
}

function authorizeContactDelete(scope, payload, actor) {
  if (actor?.isAgent === true || actor?.role === 'agent') fail();
  if (scope?.canonical) {
    if (!['owner', 'manager'].includes(scope.ctx?.membership?.role)) fail();
  } else if (actor?.role !== 'user') fail();
  const contactId = require('./contact-records').normalizedContactId(payload?.contactId ?? payload?.id);
  if (typeof scope?.uid !== 'string' || !scope.uid) fail();
  return { contactId, ownerUid: scope.uid };
}

module.exports = { resolveInboxUid, resolveInboxScope, filterAssignedChats, filterQrInstances, authorizeInboxPayload, authorizeAgentSpendTime, authorizeContactDelete, authorizeInboxFeature, EVENT_PERMISSIONS, legacyAgentOwnsConversation };
