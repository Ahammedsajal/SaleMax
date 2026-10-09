'use strict';
const crypto = require('node:crypto');
const { scopeFor } = require('./policy');
const fail = code => { throw Object.assign(new Error(code), { code, status: 403 }); };
function assignments(value) {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
function ownsConversation(value, identityId) {
  return assignments(value).some(item => item?.kind === 'identity' && item.identityId === identityId);
}
function permissions(value) {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? parsed : []; }
  catch { return []; }
}

// Caller owns the transaction. Row locking makes concurrent transfers replace
// exactly one assignee while keeping the existing owner/channel/chat ID intact.
async function assignConversation(db, { ctx, uid, chatId, identityId, reason = 'staff-transfer' }) {
  if (!ctx?.tenant?.id || !ctx?.identity?.id || typeof chatId !== 'string' || !chatId || chatId.length > 255) fail('CONVERSATION_ASSIGNMENT_INVALID');
  const [[owner]] = await db.query(`SELECT u.uid,o.legacy_uid_hash AS uidHash FROM sx_memberships m
    JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='user'
    JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED) JOIN sx_identities i ON i.id=m.identity_id
    WHERE m.tenant_id=? AND m.role='owner' AND m.status='active' AND i.status='active' AND u.uid=? LIMIT 1`, [ctx.tenant.id, uid]);
  if (!owner || owner.uidHash !== crypto.createHash('sha256').update(uid).digest('hex')) fail('CONVERSATION_OWNER_INVALID');
  const [[chat]] = await db.query('SELECT assigned_agent FROM beta_chats WHERE uid=? AND chat_id=? FOR UPDATE', [uid, chatId]);
  if (!chat) fail('CONVERSATION_NOT_FOUND');
  const scope = scopeFor(ctx.membership, 'conversations.reply');
  if (!scope || (scope === 'assigned' && !ownsConversation(chat.assigned_agent, ctx.identity.id))) fail('CONVERSATION_TRANSFER_DENIED');
  const [targets] = await db.query(`SELECT i.id AS identityId,i.display_name AS name,u.uid,m.role,m.role_profile_id AS roleProfileId,
      r.permissions AS rolePermissions,r.status AS roleStatus,r.seat_role AS seatRole,o.legacy_uid_hash AS uidHash
    FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id
    JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='user'
    JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED)
    LEFT JOIN sx_team_roles r ON r.tenant_id=m.tenant_id AND r.id=m.role_profile_id
    WHERE m.tenant_id=? AND i.id=? AND m.status='active' AND i.status='active' LIMIT 2`, [ctx.tenant.id, identityId]);
  if (targets.length !== 1) fail('CONVERSATION_ASSIGNEE_INVALID');
  const target = targets[0];
  const membership = { role: target.role };
  if (target.roleProfileId) {
    if (target.seatRole !== target.role || !['active', 'archived'].includes(target.roleStatus)) fail('CONVERSATION_ASSIGNEE_INVALID');
    membership.customPermissions = permissions(target.rolePermissions);
  }
  if (!scopeFor(membership, 'conversations.reply') || target.uidHash !== crypto.createHash('sha256').update(target.uid).digest('hex')) fail('CONVERSATION_ASSIGNEE_INVALID');
  const assignee = { kind: 'identity', identityId: target.identityId, uid: target.uid, name: target.name };
  const previous = assignments(chat.assigned_agent);
  await db.query('UPDATE beta_chats SET assigned_agent=? WHERE uid=? AND chat_id=?', [JSON.stringify([assignee]), uid, chatId]);
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?,?,?,'identity','conversation.transferred','conversation',?,?,?)`,
  [crypto.randomUUID(), ctx.tenant.id, ctx.identity.id, chatId, JSON.stringify({ previousIdentityIds: previous.map(item => item.identityId).filter(Boolean), identityId, reason: String(reason).slice(0, 120) }), crypto.randomUUID()]);
  return { assignee, previous };
}

module.exports = { assignConversation, assignments, ownsConversation };
