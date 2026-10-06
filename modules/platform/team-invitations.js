'use strict';
const crypto=require('node:crypto');
const bcrypt=require('bcrypt');
const plans=require('./plans');
const seats=require('./legacy-agent-seats');
const {trainingCenter}=require('./categories');
const navigation=require('./navigation');
const policy=require('./policy');
const {decision}=policy;

const fail=code=>{throw Object.assign(new Error(code),{code});};
const digest=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
const uid=()=>crypto.randomBytes(24).toString('base64url');
function email(value){const result=typeof value==='string'?value.trim().toLowerCase():'';if(!result||result.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))fail('INVALID_EMAIL');return result;}
const staffRoles=['accountant','manager','agent'];
function role(value){if(!staffRoles.includes(value))fail('INVALID_ROLE');return value;}
function invitationId(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))fail('INVALID_ID');return value;}
function roleName(value){const name=typeof value==='string'?value.trim():'';if(!name||Array.from(name).length>80)fail('INVALID_ROLE_NAME');return name;}
function roleDescription(value){const description=typeof value==='string'?value.trim():'';if(Array.from(description).length>300)fail('INVALID_ROLE_DESCRIPTION');return description||null;}
function permissionsFor(seatRole,category=trainingCenter,subscription=null){
  const enabledCapabilities=new Set((category?.capabilities||[]).filter(capability=>subscription?.capabilities?.includes(capability)));
  const planPermissions=new Set(Object.entries(policy.capabilities).filter(([capability])=>enabledCapabilities.has(capability)).flatMap(([,items])=>items));
  return Object.keys(policy.permissions).filter(key=>!['team.read','team.invite'].includes(key)&&policy.scopeFor({role:seatRole,delegatedPermissions:seatRole==='manager'?policy.delegationAllowlist:[]},key)&&planPermissions.has(key));
}
function rolePermissions(value,seatRole,allowed=permissionsFor(seatRole)){if(!Array.isArray(value)||value.length>Object.keys(policy.permissions).length||value.some(item=>typeof item!=='string')||new Set(value).size!==value.length||value.some(item=>!allowed.includes(item)))fail('INVALID_ROLE_PERMISSIONS');return [...value].sort();}
async function tx(db,fn){await db.beginTransaction();try{const out=await fn();await db.commit();return out;}catch(error){await db.rollback();throw error;}}
async function audit(db,identityId,tenantId,action,id,changes,resourceType='team-invitation'){await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
  VALUES (?,?,?,'identity',?,?,?,?,?)`,[crypto.randomUUID(),tenantId,identityId,action,resourceType,id,JSON.stringify(changes),crypto.randomUUID()]);}
async function storage(db){
  const [[table]]=await db.query("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sx_team_invites'");
  const [columns]=await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sx_team_invites' AND COLUMN_NAME IN ('token_hash','invited_by_identity_id','accepted_at')");
  const [membershipColumns]=await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sx_memberships' AND COLUMN_NAME IN ('assigned_navigation','role_profile_id')");
  const [inviteColumns]=await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sx_team_invites' AND COLUMN_NAME='role_profile_id'");
  const [[rolesTable]]=await db.query("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sx_team_roles'");
  if(table?.ENGINE!=='InnoDB'||columns.length!==3||membershipColumns.length!==2||inviteColumns.length!==1||rolesTable?.ENGINE!=='InnoDB')fail('TEAM_INVITATION_STORAGE_NOT_READY');
}
async function ownerScope(db,ownerUid,{requireTeam=true}={}){
  const [rows]=await db.query(`SELECT u.id AS legacyUserId,u.uid,t.id AS tenantId,t.status AS tenantStatus,t.category_key AS categoryKey,t.category_version AS categoryVersion,
      m.id AS membershipId,m.identity_id AS identityId,m.role,m.status AS membershipStatus,i.status AS identityStatus,o.legacy_uid_hash AS uidHash
    FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
    JOIN sx_tenants t ON t.id=o.tenant_id JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=t.id
    JOIN sx_identities i ON i.id=m.identity_id WHERE u.uid=? FOR UPDATE`,[ownerUid]);
  if(!rows.length)fail('VERIFIED_BUSINESS_OWNER_REQUIRED');
  if(rows.length!==1||rows[0].uidHash!==digest(ownerUid))fail('BUSINESS_LINK_INVALID');
  const value=rows[0];
  if(value.role!=='owner'||value.membershipStatus!=='active'||value.identityStatus!=='active')fail('PERMISSION_DENIED');
  if(value.tenantStatus!=='active'||value.categoryKey!==trainingCenter.key||Number(value.categoryVersion)!==trainingCenter.version)fail('BUSINESS_INACTIVE');
  const [[tenant]]=await db.query('SELECT id,status,category_key,category_version FROM sx_tenants WHERE id=? FOR UPDATE',[value.tenantId]);
  if(!tenant||tenant.status!=='active')fail('BUSINESS_INACTIVE');
  const entitlement=await plans.loadEntitlements(db,value.tenantId);
  if(requireTeam&&(!entitlement||!['active','trial','grace'].includes(entitlement.status)||!entitlement.capabilities.includes('team.members')))fail('TEAM_FEATURE_UNAVAILABLE');
  return {...value,entitlement};
}
async function createRole(pool,ownerUid,input){
  const name=roleName(input?.name),seatRole=role(input?.seatRole),description=roleDescription(input?.description),id=crypto.randomUUID();
  const db=await pool.getConnection();try{return await tx(db,async()=>{await storage(db);const scope=await ownerScope(db,ownerUid);
    const permissions=rolePermissions(input?.permissions,seatRole,permissionsFor(seatRole,trainingCenter,scope.entitlement));
    await db.query('INSERT INTO sx_team_roles(id,tenant_id,name,description,seat_role,permissions,status,created_by_identity_id) VALUES (?,?,?,?,?,? ,\'active\',?)',[id,scope.tenantId,name,description,seatRole,JSON.stringify(permissions),scope.identityId]);
    await audit(db,scope.identityId,scope.tenantId,'team.role-created',id,{name,seatRole,permissions},'team-role');
    return {id,name,description,seatRole,permissions,status:'active'};
  });}catch(error){if(error.code==='ER_DUP_ENTRY')fail('ROLE_NAME_EXISTS');throw error;}finally{db.release();}
}
async function updateRole(pool,ownerUid,id,input){
  invitationId(id);const name=roleName(input?.name),description=roleDescription(input?.description);
  const db=await pool.getConnection();try{return await tx(db,async()=>{await storage(db);const scope=await ownerScope(db,ownerUid);
    const [[current]]=await db.query('SELECT id,name,description,seat_role AS seatRole,permissions,status FROM sx_team_roles WHERE tenant_id=? AND id=? FOR UPDATE',[scope.tenantId,id]);
    if(!current)fail('ROLE_NOT_FOUND');if(current.status!=='active')fail('ROLE_ARCHIVED');
    const previous=typeof current.permissions==='string'?JSON.parse(current.permissions):current.permissions;
    const permissions=rolePermissions(input?.permissions,current.seatRole,permissionsFor(current.seatRole,trainingCenter,scope.entitlement));
    await db.query('UPDATE sx_team_roles SET name=?,description=?,permissions=? WHERE tenant_id=? AND id=?',[name,description,JSON.stringify(permissions),scope.tenantId,id]);
    await db.query('UPDATE sx_memberships SET permission_version=permission_version+1 WHERE tenant_id=? AND role_profile_id=? AND status=\'active\'',[scope.tenantId,id]);
    await audit(db,scope.identityId,scope.tenantId,'team.role-updated',id,{oldName:current.name,newName:name,oldPermissions:previous,newPermissions:permissions},'team-role');
    return {id,name,description,seatRole:current.seatRole,permissions,status:'active'};
  });}catch(error){if(error.code==='ER_DUP_ENTRY')fail('ROLE_NAME_EXISTS');throw error;}finally{db.release();}
}
async function archiveRole(pool,ownerUid,id){
  invitationId(id);const db=await pool.getConnection();try{return await tx(db,async()=>{await storage(db);const scope=await ownerScope(db,ownerUid);
    const [[current]]=await db.query('SELECT id,name,status FROM sx_team_roles WHERE tenant_id=? AND id=? FOR UPDATE',[scope.tenantId,id]);
    if(!current)fail('ROLE_NOT_FOUND');if(current.status!=='active')return {id,status:'archived'};
    const [[pending]]=await db.query("SELECT id FROM sx_team_invites WHERE tenant_id=? AND role_profile_id=? AND status='pending' AND expires_at>UTC_TIMESTAMP(3) LIMIT 1 FOR UPDATE",[scope.tenantId,id]);
    if(pending)fail('ROLE_IN_USE');
    await db.query("UPDATE sx_team_roles SET status='archived' WHERE tenant_id=? AND id=?",[scope.tenantId,id]);
    await audit(db,scope.identityId,scope.tenantId,'team.role-archived',id,{name:current.name},'team-role');
    return {id,status:'archived'};
  });}finally{db.release();}
}
function publicInvitation(invite,token){return {id:invite.id,email:invite.email,role:invite.role||'agent',token,expiresInDays:7,status:'pending',delivery:'copy-link'};}
async function create(pool,ownerUid,input){
  const targetEmail=email(input?.email),profileId=input?.roleProfileId?invitationId(input.roleProfileId):null,requestKey=invitationId(input?.requestKey);
  if(!profileId)role(input?.role??'agent');
  const token=crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID();
  const db=await pool.getConnection();try{return await tx(db,async()=>{
    await storage(db);
    const scope=await ownerScope(db,ownerUid);
    let profile=null,targetRole;
    if(profileId){const [[row]]=await db.query("SELECT id,name,seat_role AS seatRole,status FROM sx_team_roles WHERE tenant_id=? AND id=? FOR UPDATE",[scope.tenantId,profileId]);if(!row||row.status!=='active')fail('ROLE_NOT_FOUND');profile=row;targetRole=role(row.seatRole);}
    else targetRole=role(input?.role??'agent');
    const [[prior]]=await db.query('SELECT id,email_normalized,role,role_profile_id AS roleProfileId,status,token_hash FROM sx_team_invites WHERE tenant_id=? AND request_key=? FOR UPDATE',[scope.tenantId,requestKey]);
    if(prior){if(prior.email_normalized!==targetEmail||prior.role!==targetRole||prior.roleProfileId!==profileId)fail('IDEMPOTENCY_CONFLICT');return {id:prior.id,email:targetEmail,role:prior.role,roleProfileId:prior.roleProfileId,status:prior.status,repeated:true,delivery:'copy-link'};}
    const [[existingAgent]]=await db.query('SELECT id FROM agents WHERE LOWER(email)=? LIMIT 1 FOR UPDATE',[targetEmail]);
    const [[existingUser]]=await db.query('SELECT id FROM user WHERE LOWER(email)=? LIMIT 1 FOR UPDATE',[targetEmail]);
    const [[existingIdentity]]=await db.query('SELECT id FROM sx_identities WHERE email_normalized=? FOR UPDATE',[targetEmail]);
    if(existingAgent||existingUser||existingIdentity)fail('MEMBERSHIP_EXISTS');
    await db.query("UPDATE sx_team_invites SET status='expired' WHERE tenant_id=? AND status='pending' AND expires_at<=UTC_TIMESTAMP(3)",[scope.tenantId]);
    const used=await seats.activeAgentCounts(db,ownerUid,scope.tenantId);
    if(used[targetRole]>=scope.entitlement.roleLimits[targetRole])fail('SEAT_LIMIT_EXCEEDED');
    const [[pending]]=await db.query("SELECT id FROM sx_team_invites WHERE tenant_id=? AND email_normalized=? AND status='pending' FOR UPDATE",[scope.tenantId,targetEmail]);
    if(pending)fail('INVITE_ALREADY_PENDING');
    const [inserted]=await db.query(`INSERT INTO sx_team_invites(id,tenant_id,request_key,email_normalized,role,role_profile_id,token_hash,invited_by_identity_id,expires_at)
      VALUES (?,?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 7 DAY))`,[id,scope.tenantId,requestKey,targetEmail,targetRole,profileId,digest(token),scope.identityId]);
    await audit(db,scope.identityId,scope.tenantId,'team.invitation-created',inserted.insertId||id,{email:targetEmail,role:targetRole,roleProfileId:profileId,roleName:profile?.name||null});
    return {...publicInvitation({id,email:targetEmail,role:targetRole},token),roleProfileId:profileId,roleName:profile?.name||null};
  });}finally{db.release();}
}
async function list(pool,ownerUid){
  const db=await pool.getConnection();try{return await tx(db,async()=>{await storage(db);const scope=await ownerScope(db,ownerUid,{requireTeam:false});
    await db.query("UPDATE sx_team_invites SET status='expired' WHERE tenant_id=? AND status='pending' AND expires_at<=UTC_TIMESTAMP(3)",[scope.tenantId]);
    const used=await seats.activeAgentCounts(db,ownerUid,scope.tenantId);
    const [pendingRows]=await db.query("SELECT role,COUNT(*) AS n FROM sx_team_invites WHERE tenant_id=? AND status='pending' AND expires_at>UTC_TIMESTAMP(3) GROUP BY role",[scope.tenantId]);
    const pending=Object.fromEntries(pendingRows.map(row=>[row.role,Number(row.n)]));
    const teamEnabled=Boolean(scope.entitlement&&['active','trial','grace'].includes(scope.entitlement.status)&&scope.entitlement.capabilities.includes('team.members'));
    const seatUsage=Object.fromEntries(staffRoles.map(key=>{const pendingCount=pending[key]||0,limit=scope.entitlement?.roleLimits?.[key]??null,total=Number(used[key]||0);return [key,{active:Math.max(0,total-pendingCount),pending:pendingCount,limit,available:!teamEnabled||limit===null?0:Math.max(0,limit-total)}];}));
    const [roles]=await db.query(`SELECT id,name,description,seat_role AS seatRole,permissions,status,created_at AS createdAt,updated_at AS updatedAt
      FROM sx_team_roles WHERE tenant_id=? ORDER BY FIELD(status,'active','archived'),name,id`,[scope.tenantId]);
    const normalizedRoles=roles.map(item=>({...item,permissions:typeof item.permissions==='string'?JSON.parse(item.permissions):item.permissions}));
    const [rows]=await db.query(`SELECT v.id,v.email_normalized AS email,v.role,v.role_profile_id AS roleProfileId,r.name AS roleName,v.status,DATE_FORMAT(v.expires_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS expiresAt
      FROM sx_team_invites v LEFT JOIN sx_team_roles r ON r.id=v.role_profile_id AND r.tenant_id=v.tenant_id
      WHERE v.tenant_id=? AND v.token_hash IS NOT NULL ORDER BY v.created_at DESC,v.id LIMIT 200`,[scope.tenantId]);
    const [members]=await db.query(`SELECT m.id,m.identity_id AS identityId,m.role,m.role_profile_id AS roleProfileId,r.name AS roleName,r.permissions AS rolePermissions,i.email_normalized AS email,i.display_name AS displayName,
        m.assigned_navigation AS assignedNavigation
      FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id LEFT JOIN sx_team_roles r ON r.id=m.role_profile_id AND r.tenant_id=m.tenant_id
      WHERE m.tenant_id=? AND m.status='active' AND i.status='active' AND m.role IN ('accountant','manager','agent')
      ORDER BY i.display_name,i.email_normalized LIMIT 500`,[scope.tenantId]);
    const tenant={id:scope.tenantId,status:scope.tenantStatus,categoryKey:scope.categoryKey,categoryVersion:Number(scope.categoryVersion)};
    const navigationByRole=Object.fromEntries(staffRoles.map(memberRole=>{
      const context={audience:'tenant',tenant,category:trainingCenter,subscription:scope.entitlement,
        membership:{id:'preview',tenantId:scope.tenantId,role:memberRole,status:'active',delegatedPermissions:[]}};
      return [memberRole,navigation.navigationFor(context).map(item=>({key:item.key,label:item.label,group:item.group}))];
    }));
    const navigationByRoleProfile=Object.fromEntries(normalizedRoles.map(item=>{
      const context={audience:'tenant',tenant,category:trainingCenter,subscription:scope.entitlement,
        membership:{id:'preview',tenantId:scope.tenantId,role:item.seatRole,status:'active',delegatedPermissions:[],customPermissions:item.permissions}};
      return [item.id,navigation.navigationFor(context).map(entry=>({key:entry.key,label:entry.label,group:entry.group}))];
    }));
    return {invitations:rows,members:members.map(member=>({...member,permissions:member.roleProfileId?(typeof member.rolePermissions==='string'?JSON.parse(member.rolePermissions):member.rolePermissions):null,assignedNavigation:parseNavigation(member.assignedNavigation)})),roles:normalizedRoles,permissionCatalog:Object.fromEntries(staffRoles.map(key=>[key,permissionsFor(key,trainingCenter,scope.entitlement)])),navigationByRole,navigationByRoleProfile,availableRoles:staffRoles.filter(key=>seatUsage[key].available>0),unsupportedRoles:[],seatUsage};
  });}finally{db.release();}
}
async function sidebarAccess(pool,legacyUid){
  if(typeof legacyUid!=='string'||!legacyUid)fail('AUTH_REQUIRED');
  const db=await pool.getConnection();
  try{
    const [rows]=await db.query(`SELECT m.id,m.role,m.role_profile_id AS roleProfileId,r.permissions AS rolePermissions,m.status AS membershipStatus,m.assigned_navigation AS assignedNavigation,
        t.id AS tenantId,t.status AS tenantStatus,t.category_key AS categoryKey,t.category_version AS categoryVersion,o.legacy_uid_hash AS uidHash
      FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
      JOIN sx_tenants t ON t.id=o.tenant_id JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=t.id
      LEFT JOIN sx_team_roles r ON r.id=m.role_profile_id AND r.tenant_id=m.tenant_id
      JOIN sx_identities i ON i.id=m.identity_id
      WHERE u.uid=? AND i.status='active' LIMIT 2`,[legacyUid]);
    if(rows.length!==1||rows[0].uidHash!==digest(legacyUid)||rows[0].membershipStatus!=='active'||rows[0].tenantStatus!=='active')fail('PERMISSION_DENIED');
    const customPermissions=rows[0].roleProfileId?(typeof rows[0].rolePermissions==='string'?JSON.parse(rows[0].rolePermissions):rows[0].rolePermissions):null;
    if(rows[0].roleProfileId&&!Array.isArray(customPermissions))fail('TEAM_ROLE_STORAGE_INVALID');
    const subscription=await plans.loadEntitlements(db,rows[0].tenantId);
    const tenant={id:rows[0].tenantId,status:rows[0].tenantStatus,categoryKey:rows[0].categoryKey,categoryVersion:Number(rows[0].categoryVersion)};
    const context={audience:'tenant',tenant,category:trainingCenter,subscription,membership:{id:rows[0].id,tenantId:rows[0].tenantId,role:rows[0].role,status:'active',delegatedPermissions:[],customPermissions}};
    const roleNavigation=navigation.navigationFor(context).map(item=>item.key);
    return {role:rows[0].role,roleProfileId:rows[0].roleProfileId||null,customPermissions,roleNavigation,assignedNavigation:parseNavigation(rows[0].assignedNavigation)};
  }finally{db.release();}
}
function parseNavigation(value){
  try{const keys=typeof value==='string'?JSON.parse(value):value;return Array.isArray(keys)&&keys.every(key=>typeof key==='string')?keys:null;}
  catch{return null;}
}
async function updateMemberNavigation(pool,ownerUid,membershipId,input){
  invitationId(membershipId);
  if(!input||!Array.isArray(input.navigation)||input.navigation.length>100||input.navigation.some(key=>typeof key!=='string')||new Set(input.navigation).size!==input.navigation.length)fail('INVALID_NAVIGATION');
  const db=await pool.getConnection();
  try{return await tx(db,async()=>{
    await storage(db);const scope=await ownerScope(db,ownerUid);
    const [[member]]=await db.query(`SELECT m.id,m.identity_id AS identityId,m.role,m.role_profile_id AS roleProfileId,r.permissions AS rolePermissions,m.assigned_navigation AS assignedNavigation
      FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id LEFT JOIN sx_team_roles r ON r.id=m.role_profile_id AND r.tenant_id=m.tenant_id
      WHERE m.tenant_id=? AND m.id=? AND m.status='active' AND i.status='active' AND m.role IN ('accountant','manager','agent') FOR UPDATE`,[scope.tenantId,membershipId]);
    if(!member)fail('MEMBER_NOT_FOUND');
    const customPermissions=member.roleProfileId?(typeof member.rolePermissions==='string'?JSON.parse(member.rolePermissions):member.rolePermissions):null;
    if(member.roleProfileId&&!Array.isArray(customPermissions))fail('TEAM_ROLE_STORAGE_INVALID');
    const context={audience:'tenant',tenant:{id:scope.tenantId,status:scope.tenantStatus,categoryKey:scope.categoryKey,categoryVersion:Number(scope.categoryVersion)},category:trainingCenter,subscription:scope.entitlement,
      membership:{id:member.id,tenantId:scope.tenantId,role:member.role,status:'active',delegatedPermissions:[],customPermissions}};
    const allowed=new Set(navigation.navigationFor(context).map(item=>item.key));
    if(input.navigation.some(key=>!allowed.has(key)))fail('NAVIGATION_NOT_AVAILABLE');
    const old=parseNavigation(member.assignedNavigation);
    await db.query('UPDATE sx_memberships SET assigned_navigation=?,permission_version=permission_version+1 WHERE id=? AND tenant_id=?',[JSON.stringify(input.navigation),member.id,scope.tenantId]);
    await audit(db,scope.identityId,scope.tenantId,'team.navigation-updated',member.id,{oldNavigation:old,newNavigation:input.navigation});
    return {membershipId:member.id,assignedNavigation:input.navigation};
  });}finally{db.release();}
}
async function rotate(pool,ownerUid,id){
  invitationId(id);const token=crypto.randomBytes(32).toString('base64url'),db=await pool.getConnection();
  try{return await tx(db,async()=>{await storage(db);const scope=await ownerScope(db,ownerUid);const [[invite]]=await db.query('SELECT v.id,v.email_normalized AS email,v.role,v.role_profile_id AS roleProfileId,r.name AS roleName,r.status AS roleStatus,v.status,v.expires_at<=UTC_TIMESTAMP(3) AS expired_now FROM sx_team_invites v LEFT JOIN sx_team_roles r ON r.id=v.role_profile_id AND r.tenant_id=v.tenant_id WHERE v.tenant_id=? AND v.id=? FOR UPDATE',[scope.tenantId,id]);
    if(!invite)fail('INVITE_NOT_FOUND');if(!['pending','expired'].includes(invite.status))fail('INVITE_NOT_PENDING');
    if(invite.roleProfileId&&invite.roleStatus!=='active')fail('ROLE_ARCHIVED');
    const expired=invite.status==='expired'||Boolean(invite.expired_now);
    if(expired){const [[agent]]=await db.query('SELECT id FROM agents WHERE LOWER(email)=? LIMIT 1 FOR UPDATE',[invite.email]);const [[user]]=await db.query('SELECT id FROM user WHERE LOWER(email)=? LIMIT 1 FOR UPDATE',[invite.email]);const [[identity]]=await db.query('SELECT id FROM sx_identities WHERE email_normalized=? FOR UPDATE',[invite.email]);if(agent||user||identity)fail('MEMBERSHIP_EXISTS');const used=await seats.activeAgentCounts(db,ownerUid,scope.tenantId);if(used[invite.role]>=scope.entitlement.roleLimits[invite.role])fail('SEAT_LIMIT_EXCEEDED');}
    await db.query("UPDATE sx_team_invites SET token_hash=?,status='pending',expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 7 DAY) WHERE id=?",[digest(token),id]);
    await audit(db,scope.identityId,scope.tenantId,'team.invitation-rotated',id,{role:invite.role,roleProfileId:invite.roleProfileId});return {...publicInvitation(invite,token),roleProfileId:invite.roleProfileId||null,roleName:invite.roleName||null};
  });}finally{db.release();}
}
async function cancel(pool,ownerUid,id){
  invitationId(id);const db=await pool.getConnection();try{return await tx(db,async()=>{await storage(db);const scope=await ownerScope(db,ownerUid,{requireTeam:false});const [[invite]]=await db.query('SELECT status FROM sx_team_invites WHERE tenant_id=? AND id=? FOR UPDATE',[scope.tenantId,id]);
    if(!invite)fail('INVITE_NOT_FOUND');if(invite.status!=='pending')fail('INVITE_NOT_PENDING');
    await db.query("UPDATE sx_team_invites SET status='cancelled' WHERE id=?",[id]);await audit(db,scope.identityId,scope.tenantId,'team.invitation-cancelled',id,{});return {id,status:'cancelled'};
  });}finally{db.release();}
}
async function preview(pool,token){
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))fail('INVITE_INVALID');
  const db=await pool.getConnection();try{
    await storage(db);
    const [[invite]]=await db.query(`SELECT v.email_normalized AS email,v.role,r.name AS roleName,v.role_profile_id AS roleProfileId,t.slug AS tenantSlug,t.name AS businessName,t.status AS tenantStatus,t.category_key AS categoryKey,t.category_version AS categoryVersion,v.expires_at>UTC_TIMESTAMP(3) AS validNow
      FROM sx_team_invites v JOIN sx_tenants t ON t.id=v.tenant_id LEFT JOIN sx_team_roles r ON r.id=v.role_profile_id AND r.tenant_id=v.tenant_id WHERE v.token_hash=? AND v.status='pending' LIMIT 1`,[digest(token)]);
    if(!invite||!invite.validNow||invite.tenantStatus!=='active'||invite.categoryKey!==trainingCenter.key||Number(invite.categoryVersion)!==trainingCenter.version)fail('INVITE_INVALID');
    return {email:invite.email,role:invite.role,roleName:invite.roleName||null,businessName:invite.businessName,tenantSlug:invite.tenantSlug};
  }finally{db.release();}
}
async function accept(pool,input){
  if(typeof input?.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.token))fail('INVITE_INVALID');
  const name=typeof input.displayName==='string'?input.displayName.trim():'';
  if(!name||name.length>200)fail('INVALID_DISPLAY_NAME');
  const mobile=typeof input.mobile==='string'?input.mobile.trim():'';
  if(mobile&&!/^\+[1-9][0-9]{7,14}$/.test(mobile))fail('INVALID_MOBILE');
  if(typeof input.password!=='string'||Array.from(input.password).length<12||Buffer.byteLength(input.password,'utf8')>72)fail('INVALID_PASSWORD');
  const db=await pool.getConnection();
  try{return await tx(db,async()=>{
    await storage(db);
    const [[invite]]=await db.query(`SELECT v.id,v.tenant_id AS tenantId,v.email_normalized AS email,v.role,v.role_profile_id AS roleProfileId,r.status AS roleStatus,v.status,v.expires_at>UTC_TIMESTAMP(3) AS valid_now,t.slug AS tenantSlug
      FROM sx_team_invites v JOIN sx_tenants t ON t.id=v.tenant_id LEFT JOIN sx_team_roles r ON r.id=v.role_profile_id AND r.tenant_id=v.tenant_id WHERE v.token_hash=? FOR UPDATE`,[digest(input.token)]);
    if(!invite||invite.status!=='pending'||!invite.valid_now||!staffRoles.includes(invite.role))fail('INVITE_INVALID');
    if(invite.roleProfileId&&invite.roleStatus!=='active')fail('INVITE_INVALID');
    if(invite.role==='agent'&&!mobile)fail('INVALID_MOBILE');
    const [[tenant]]=await db.query('SELECT id,status,category_key,category_version FROM sx_tenants WHERE id=? FOR UPDATE',[invite.tenantId]);
    if(!tenant||tenant.status!=='active'||tenant.category_key!==trainingCenter.key||Number(tenant.category_version)!==trainingCenter.version)fail('INVITE_INVALID');
    const [[owner]]=await db.query(`SELECT u.id,u.uid FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
      JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id AND m.role='owner' AND m.status='active'
      WHERE o.tenant_id=? FOR UPDATE`,[tenant.id]);
    if(!owner||!owner.uid)fail('BUSINESS_LINK_INVALID');
    const [[ownerMap]]=await db.query(`SELECT m.identity_id,o.legacy_uid_hash FROM sx_legacy_ownership o JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=o.tenant_id
      WHERE o.source_table='user' AND o.source_id=CAST(? AS CHAR) AND o.tenant_id=? AND m.role='owner' AND m.status='active'`,[owner.id,tenant.id]);
    if(!ownerMap||ownerMap.legacy_uid_hash!==digest(owner.uid))fail('BUSINESS_LINK_INVALID');
    const entitlement=await plans.loadEntitlements(db,tenant.id);
    if(!entitlement||!['active','trial','grace'].includes(entitlement.status)||!entitlement.capabilities.includes('team.members'))fail('TEAM_FEATURE_UNAVAILABLE');
    const [[existingAgent]]=await db.query('SELECT id FROM agents WHERE LOWER(email)=? LIMIT 1 FOR UPDATE',[invite.email]);
    const [[existingUser]]=await db.query('SELECT id FROM user WHERE LOWER(email)=? LIMIT 1 FOR UPDATE',[invite.email]);
    const [[existingIdentity]]=await db.query('SELECT id FROM sx_identities WHERE email_normalized=? FOR UPDATE',[invite.email]);
    if(existingAgent||existingUser||existingIdentity)fail('MEMBERSHIP_EXISTS');
    const used=await seats.activeAgentCounts(db,owner.uid,tenant.id);
    if(Math.max(0,Number(used[invite.role]||0)-1)>=entitlement.roleLimits[invite.role])fail('SEAT_LIMIT_EXCEEDED');
    const passwordHash=await bcrypt.hash(input.password,12),agentUid=invite.role==='agent'?uid():null;
    const identityId=crypto.randomUUID(),membershipId=crypto.randomUUID();
    await db.query("UPDATE sx_team_invites SET status='accepted',accepted_at=UTC_TIMESTAMP(3) WHERE id=?",[invite.id]);
    await db.query("INSERT INTO sx_identities(id,email_normalized,display_name,password_hash,status) VALUES (?,?,?,?, 'active')",[identityId,invite.email,name,passwordHash]);
    await db.query('INSERT INTO sx_memberships(id,tenant_id,identity_id,role,role_profile_id,status) VALUES (?,?,?,?,?,\'active\')',[membershipId,tenant.id,identityId,invite.role,invite.roleProfileId||null]);
    if(invite.role==='agent'){
      const [agent]=await db.query(`INSERT INTO agents(owner_uid,uid,email,password,name,mobile,comments,role,is_active) VALUES (?,?,?,?,?,?,?,'agent',1)`,[owner.uid,agentUid,invite.email,passwordHash,name,mobile,'']);
      await db.query(`INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash,verified_at) VALUES ('agents',?,?,?,?,UTC_TIMESTAMP(3))`,[String(agent.insertId),tenant.id,membershipId,digest(agentUid)]);
    }else{
      // Keep the existing /user/login and user-shell contract. The canonical
      // ownership link preserves the accountant/manager role for tenant APIs;
      // the legacy UID is a staff identity, never the business owner's UID.
      const staffUid=uid();
      const [legacyUser]=await db.query(`INSERT INTO user(uid,name,email,password,role) VALUES (?,?,?,?, 'user')`,[staffUid,name,invite.email,passwordHash]);
      await db.query(`INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash,verified_at) VALUES ('user',?,?,?,?,UTC_TIMESTAMP(3))`,[String(legacyUser.insertId),tenant.id,membershipId,digest(staffUid)]);
    }
    await audit(db,identityId,tenant.id,'team.invitation-accepted',invite.id,{role:invite.role,roleProfileId:invite.roleProfileId||null});
    return {status:'accepted',email:invite.email,role:invite.role,roleProfileId:invite.roleProfileId||null,agentUid,tenantSlug:invite.tenantSlug};
  });}finally{db.release();}
}
module.exports={create,list,createRole,updateRole,archiveRole,sidebarAccess,updateMemberNavigation,rotate,cancel,preview,accept,email,role,permissionsFor,rolePermissions,parseNavigation};
