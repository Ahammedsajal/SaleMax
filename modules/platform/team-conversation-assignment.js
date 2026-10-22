'use strict';
const crypto = require('node:crypto');
const { scopeFor } = require('./policy');
const fail = code => { throw Object.assign(new Error(code), { code, status: 403 }); };
function assignments(value) {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
function ownsConversation(value, identityId, actorUid = null, actorLegacyId = null) {
  return assignments(value).some(item =>
    (item?.kind === 'identity' && item.identityId === identityId) ||
    (actorUid && item?.uid === actorUid) ||
    (actorLegacyId && Number(item?.id) === Number(actorLegacyId))
  );
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
  const [[chat]] = await db.query('SELECT assigned_agent,origin,sender_name,sender_mobile FROM beta_chats WHERE uid=? AND chat_id=? FOR UPDATE', [uid, chatId]);
  if (!chat) fail('CONVERSATION_NOT_FOUND');
  const scope = scopeFor(ctx.membership, 'conversations.reply');
  if (!scope || (scope === 'assigned' && !ownsConversation(chat.assigned_agent, ctx.identity.id, ctx.actorUid, ctx.actorLegacyId))) fail('CONVERSATION_TRANSFER_DENIED');
  const targets = (await eligibleStaff(db, ctx.tenant.id)).filter(item => item.identityId === identityId);
  if (targets.length !== 1) fail('CONVERSATION_ASSIGNEE_INVALID');
  const target = targets[0];
  const assignee = { kind: 'identity', identityId: target.identityId, uid: target.uid, name: target.name,
    ...(target.role === 'agent' && target.sourceTable === 'agents' ? { id: Number(target.legacyId) } : {}) };
  const previous = assignments(chat.assigned_agent);
  let lead=null;
  if(ctx.tenant.categoryKey==='training_center'&&target.role==='agent'&&target.sourceTable==='agents'){
    lead=await require('./conversation-lead-assignment').assign(db,{ctx,uid,chatId,chat,agentId:Number(target.legacyId),agentName:target.name});
  }
  await db.query('UPDATE beta_chats SET assigned_agent=? WHERE uid=? AND chat_id=?', [JSON.stringify([assignee]), uid, chatId]);
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?,?,?,'identity','conversation.transferred','conversation',?,?,?)`,
  [crypto.randomUUID(), ctx.tenant.id, ctx.identity.id, chatId, JSON.stringify({ previousIdentityIds: previous.map(item => item.identityId).filter(Boolean), identityId, reason: String(reason).slice(0, 120) }), crypto.randomUUID()]);
  return { assignee, previous, lead };
}

async function eligibleStaff(db, tenantId) {
  const [rows] = await db.query(`SELECT i.id AS identityId,i.display_name AS name,i.email_normalized AS email,u.uid,u.id AS legacyId,u.sourceTable,m.id AS membershipId,m.role,m.role_profile_id AS roleProfileId,
      r.permissions AS rolePermissions,r.status AS roleStatus,r.seat_role AS seatRole,o.legacy_uid_hash AS uidHash
    FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id
    JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table IN ('user','agents')
    JOIN (SELECT id,uid,'user' AS sourceTable,NULL AS owner_uid FROM user
      UNION ALL SELECT id,uid,'agents' AS sourceTable,owner_uid FROM agents WHERE is_active=1) u
      ON u.id=CAST(o.source_id AS UNSIGNED) AND u.sourceTable=o.source_table
    LEFT JOIN sx_team_roles r ON r.tenant_id=m.tenant_id AND r.id=m.role_profile_id
    WHERE m.tenant_id=? AND m.status='active' AND i.status='active'
      AND (u.sourceTable='user' OR EXISTS (SELECT 1 FROM user own
        JOIN sx_legacy_ownership oo ON oo.source_table='user' AND oo.source_id=CAST(own.id AS CHAR)
        JOIN sx_memberships om ON om.id=oo.membership_id AND om.tenant_id=m.tenant_id AND om.role='owner' AND om.status='active'
        WHERE own.uid=u.owner_uid)) ORDER BY i.display_name,i.id`, [tenantId]);
  return rows.filter(row => {
    if (row.uidHash !== crypto.createHash('sha256').update(row.uid).digest('hex')) return false;
    const member = { role: row.role };
    if (row.roleProfileId) {
      if (row.seatRole !== row.role || !['active', 'archived'].includes(row.roleStatus)) return false;
      member.customPermissions = permissions(row.rolePermissions);
    }
    return Boolean(scopeFor(member, 'conversations.read') && scopeFor(member, 'conversations.reply'));
  }).map(({ identityId, name, email, uid, legacyId, sourceTable, membershipId, role }) => ({ kind: 'identity', identityId, name, email, uid, legacyId:Number(legacyId), sourceTable, membershipId, role }));
}

// Add-agent keeps every existing assignee. Transfers continue to use
// assignConversation above, which deliberately replaces the assignee list.
async function addConversationAgent(db, { ctx, uid, chatId, identityId }) {
  if (!ctx?.tenant?.id || !ctx?.identity?.id || typeof chatId !== 'string' || !chatId || chatId.length > 255) fail('CONVERSATION_ASSIGNMENT_INVALID');
  const [[owner]] = await db.query(`SELECT u.uid,o.legacy_uid_hash AS uidHash FROM sx_memberships m
    JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='user'
    JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED) JOIN sx_identities i ON i.id=m.identity_id
    WHERE m.tenant_id=? AND m.role='owner' AND m.status='active' AND i.status='active' AND u.uid=? LIMIT 1`, [ctx.tenant.id, uid]);
  if (!owner || owner.uidHash !== crypto.createHash('sha256').update(uid).digest('hex')) fail('CONVERSATION_OWNER_INVALID');
  const [[chat]] = await db.query('SELECT assigned_agent,origin,sender_name,sender_mobile FROM beta_chats WHERE uid=? AND chat_id=? FOR UPDATE', [uid, chatId]);
  if (!chat) fail('CONVERSATION_NOT_FOUND');
  const scope = scopeFor(ctx.membership, 'conversations.reply');
  if (!scope || (scope === 'assigned' && !ownsConversation(chat.assigned_agent, ctx.identity.id, ctx.actorUid, ctx.actorLegacyId))) fail('CONVERSATION_TRANSFER_DENIED');
  const targets = (await eligibleStaff(db, ctx.tenant.id)).filter(item => item.identityId === identityId && item.role === 'agent' && item.sourceTable === 'agents');
  if (targets.length !== 1) fail('CONVERSATION_ASSIGNEE_INVALID');
  const target = targets[0];
  const assignee = { kind: 'identity', identityId: target.identityId, uid: target.uid, name: target.name, id: target.legacyId };
  const previous = assignments(chat.assigned_agent);
  const alreadyAssigned = previous.some(item => item?.identityId === target.identityId || item?.uid === target.uid || Number(item?.id) === target.legacyId);
  if (alreadyAssigned) return { assignee, previous, added: false };
  const next = [...previous, assignee];
  await db.query('UPDATE beta_chats SET assigned_agent=? WHERE uid=? AND chat_id=?', [JSON.stringify(next), uid, chatId]);
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?,?,?,'identity','conversation.agent-added','conversation',?,?,?)`,
  [crypto.randomUUID(), ctx.tenant.id, ctx.identity.id, chatId, JSON.stringify({ previousIdentityIds: previous.map(item => item.identityId).filter(Boolean), addedIdentityId: target.identityId }), crypto.randomUUID()]);
  return { assignee, previous, added: true };
}

function chooseAvailableStaff(staff, connectedUids, chats, fallbackIdentityId) {
  const online = new Set(connectedUids);
  const candidates = staff.filter(item => item.role !== 'owner' && online.has(item.uid));
  const count = identityId => chats.filter(chat => ownsConversation(chat.assigned_agent, identityId)).length;
  candidates.sort((a, b) => count(a.identityId) - count(b.identityId) || a.identityId.localeCompare(b.identityId));
  return candidates[0] || staff.find(item => item.identityId === fallbackIdentityId) || null;
}

async function routeIncomingConversation(pool, { ctx, profile, uid, chatId, connectedUids }) {
  if (profile.config?.sharedInboxRouting !== true) return null;
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    // Serialize workload selection for simultaneous incoming conversations.
    await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE', [ctx.tenant.id]);
    const [[chat]] = await db.query('SELECT assigned_agent FROM beta_chats WHERE uid=? AND chat_id=? FOR UPDATE', [uid, chatId]);
    if (!chat || assignments(chat.assigned_agent).length) { await db.commit(); return null; }
    const staff = await eligibleStaff(db, ctx.tenant.id);
    const [chats] = await db.query('SELECT assigned_agent FROM beta_chats WHERE uid=?', [uid]);
    const target = chooseAvailableStaff(staff, connectedUids, chats, profile.config.handoffAssigneeIdentityId);
    if (!target) { await db.commit(); return null; }
    const result = await assignConversation(db, { ctx, uid, chatId, identityId: target.identityId, reason: connectedUids.includes(target.uid) ? 'incoming-online-staff' : 'incoming-manager-queue' });
    await db.commit();
    return result;
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}

module.exports = { assignConversation, addConversationAgent, assignments, ownsConversation, eligibleStaff, chooseAvailableStaff, routeIncomingConversation };
