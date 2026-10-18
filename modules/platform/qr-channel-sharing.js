'use strict';

const crypto = require('node:crypto');
const policy = require('./policy');
const plans = require('./plans');
const { getCategory } = require('./categories');
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

async function actorScope(db, actorUid, lock = false) {
  const [rows] = await db.query(`SELECT u.id AS userId,u.uid,t.id AS tenantId,t.status AS tenantStatus,
      t.category_key AS categoryKey,t.category_version AS categoryVersion,
      m.id AS membershipId,m.identity_id AS identityId,m.role,m.status AS membershipStatus,
      m.role_profile_id AS roleProfileId,m.assigned_navigation AS assignedNavigation,
      r.seat_role AS seatRole,r.permissions AS rolePermissions,r.status AS roleStatus,
      i.status AS identityStatus,o.legacy_uid_hash AS uidHash
    FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
    JOIN sx_tenants t ON t.id=o.tenant_id
    JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=t.id
    JOIN sx_identities i ON i.id=m.identity_id
    LEFT JOIN sx_team_roles r ON r.tenant_id=m.tenant_id AND r.id=m.role_profile_id
    WHERE u.uid=?${lock ? ' FOR UPDATE' : ''}`, [actorUid]);
  if (rows.length !== 1 || rows[0].uidHash !== digest(actorUid)) fail('BUSINESS_LINK_INVALID');
  const scope = rows[0];
  if (scope.tenantStatus !== 'active' || scope.membershipStatus !== 'active' || scope.identityStatus !== 'active') fail('BUSINESS_INACTIVE');
  if (!['owner','manager'].includes(scope.role)) fail('PERMISSION_DENIED');
  const category = getCategory(scope.categoryKey, Number(scope.categoryVersion));
  if (!category) fail('CATEGORY_UNAVAILABLE');
  let customPermissions = null;
  if (scope.roleProfileId) {
    customPermissions = typeof scope.rolePermissions === 'string' ? JSON.parse(scope.rolePermissions) : scope.rolePermissions;
    if (scope.seatRole !== scope.role || !Array.isArray(customPermissions) || !['active','archived'].includes(scope.roleStatus)) fail('TEAM_ROLE_STORAGE_INVALID');
  }
  const subscription = await plans.loadEntitlements(db, scope.tenantId);
  const assignedNavigation = scope.assignedNavigation == null ? null : JSON.parse(scope.assignedNavigation);
  const context = { audience:'tenant', identity:{id:scope.identityId}, tenant:{id:scope.tenantId,status:scope.tenantStatus,categoryKey:scope.categoryKey,categoryVersion:Number(scope.categoryVersion)}, category, subscription,
    membership:{id:scope.membershipId,tenantId:scope.tenantId,role:scope.role,status:scope.membershipStatus,customPermissions,assignedNavigation,delegatedPermissions:[]} };
  if (!policy.decision(context,{capability:'team.members',permission:'team.invite'}).allowed) fail('PERMISSION_DENIED');
  scope.category = category;
  scope.subscription = subscription;
  scope.customPermissions = customPermissions;
  return scope;
}

async function ownerIdentity(db, tenantId) {
  const [rows] = await db.query(`SELECT m.id AS membershipId,m.identity_id AS identityId,u.uid,o.legacy_uid_hash AS uidHash FROM sx_memberships m
    JOIN sx_identities i ON i.id=m.identity_id
    JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='user'
    JOIN user u ON CAST(u.id AS CHAR)=o.source_id
    WHERE m.tenant_id=? AND m.role='owner' AND m.status='active' AND i.status='active' AND u.role='user' LIMIT 2`, [tenantId]);
  if (rows.length !== 1 || rows[0].uidHash !== digest(rows[0].uid)) fail('BUSINESS_LINK_INVALID');
  return rows[0];
}

async function list(pool, ownerUid) {
  const db = await pool.getConnection();
  try {
    const scope = await actorScope(db, ownerUid);
    const owner = await ownerIdentity(db, scope.tenantId);
    const channelScope = scope.role === 'owner' ? 'i.uid=?' : `i.uid=? AND EXISTS (
        SELECT 1 FROM sx_qr_channel_shares own_share WHERE own_share.tenant_id=? AND own_share.instance_id=i.id AND own_share.membership_id=?)`;
    const channelParams = scope.role === 'owner' ? [owner.uid] : [owner.uid,scope.tenantId,scope.membershipId];
    const [channels] = await db.query(`SELECT i.id,i.title,i.number,i.status,i.uniqueId,i.createdAt,
        COUNT(chat.id) AS conversationCount
      FROM instance i LEFT JOIN beta_chats chat
        ON chat.uid=i.uid AND chat.origin='qr' AND chat.origin_instance_unique_id=i.uniqueId
      WHERE ${channelScope} GROUP BY i.id,i.title,i.number,i.status,i.uniqueId,i.createdAt ORDER BY i.createdAt DESC,i.id DESC`, channelParams);
    const [agentRows] = scope.role === 'manager' ? await db.query(`SELECT m.id AS membershipId,i.display_name AS displayName,i.email_normalized AS email,
        a.uid AS legacyUid,a.is_active AS active,o.legacy_uid_hash AS uidHash
      FROM sx_memberships m
      LEFT JOIN sx_sales_org_history org_scope ON org_scope.tenant_id=m.tenant_id AND org_scope.membership_id=m.id AND org_scope.ended_at IS NULL
      JOIN sx_identities i ON i.id=m.identity_id
      JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='agents'
      JOIN agents a ON CAST(a.id AS CHAR)=o.source_id AND a.owner_uid=?
      WHERE m.tenant_id=? AND m.role='agent' AND m.status='active' AND i.status='active' AND a.is_active=1
        AND (?='training_center' OR org_scope.manager_membership_id=?)
      ORDER BY i.display_name,i.email_normalized`, [owner.uid,scope.tenantId,scope.categoryKey,scope.membershipId]) : [[]];
    const agents = agentRows.filter(agent => agent.uidHash === digest(agent.legacyUid)).map(({membershipId,displayName,email})=>({membershipId,displayName,email}));
    const [accountantRows] = scope.role === 'manager' && scope.categoryKey === 'training_center' ? await db.query(`SELECT m.id AS membershipId,i.display_name AS displayName,i.email_normalized AS email,
        u.uid,o.legacy_uid_hash AS uidHash FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id
      JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='user'
      JOIN user u ON CAST(u.id AS CHAR)=o.source_id
      WHERE m.tenant_id=? AND m.role='accountant' AND m.status='active' AND i.status='active' AND u.role='user'
      ORDER BY i.display_name,i.email_normalized`, [scope.tenantId]) : [[]];
    const accountants = accountantRows.filter(member => member.uidHash === digest(member.uid)).map(({membershipId,displayName,email})=>({membershipId,displayName,email,role:'accountant'}));
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
      let permissions;
      try { permissions = typeof member.rolePermissions === 'string' ? JSON.parse(member.rolePermissions) : member.rolePermissions; } catch { return false; }
      const membership = { role: 'manager', customPermissions: permissions || undefined };
      return policy.scopeFor(membership, 'conversations.read') && policy.scopeFor(membership, 'conversations.reply');
    });
    const [shares] = await db.query('SELECT instance_id AS instanceId,membership_id AS membershipId,granted_by_identity_id AS grantedByIdentityId FROM sx_qr_channel_shares WHERE tenant_id=?', [scope.tenantId]);
    const recipients = [...accountants, ...agents.map(member=>({...member,role:'agent'}))];
    const byChannel = new Map(), byChannelAgents = new Map(), ownerGrantedAgents = new Map();
    for (const share of shares) {
      if (!byChannel.has(Number(share.instanceId))) byChannel.set(Number(share.instanceId), []);
      if (share.grantedByIdentityId === owner.identityId && scope.role==='owner') byChannel.get(Number(share.instanceId)).push(share.membershipId);
      if (recipients.some(member=>member.membershipId===share.membershipId) && (share.grantedByIdentityId===owner.identityId || share.grantedByIdentityId===scope.identityId)) {
        if (!byChannelAgents.has(Number(share.instanceId))) byChannelAgents.set(Number(share.instanceId), []);
        byChannelAgents.get(Number(share.instanceId)).push(share.membershipId);
        if (share.grantedByIdentityId === owner.identityId) {
          if (!ownerGrantedAgents.has(Number(share.instanceId))) ownerGrantedAgents.set(Number(share.instanceId), []);
          ownerGrantedAgents.get(Number(share.instanceId)).push(share.membershipId);
        }
      }
    }
    return {
      actorRole:scope.role,
      channels: channels.map(channel => ({
        id: Number(channel.id), title: channel.title || 'WhatsApp', number: channel.number || '',
        status: channel.status, conversationCount: Number(channel.conversationCount),
        managerMembershipIds: byChannel.get(Number(channel.id)) || [],
        agentMembershipIds:byChannelAgents.get(Number(channel.id))||[],
        recipientMembershipIds:byChannelAgents.get(Number(channel.id))||[],
        inheritedAgentMembershipIds:ownerGrantedAgents.get(Number(channel.id))||[],
      })),
      managers: scope.role==='owner' ? validMembers.map(({ membershipId, displayName, email }) => ({ membershipId, displayName, email })) : [],
      agents, recipients,
    };
  } finally { db.release(); }
}

async function saveAgentShares(pool, managerUid, instanceIdValue, agentMembershipIdsValue) {
  const instanceId=Number(instanceIdValue);
  if(!Number.isSafeInteger(instanceId)||instanceId<1)fail('INVALID_INSTANCE_ID');
  if(!Array.isArray(agentMembershipIdsValue)||agentMembershipIdsValue.length>100||agentMembershipIdsValue.some(id=>typeof id!=='string'||!idPattern.test(id)))fail('INVALID_AGENT_ASSIGNMENTS');
  const agentMembershipIds=[...new Set(agentMembershipIdsValue)],db=await pool.getConnection();
  try {
    await db.beginTransaction();
    const scope=await actorScope(db,managerUid,true);
    if(scope.role!=='manager')fail('PERMISSION_DENIED');
    const owner=await ownerIdentity(db,scope.tenantId);
    const [[channel]]=await db.query(`SELECT i.id,i.title,i.uniqueId FROM instance i
      JOIN sx_qr_channel_shares manager_share ON manager_share.instance_id=i.id AND manager_share.tenant_id=? AND manager_share.membership_id=?
      WHERE i.id=? AND i.uid=? FOR UPDATE`,[scope.tenantId,scope.membershipId,instanceId,owner.uid]);
    if(!channel)fail('QR_CHANNEL_NOT_SHARED');
    const [agents]=agentMembershipIds.length?await db.query(`SELECT m.id AS membershipId,m.identity_id AS identityId,a.uid AS legacyUid,a.is_active AS active,o.legacy_uid_hash AS uidHash
      FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id
      JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='agents'
      JOIN agents a ON CAST(a.id AS CHAR)=o.source_id AND a.owner_uid=?
      LEFT JOIN sx_sales_org_history org ON org.tenant_id=m.tenant_id AND org.membership_id=m.id AND org.ended_at IS NULL
      WHERE m.tenant_id=? AND m.id IN (?) AND m.role='agent' AND m.status='active' AND i.status='active' AND a.is_active=1
        AND (?='training_center' OR org.manager_membership_id=?) FOR UPDATE`,[owner.uid,scope.tenantId,agentMembershipIds,scope.categoryKey,scope.membershipId]):[[]];
    if(agents.length!==agentMembershipIds.length||agents.some(agent=>agent.uidHash!==digest(agent.legacyUid)))fail('INVALID_AGENT_ASSIGNMENTS');
    const [oldRows]=await db.query(`SELECT membership_id AS membershipId,granted_by_identity_id AS grantedByIdentityId FROM sx_qr_channel_shares WHERE tenant_id=? AND instance_id=? AND granted_by_identity_id=? FOR UPDATE`,[scope.tenantId,instanceId,scope.identityId]);
    const oldIds=oldRows.map(row=>row.membershipId);
    const [allCurrent]=await db.query(`SELECT membership_id AS membershipId,granted_by_identity_id AS grantedByIdentityId FROM sx_qr_channel_shares WHERE tenant_id=? AND instance_id=? FOR UPDATE`,[scope.tenantId,instanceId]);
    const nextIds=new Set(agentMembershipIds);
    const removed=oldIds.filter(id=>!agentMembershipIds.includes(id));
    if(removed.length)await db.query(`DELETE FROM sx_qr_channel_shares WHERE tenant_id=? AND instance_id=? AND granted_by_identity_id=? AND membership_id IN (?)`,[scope.tenantId,instanceId,scope.identityId,removed]);
    for(const membershipId of agentMembershipIds){
      const existing=allCurrent.find(row=>row.membershipId===membershipId);
      if(existing){
        if(existing.grantedByIdentityId!==owner.identityId&&existing.grantedByIdentityId!==scope.identityId){
          await db.query('UPDATE sx_qr_channel_shares SET granted_by_identity_id=? WHERE tenant_id=? AND instance_id=? AND membership_id=? AND granted_by_identity_id<>?',[scope.identityId,scope.tenantId,instanceId,membershipId,owner.identityId]);
        }
        continue;
      }
      await db.query('INSERT INTO sx_qr_channel_shares(tenant_id,instance_id,membership_id,granted_by_identity_id) VALUES (?,?,?,?)',[scope.tenantId,instanceId,membershipId,scope.identityId]);
    }
    const affected=[...new Set([...agentMembershipIds,...removed])];
    if(affected.length)await db.query('UPDATE sx_memberships SET permission_version=permission_version+1 WHERE tenant_id=? AND id IN (?)',[scope.tenantId,affected]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','whatsapp.qr-agent-access-updated','whatsapp-channel',?,?,?)`,[crypto.randomUUID(),scope.tenantId,scope.identityId,String(instanceId),JSON.stringify({channelTitle:channel.title,previousAgentMembershipIds:oldIds,agentMembershipIds:[...nextIds]}),crypto.randomUUID()]);
    await db.commit();
    return {instanceId,agentMembershipIds:[...nextIds]};
  }catch(error){await db.rollback();throw error;}finally{db.release();}
}

async function saveMemberShares(pool, managerUid, instanceIdValue, memberIds) {
  const instanceId=Number(instanceIdValue);
  if(!Number.isSafeInteger(instanceId)||instanceId<1)fail('INVALID_INSTANCE_ID');
  if(!Array.isArray(memberIds)||memberIds.length>100||memberIds.some(id=>typeof id!=='string'||!idPattern.test(id)))fail('INVALID_AGENT_ASSIGNMENTS');
  const ids=[...new Set(memberIds)], db=await pool.getConnection();
  try {
    await db.beginTransaction();
    const scope=await actorScope(db,managerUid,true);
    if(scope.role!=='manager')fail('PERMISSION_DENIED');
    const owner=await ownerIdentity(db,scope.tenantId);
    const [[channel]]=await db.query(`SELECT i.id,i.title,i.uniqueId FROM instance i
      JOIN sx_qr_channel_shares manager_share ON manager_share.instance_id=i.id AND manager_share.tenant_id=? AND manager_share.membership_id=?
      WHERE i.id=? AND i.uid=? FOR UPDATE`,[scope.tenantId,scope.membershipId,instanceId,owner.uid]);
    if(!channel)fail('QR_CHANNEL_NOT_SHARED');
    const [users]=ids.length?await db.query(`SELECT m.id AS membershipId,m.identity_id AS identityId,m.role,u.uid,o.legacy_uid_hash AS uidHash
      FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id
      JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='user'
      JOIN user u ON CAST(u.id AS CHAR)=o.source_id
      WHERE m.tenant_id=? AND m.id IN (?) AND m.role='accountant' AND m.status='active' AND i.status='active' AND u.role='user' FOR UPDATE`,[scope.tenantId,ids]):[[]];
    const [agents]=ids.length?await db.query(`SELECT m.id AS membershipId,m.identity_id AS identityId,m.role,a.uid,o.legacy_uid_hash AS uidHash
      FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id
      JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='agents'
      JOIN agents a ON CAST(a.id AS CHAR)=o.source_id AND a.owner_uid=?
      LEFT JOIN sx_sales_org_history org ON org.tenant_id=m.tenant_id AND org.membership_id=m.id AND org.ended_at IS NULL
      WHERE m.tenant_id=? AND m.id IN (?) AND m.role='agent' AND m.status='active' AND i.status='active' AND a.is_active=1
        AND (?='training_center' OR org.manager_membership_id=?) FOR UPDATE`,[owner.uid,scope.tenantId,ids,scope.categoryKey,scope.membershipId]):[[]];
    const valid=[...users,...agents];
    if(valid.length!==ids.length||valid.some(member=>member.uidHash!==digest(member.uid))||users.length&&scope.categoryKey!=='training_center')fail('INVALID_AGENT_ASSIGNMENTS');
    const [oldRows]=await db.query(`SELECT membership_id AS membershipId,granted_by_identity_id AS grantedByIdentityId FROM sx_qr_channel_shares WHERE tenant_id=? AND instance_id=? AND granted_by_identity_id=? FOR UPDATE`,[scope.tenantId,instanceId,scope.identityId]);
    const oldIds=oldRows.map(row=>row.membershipId), removed=oldIds.filter(id=>!ids.includes(id));
    if(removed.length)await db.query(`DELETE FROM sx_qr_channel_shares WHERE tenant_id=? AND instance_id=? AND granted_by_identity_id=? AND membership_id IN (?)`,[scope.tenantId,instanceId,scope.identityId,removed]);
    const [allCurrent]=await db.query(`SELECT membership_id AS membershipId,granted_by_identity_id AS grantedByIdentityId FROM sx_qr_channel_shares WHERE tenant_id=? AND instance_id=? FOR UPDATE`,[scope.tenantId,instanceId]);
    for(const member of valid){const existing=allCurrent.find(row=>row.membershipId===member.membershipId);if(existing){if(existing.grantedByIdentityId!==owner.identityId&&existing.grantedByIdentityId!==scope.identityId)await db.query('UPDATE sx_qr_channel_shares SET granted_by_identity_id=? WHERE tenant_id=? AND instance_id=? AND membership_id=? AND granted_by_identity_id<>?',[scope.identityId,scope.tenantId,instanceId,member.membershipId,owner.identityId]);}else await db.query('INSERT INTO sx_qr_channel_shares(tenant_id,instance_id,membership_id,granted_by_identity_id) VALUES (?,?,?,?)',[scope.tenantId,instanceId,member.membershipId,scope.identityId]);}
    const affected=[...new Set([...ids,...removed])];
    if(affected.length)await db.query('UPDATE sx_memberships SET permission_version=permission_version+1 WHERE tenant_id=? AND id IN (?)',[scope.tenantId,affected]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','whatsapp.qr-member-access-updated','whatsapp-channel',?,?,?)`,[crypto.randomUUID(),scope.tenantId,scope.identityId,String(instanceId),JSON.stringify({channelTitle:channel.title,previousMembershipIds:oldIds,membershipIds:ids}),crypto.randomUUID()]);
    await db.commit(); return {instanceId,membershipIds:ids};
  }catch(error){await db.rollback();throw error;}finally{db.release();}
}

async function saveAccess(pool, actorUid, instanceId, membershipIds) {
  const db=await pool.getConnection();
  let role;
  try { role=(await actorScope(db,actorUid)).role; }
  finally { db.release(); }
  return role==='owner' ? saveManagerShares(pool,actorUid,instanceId,membershipIds) : saveMemberShares(pool,actorUid,instanceId,membershipIds);
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
    const [oldRows] = await db.query(`SELECT share.membership_id AS membershipId,member.role,member.identity_id AS identityId
      FROM sx_qr_channel_shares share JOIN sx_memberships member ON member.tenant_id=share.tenant_id AND member.id=share.membership_id
      WHERE share.tenant_id=? AND share.instance_id=? FOR UPDATE`, [scope.tenantId, instanceId]);
    const retainedManagers=new Set(managerMembershipIds),revokedManagers=oldRows.filter(row=>row.role==='manager'&&!retainedManagers.has(row.membershipId));
    await db.query(`DELETE share FROM sx_qr_channel_shares share JOIN sx_memberships member ON member.tenant_id=share.tenant_id AND member.id=share.membership_id
      WHERE share.tenant_id=? AND share.instance_id=? AND member.role='manager'`, [scope.tenantId, instanceId]);
    for(const manager of revokedManagers){
      const [delegated]=await db.query('SELECT membership_id AS membershipId FROM sx_qr_channel_shares WHERE tenant_id=? AND instance_id=? AND granted_by_identity_id=? FOR UPDATE',[scope.tenantId,instanceId,manager.identityId]);
      await db.query('DELETE FROM sx_qr_channel_shares WHERE tenant_id=? AND instance_id=? AND granted_by_identity_id=?',[scope.tenantId,instanceId,manager.identityId]);
      const affected=[manager.membershipId,...delegated.map(row=>row.membershipId)];
      if(affected.length)await db.query('UPDATE sx_memberships SET permission_version=permission_version+1 WHERE tenant_id=? AND id IN (?)',[scope.tenantId,affected]);
    }
    for (const membershipId of managerMembershipIds) {
      await db.query('INSERT INTO sx_qr_channel_shares(tenant_id,instance_id,membership_id,granted_by_identity_id) VALUES (?,?,?,?)', [scope.tenantId, instanceId, membershipId, scope.identityId]);
    }
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','whatsapp.qr-channel-access-updated','whatsapp-channel',?,?,?)`, [
      crypto.randomUUID(), scope.tenantId, scope.identityId, String(instanceId),
      JSON.stringify({ channelTitle: channel.title, previousManagerMembershipIds: oldRows.filter(row=>row.role==='manager').map(row => row.membershipId), managerMembershipIds, revokedManagerMembershipIds:revokedManagers.map(row=>row.membershipId) }),
      crypto.randomUUID(),
    ]);
    await db.commit();
    return { instanceId, managerMembershipIds };
  } catch (error) { await db.rollback(); throw error; }
  finally { db.release(); }
}

module.exports = { list, saveManagerShares, saveAgentShares, saveMemberShares, saveAccess };
