'use strict';
const crypto=require('node:crypto');
const bcrypt=require('bcrypt');
const plans=require('./plans');
const seats=require('./legacy-agent-seats');
const {trainingCenter,getCategory}=require('./categories');
const navigation=require('./navigation');
const policy=require('./policy');
const {decision}=policy;

const fail=code=>{throw Object.assign(new Error(code),{code});};
const digest=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
const uid=()=>crypto.randomBytes(24).toString('base64url');
function email(value){const result=typeof value==='string'?value.trim().toLowerCase():'';if(!result||result.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))fail('INVALID_EMAIL');return result;}
const staffRoles=['accountant','manager','team_leader','agent'];
function role(value){if(!staffRoles.includes(value))fail('INVALID_ROLE');return value;}
function invitationId(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))fail('INVALID_ID');return value;}
function roleName(value){const name=typeof value==='string'?value.trim():'';if(!name||Array.from(name).length>80)fail('INVALID_ROLE_NAME');return name;}
function roleDescription(value){const description=typeof value==='string'?value.trim():'';if(Array.from(description).length>300)fail('INVALID_ROLE_DESCRIPTION');return description||null;}
function permissionsFor(seatRole,category=trainingCenter,subscription=null){
  const enabledCapabilities=new Set((category?.capabilities||[]).filter(capability=>subscription?.capabilities?.includes(capability)));
  const planPermissions=new Set(Object.entries(policy.capabilities).filter(([capability])=>enabledCapabilities.has(capability)).flatMap(([,items])=>items));
  return Object.keys(policy.permissions).filter(key=>{
    const allowed=policy.scopeFor({role:seatRole,customPermissions:['manager','team_leader','agent'].includes(seatRole)?[key]:null,delegatedPermissions:seatRole==='manager'?policy.delegationAllowlist:[]},key)||category?.key==='7network_sales'&&seatRole==='manager'&&key==='team.invite';
    return allowed&&planPermissions.has(key);
  });
}
function rolePermissions(value,seatRole,allowed=permissionsFor(seatRole)){if(!Array.isArray(value)||value.length>Object.keys(policy.permissions).length||value.some(item=>typeof item!=='string')||new Set(value).size!==value.length||value.some(item=>!allowed.includes(item)))fail('INVALID_ROLE_PERMISSIONS');return [...value].sort();}
function validateRoleSidebar(value,permissions,seatRole,scope){
  const selected=navigation.parseSidebar(value);if(selected===null)return null;
  const context={audience:'tenant',tenant:{id:scope.tenantId,status:'active',categoryKey:scope.category.key,categoryVersion:scope.category.version},membership:{tenantId:scope.tenantId,role:seatRole,status:'active',customPermissions:permissions,delegatedPermissions:[]},category:scope.category,subscription:scope.entitlement};
  const available=new Set(navigation.navigationFor(context).filter(item=>item.sidebar!==false).map(item=>item.key));
  if(selected.some(key=>!available.has(key)))fail('INVALID_ROLE_NAVIGATION');
  return selected;
}
function memberRoleProfileId(memberRole,profile){
  if(!profile)return null;
  if(profile.status!=='active')fail('ROLE_NOT_FOUND');
  if(profile.seatRole!==memberRole)fail('INVALID_ROLE');
  return profile.id;
}
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
      m.id AS membershipId,m.identity_id AS identityId,m.role,m.status AS membershipStatus,m.role_profile_id AS roleProfileId,
      m.assigned_navigation AS assignedNavigation,r.seat_role AS seatRole,r.permissions AS rolePermissions,r.status AS roleStatus,
      i.status AS identityStatus,o.legacy_uid_hash AS uidHash
    FROM (SELECT id,uid,'user' AS sourceTable FROM user UNION ALL SELECT id,uid,'agents' AS sourceTable FROM agents) u JOIN sx_legacy_ownership o ON o.source_table=u.sourceTable AND o.source_id=CAST(u.id AS CHAR)
    JOIN sx_tenants t ON t.id=o.tenant_id JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=t.id
    JOIN sx_identities i ON i.id=m.identity_id LEFT JOIN sx_team_roles r ON r.id=m.role_profile_id AND r.tenant_id=m.tenant_id
    WHERE u.uid=? FOR UPDATE`,[ownerUid]);
  if(!rows.length)fail('VERIFIED_BUSINESS_OWNER_REQUIRED');
  if(rows.length!==1||rows[0].uidHash!==digest(ownerUid))fail('BUSINESS_LINK_INVALID');
  const value=rows[0];
  const category=getCategory(value.categoryKey,Number(value.categoryVersion));
  if(value.membershipStatus!=='active'||value.identityStatus!=='active')fail('PERMISSION_DENIED');
  if(value.tenantStatus!=='active'||!category||!category.seatRoles?.includes(value.role))fail('BUSINESS_INACTIVE');
  const [[tenant]]=await db.query('SELECT id,status,category_key,category_version FROM sx_tenants WHERE id=? FOR UPDATE',[value.tenantId]);
  if(!tenant||tenant.status!=='active')fail('BUSINESS_INACTIVE');
  const entitlement=await plans.loadEntitlements(db,value.tenantId);
  let customPermissions=null;
  if(value.roleProfileId){
    try{customPermissions=typeof value.rolePermissions==='string'?JSON.parse(value.rolePermissions):value.rolePermissions;}catch{fail('TEAM_ROLE_STORAGE_INVALID');}
    if(value.seatRole!==value.role||!Array.isArray(customPermissions)||customPermissions.some(item=>typeof item!=='string')||!['active','archived'].includes(value.roleStatus))fail('TEAM_ROLE_STORAGE_INVALID');
  }
  const authorization=decision({audience:'tenant',identity:{id:value.identityId},tenant:{id:value.tenantId,status:value.tenantStatus,categoryKey:value.categoryKey,categoryVersion:Number(value.categoryVersion)},
    membership:{id:value.membershipId,tenantId:value.tenantId,role:value.role,status:value.membershipStatus,customPermissions,assignedNavigation:parseNavigation(value.assignedNavigation),delegatedPermissions:[]},
    category,subscription:entitlement},{capability:'team.members',permission:'team.invite'});
  if(!authorization.allowed)fail(authorization.code);
  if(requireTeam&&(!entitlement||!['active','trial','grace'].includes(entitlement.status)||!entitlement.capabilities.includes('team.members')))fail('TEAM_FEATURE_UNAVAILABLE');
  return {...value,category,entitlement};
}
async function createRole(pool,ownerUid,input){
  const name=roleName(input?.name),seatRole=role(input?.seatRole),description=roleDescription(input?.description),id=crypto.randomUUID();
  const db=await pool.getConnection();try{return await tx(db,async()=>{await storage(db);const scope=await ownerScope(db,ownerUid);
    if(!scope.category.seatRoles.includes(seatRole))fail('INVALID_ROLE');
    const permissions=rolePermissions(input?.permissions,seatRole,permissionsFor(seatRole,scope.category,scope.entitlement));
    const sidebarNavigation=validateRoleSidebar(input?.sidebarNavigation,permissions,seatRole,scope);
    await db.query('INSERT INTO sx_team_roles(id,tenant_id,name,description,seat_role,permissions,navigation,status,created_by_identity_id) VALUES (?,?,?,?,?,?,? ,\'active\',?)',[id,scope.tenantId,name,description,seatRole,JSON.stringify(permissions),sidebarNavigation===null?null:JSON.stringify(sidebarNavigation),scope.identityId]);
    await audit(db,scope.identityId,scope.tenantId,'team.role-created',id,{name,seatRole,permissions,sidebarNavigation},'team-role');
    return {id,name,description,seatRole,permissions,sidebarNavigation,status:'active'};
  });}catch(error){if(error.code==='ER_DUP_ENTRY')fail('ROLE_NAME_EXISTS');throw error;}finally{db.release();}
}
async function updateRole(pool,ownerUid,id,input){
  invitationId(id);const name=roleName(input?.name),description=roleDescription(input?.description);
  const db=await pool.getConnection();try{return await tx(db,async()=>{await storage(db);const scope=await ownerScope(db,ownerUid);
    const [[current]]=await db.query('SELECT id,name,description,seat_role AS seatRole,permissions,navigation AS sidebarNavigation,status FROM sx_team_roles WHERE tenant_id=? AND id=? FOR UPDATE',[scope.tenantId,id]);
    if(!current)fail('ROLE_NOT_FOUND');if(current.status!=='active')fail('ROLE_ARCHIVED');
    const previous=typeof current.permissions==='string'?JSON.parse(current.permissions):current.permissions;
    const permissions=rolePermissions(input?.permissions,current.seatRole,permissionsFor(current.seatRole,scope.category,scope.entitlement));
    const sidebarNavigation=validateRoleSidebar(input?.sidebarNavigation===undefined?current.sidebarNavigation:input.sidebarNavigation,permissions,current.seatRole,scope);
    await db.query('UPDATE sx_team_roles SET name=?,description=?,permissions=?,navigation=? WHERE tenant_id=? AND id=?',[name,description,JSON.stringify(permissions),sidebarNavigation===null?null:JSON.stringify(sidebarNavigation),scope.tenantId,id]);
    await db.query('UPDATE sx_memberships SET permission_version=permission_version+1 WHERE tenant_id=? AND role_profile_id=? AND status=\'active\'',[scope.tenantId,id]);
    await audit(db,scope.identityId,scope.tenantId,'team.role-updated',id,{oldName:current.name,newName:name,oldPermissions:previous,newPermissions:permissions,oldSidebarNavigation:current.sidebarNavigation,newSidebarNavigation:sidebarNavigation},'team-role');
    return {id,name,description,seatRole:current.seatRole,permissions,sidebarNavigation,status:'active'};
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
  const direct=input?.temporaryPassword!==undefined&&input.temporaryPassword!=='';
  const activation=direct?activationInput({...input,password:input.temporaryPassword}):null;
  if(!profileId)role(input?.role??'agent');
  const token=crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID();
  const db=await pool.getConnection();try{return await tx(db,async()=>{
    await storage(db);
    const scope=await ownerScope(db,ownerUid);
    let profile=null,targetRole;
    if(profileId){const [[row]]=await db.query("SELECT id,name,seat_role AS seatRole,status FROM sx_team_roles WHERE tenant_id=? AND id=? FOR UPDATE",[scope.tenantId,profileId]);if(!row||row.status!=='active')fail('ROLE_NOT_FOUND');profile=row;targetRole=role(row.seatRole);}
    else targetRole=role(input?.role??'agent');
    if(!scope.category.seatRoles.includes(targetRole))fail('INVALID_ROLE');
    if(direct&&targetRole==='agent'&&!activation.mobile)fail('INVALID_MOBILE');
    const [[prior]]=await db.query('SELECT id,email_normalized,role,role_profile_id AS roleProfileId,status,token_hash FROM sx_team_invites WHERE tenant_id=? AND request_key=? FOR UPDATE',[scope.tenantId,requestKey]);
    if(prior){
      if(prior.email_normalized!==targetEmail||prior.role!==targetRole||prior.roleProfileId!==profileId||(direct&&prior.status!=='accepted'))fail('IDEMPOTENCY_CONFLICT');
      if(direct){const [[identity]]=await db.query('SELECT password_hash FROM sx_identities WHERE email_normalized=? FOR UPDATE',[targetEmail]);if(!identity?.password_hash||!await bcrypt.compare(activation.password,identity.password_hash))fail('IDEMPOTENCY_CONFLICT');}
      return {id:prior.id,email:targetEmail,role:prior.role,roleProfileId:prior.roleProfileId,status:prior.status,repeated:true,delivery:direct?'password':'copy-link',loginPath:direct?(targetRole==='agent'?'/agent/login':'/user/login'):undefined};
    }
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
    if(direct){
      const account=await activate(db,{token,...activation},scope.identityId);
      return {id,email:targetEmail,role:targetRole,roleProfileId:profileId,roleName:profile?.name||null,status:account.status,delivery:'password',loginPath:targetRole==='agent'?'/agent/login':'/user/login'};
    }
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
    const availableStaffRoles=scope.category.seatRoles.filter(key=>key!=='owner');
    const seatUsage=Object.fromEntries(availableStaffRoles.map(key=>{const pendingCount=pending[key]||0,limit=scope.entitlement?.roleLimits?.[key]??null,total=Number(used[key]||0);return [key,{active:Math.max(0,total-pendingCount),pending:pendingCount,limit,available:!teamEnabled||limit===null?0:Math.max(0,limit-total)}];}));
    const [roles]=await db.query(`SELECT id,name,description,seat_role AS seatRole,permissions,navigation AS sidebarNavigation,status,created_at AS createdAt,updated_at AS updatedAt
      FROM sx_team_roles WHERE tenant_id=? ORDER BY FIELD(status,'active','archived'),name,id`,[scope.tenantId]);
    const normalizedRoles=roles.map(item=>({...item,sidebarNavigation:navigation.parseSidebar(item.sidebarNavigation),permissions:typeof item.permissions==='string'?JSON.parse(item.permissions):item.permissions}));
    const [rows]=await db.query(`SELECT v.id,v.email_normalized AS email,v.role,v.role_profile_id AS roleProfileId,r.name AS roleName,v.status,DATE_FORMAT(v.expires_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS expiresAt
      FROM sx_team_invites v LEFT JOIN sx_team_roles r ON r.id=v.role_profile_id AND r.tenant_id=v.tenant_id
      WHERE v.tenant_id=? AND v.token_hash IS NOT NULL ORDER BY v.created_at DESC,v.id LIMIT 200`,[scope.tenantId]);
    const [members]=await db.query(`SELECT m.id,m.identity_id AS identityId,m.role,m.role_profile_id AS roleProfileId,r.name AS roleName,r.permissions AS rolePermissions,i.email_normalized AS email,i.display_name AS displayName,COALESCE(a.mobile,u.mobile_with_country_code,'') AS mobile,
        m.assigned_navigation AS assignedNavigation
      FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id LEFT JOIN sx_team_roles r ON r.id=m.role_profile_id AND r.tenant_id=m.tenant_id
      LEFT JOIN sx_legacy_ownership lo ON lo.tenant_id=m.tenant_id AND lo.membership_id=m.id AND lo.source_table IN ('user','agents')
      LEFT JOIN agents a ON lo.source_table='agents' AND CAST(lo.source_id AS UNSIGNED)=a.id AND a.owner_uid=?
      LEFT JOIN user u ON lo.source_table='user' AND CAST(lo.source_id AS UNSIGNED)=u.id
      WHERE m.tenant_id=? AND m.status='active' AND i.status='active' AND m.role IN ('accountant','manager','team_leader','agent')
      ORDER BY i.display_name,i.email_normalized LIMIT 500`,[ownerUid,scope.tenantId]);
    const tenant={id:scope.tenantId,status:scope.tenantStatus,categoryKey:scope.categoryKey,categoryVersion:Number(scope.categoryVersion)};
    const navigationByRole=Object.fromEntries(staffRoles.map(memberRole=>{
      const context={audience:'tenant',tenant,category:scope.category,subscription:scope.entitlement,
        membership:{id:'preview',tenantId:scope.tenantId,role:memberRole,status:'active',delegatedPermissions:[]}};
      return [memberRole,navigation.filterSidebar(navigation.navigationFor(context),null).map(item=>({key:item.key,label:item.label,group:item.group}))];
    }));
    const navigationByRoleProfile=Object.fromEntries(normalizedRoles.map(item=>{
      const context={audience:'tenant',tenant,category:scope.category,subscription:scope.entitlement,
        membership:{id:'preview',tenantId:scope.tenantId,role:item.seatRole,status:'active',delegatedPermissions:[],customPermissions:item.permissions}};
      return [item.id,navigation.filterSidebar(navigation.navigationFor(context),item.sidebarNavigation).map(entry=>({key:entry.key,label:entry.label,group:entry.group}))];
    }));
    return {screenCatalog:navigation.items.filter(item=>item.sidebar!==false).map(item=>({...item,available:!item.ownerOnly&&scope.category.capabilities.includes(item.capability)&&scope.entitlement?.capabilities.includes(item.capability),actions:item.key==='invoices'?Object.entries(policy.capabilities).filter(([key])=>key.startsWith('finance.')).flatMap(([,value])=>value):(policy.capabilities[item.capability]||[]),requiredPermissions:item.key==='finance-reports'?[item.permission,'invoices.read']:[item.permission]})),categoryKey:scope.category.key,categoryVersion:scope.category.version,invitations:rows,members:members.map(member=>({...member,permissions:member.roleProfileId?(typeof member.rolePermissions==='string'?JSON.parse(member.rolePermissions):member.rolePermissions):null,assignedNavigation:parseNavigation(member.assignedNavigation)})),roles:normalizedRoles,permissionCatalog:Object.fromEntries(availableStaffRoles.map(key=>[key,permissionsFor(key,scope.category,scope.entitlement)])),permissionDefaults:Object.fromEntries(availableStaffRoles.map(key=>[key,permissionsFor(key,scope.category,scope.entitlement).filter(permission=>policy.scopeFor({role:key},permission))])),navigationByRole,navigationByRoleProfile,availableRoles:availableStaffRoles.filter(key=>seatUsage[key].available>0),unsupportedRoles:[],seatUsage};
  });}finally{db.release();}
}
async function updateMemberPassword(pool,ownerUid,memberId,input={}){
  if(typeof memberId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(memberId))fail('INVALID_ID');
  if(typeof input.password!=='string'||Array.from(input.password).length<12||Buffer.byteLength(input.password,'utf8')>72)fail('INVALID_PASSWORD');
  const db=await pool.getConnection();
  try{return await tx(db,async()=>{
    await storage(db);const scope=await ownerScope(db,ownerUid);
    const [[member]]=await db.query(`SELECT m.id,m.identity_id AS identityId,m.role,i.status AS identityStatus
      FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id
      WHERE m.tenant_id=? AND m.id=? AND m.status='active' FOR UPDATE`,[scope.tenantId,memberId]);
    if(!member||member.identityStatus!=='active')fail('MEMBER_NOT_FOUND');
    const [links]=await db.query(`SELECT source_table AS sourceTable,source_id AS sourceId,legacy_uid_hash AS legacyUidHash FROM sx_legacy_ownership
      WHERE tenant_id=? AND membership_id=? AND source_table IN ('user','agents') FOR UPDATE`,[scope.tenantId,member.id]);
    if(links.length!==1)fail('BUSINESS_LINK_INVALID');
    const passwordHash=await bcrypt.hash(input.password,12);
    const [identity]=await db.query(`UPDATE sx_identities SET password_hash=?,credential_version=credential_version+1
      WHERE id=? AND status='active'`,[passwordHash,member.identityId]);
    if(identity.affectedRows!==1)fail('MEMBER_NOT_FOUND');
    let legacy;
    if(links[0].sourceTable==='agents'){
      const [[account]]=await db.query('SELECT uid FROM agents WHERE id=? AND owner_uid=? FOR UPDATE',[Number(links[0].sourceId),ownerUid]);
      if(!account||digest(account.uid)!==links[0].legacyUidHash)fail('BUSINESS_LINK_INVALID');
      [legacy]=await db.query('UPDATE agents SET password=? WHERE id=? AND owner_uid=?',[passwordHash,Number(links[0].sourceId),ownerUid]);
    }else{
      const [[account]]=await db.query('SELECT uid FROM user WHERE id=? FOR UPDATE',[Number(links[0].sourceId)]);
      if(!account||digest(account.uid)!==links[0].legacyUidHash)fail('BUSINESS_LINK_INVALID');
      [legacy]=await db.query('UPDATE user SET password=? WHERE id=?',[passwordHash,Number(links[0].sourceId)]);
    }
    if(legacy.affectedRows!==1)fail('BUSINESS_LINK_INVALID');
    await audit(db,scope.identityId,scope.tenantId,'team.password-updated',member.id,{role:member.role,credentialVersionIncremented:true},'team-member');
    return {memberId:String(member.id),updated:true};
  });}finally{db.release();}
}
async function updateMemberRole(pool,actorUid,memberId,input={}){
  invitationId(memberId);
  const requestedProfileId=input.roleProfileId==null||input.roleProfileId===''?null:invitationId(input.roleProfileId);
  const db=await pool.getConnection();
  try{return await tx(db,async()=>{
    await storage(db);const scope=await ownerScope(db,actorUid);
    const [[member]]=await db.query(`SELECT id,role,role_profile_id AS roleProfileId,status FROM sx_memberships
      WHERE tenant_id=? AND id=? AND role IN ('accountant','manager','team_leader','agent') FOR UPDATE`,[scope.tenantId,memberId]);
    if(!member||member.status!=='active')fail('MEMBER_NOT_FOUND');
    let roleProfileId=null;
    if(requestedProfileId){
      const [[profile]]=await db.query('SELECT id,seat_role AS seatRole,status,permissions FROM sx_team_roles WHERE tenant_id=? AND id=? FOR UPDATE',[scope.tenantId,requestedProfileId]);
      if(!profile)fail('ROLE_NOT_FOUND');
      roleProfileId=memberRoleProfileId(member.role,profile);
      const permissions=typeof profile.permissions==='string'?JSON.parse(profile.permissions):profile.permissions;
      rolePermissions(permissions,profile.seatRole,permissionsFor(profile.seatRole,scope.category,scope.entitlement));
    }
    if(member.roleProfileId!==roleProfileId){
      await db.query('UPDATE sx_memberships SET role_profile_id=?,permission_version=permission_version+1 WHERE tenant_id=? AND id=?',[roleProfileId,scope.tenantId,memberId]);
      await audit(db,scope.identityId,scope.tenantId,'team.member-role-updated',memberId,{role:member.role,oldRoleProfileId:member.roleProfileId||null,newRoleProfileId:roleProfileId},'team-member');
    }
    return {membershipId:memberId,roleProfileId};
  });}finally{db.release();}
}
async function salesOrganization(pool,legacyUid){
  if(typeof legacyUid!=='string'||!legacyUid)fail('AUTH_REQUIRED');
  const db=await pool.getConnection();
  try{
    const [rows]=await db.query(`SELECT m.id AS membershipId,m.identity_id AS identityId,m.role,m.status AS membershipStatus,m.role_profile_id AS roleProfileId,
        r.permissions AS rolePermissions,m.assigned_navigation AS assignedNavigation,t.id AS tenantId,t.status AS tenantStatus,
        t.category_key AS categoryKey,t.category_version AS categoryVersion,o.legacy_uid_hash AS uidHash
      FROM (SELECT id,uid,'user' AS sourceTable FROM user UNION ALL SELECT id,uid,'agents' AS sourceTable FROM agents) u JOIN sx_legacy_ownership o ON o.source_table=u.sourceTable AND o.source_id=CAST(u.id AS CHAR)
      JOIN sx_tenants t ON t.id=o.tenant_id JOIN sx_memberships m ON m.tenant_id=t.id AND m.id=o.membership_id
      LEFT JOIN sx_team_roles r ON r.id=m.role_profile_id AND r.tenant_id=m.tenant_id
      JOIN sx_identities i ON i.id=m.identity_id
      WHERE u.uid=? AND i.status='active' LIMIT 2`,[legacyUid]);
    if(rows.length!==1||rows[0].uidHash!==digest(legacyUid)||rows[0].membershipStatus!=='active'||rows[0].tenantStatus!=='active')fail('PERMISSION_DENIED');
    const row=rows[0],category=getCategory(row.categoryKey,Number(row.categoryVersion));
    if(!category)fail('CATEGORY_UNAVAILABLE');
    if(category.key!=='7network_sales')return {categoryKey:category.key,role:row.role,members:[],canReassign:false};
    const subscription=await plans.loadEntitlements(db,row.tenantId);
    const context={audience:'tenant',identity:{id:row.identityId},tenant:{id:row.tenantId,status:row.tenantStatus,categoryKey:row.categoryKey,categoryVersion:Number(row.categoryVersion)},
      category,subscription,membership:{id:row.membershipId,tenantId:row.tenantId,role:row.role,status:row.membershipStatus,
        customPermissions:row.roleProfileId?(typeof row.rolePermissions==='string'?JSON.parse(row.rolePermissions):row.rolePermissions):null,
        assignedNavigation:parseNavigation(row.assignedNavigation),delegatedPermissions:[]}};
    return {...await require('./sales-organization').list(db,context),categoryKey:category.key,role:row.role};
  }finally{db.release();}
}
async function reassignSalesMember(pool,legacyUid,membershipId,input){
  if(typeof legacyUid!=='string'||!legacyUid)fail('AUTH_REQUIRED');
  const db=await pool.getConnection();
  try{
    const [rows]=await db.query(`SELECT m.id AS membershipId,m.identity_id AS identityId,m.role,m.status AS membershipStatus,m.role_profile_id AS roleProfileId,
        r.permissions AS rolePermissions,m.assigned_navigation AS assignedNavigation,t.id AS tenantId,t.status AS tenantStatus,
        t.category_key AS categoryKey,t.category_version AS categoryVersion,o.legacy_uid_hash AS uidHash
      FROM (SELECT id,uid,'user' AS sourceTable FROM user UNION ALL SELECT id,uid,'agents' AS sourceTable FROM agents) u JOIN sx_legacy_ownership o ON o.source_table=u.sourceTable AND o.source_id=CAST(u.id AS CHAR)
      JOIN sx_tenants t ON t.id=o.tenant_id JOIN sx_memberships m ON m.tenant_id=t.id AND m.id=o.membership_id
      LEFT JOIN sx_team_roles r ON r.id=m.role_profile_id AND r.tenant_id=m.tenant_id
      JOIN sx_identities i ON i.id=m.identity_id
      WHERE u.uid=? AND i.status='active' LIMIT 2`,[legacyUid]);
    if(rows.length!==1||rows[0].uidHash!==digest(legacyUid)||rows[0].membershipStatus!=='active'||rows[0].tenantStatus!=='active')fail('PERMISSION_DENIED');
    const row=rows[0],category=getCategory(row.categoryKey,Number(row.categoryVersion));
    if(!category)fail('CATEGORY_UNAVAILABLE');
    const context={audience:'tenant',identity:{id:row.identityId},tenant:{id:row.tenantId,status:row.tenantStatus,categoryKey:row.categoryKey,categoryVersion:Number(row.categoryVersion)},
      category,subscription:await plans.loadEntitlements(db,row.tenantId),membership:{id:row.membershipId,tenantId:row.tenantId,role:row.role,status:row.membershipStatus,
        customPermissions:row.roleProfileId?(typeof row.rolePermissions==='string'?JSON.parse(row.rolePermissions):row.rolePermissions):null,
        assignedNavigation:parseNavigation(row.assignedNavigation),delegatedPermissions:[]}};
    return await require('./sales-organization').reassign(db,context,membershipId,input);
  }finally{db.release();}
}
async function sidebarAccess(pool,legacyUid){
  if(typeof legacyUid!=='string'||!legacyUid)fail('AUTH_REQUIRED');
  const db=await pool.getConnection();
  try{
    const [rows]=await db.query(`SELECT m.id,m.identity_id AS identityId,m.role,m.role_profile_id AS roleProfileId,r.permissions AS rolePermissions,m.status AS membershipStatus,m.assigned_navigation AS assignedNavigation,
        t.id AS tenantId,t.status AS tenantStatus,t.category_key AS categoryKey,t.category_version AS categoryVersion,o.legacy_uid_hash AS uidHash
      FROM (SELECT id,uid,'user' AS sourceTable FROM user UNION ALL SELECT id,uid,'agents' AS sourceTable FROM agents) u JOIN sx_legacy_ownership o ON o.source_table=u.sourceTable AND o.source_id=CAST(u.id AS CHAR)
      JOIN sx_tenants t ON t.id=o.tenant_id JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=t.id
      LEFT JOIN sx_team_roles r ON r.id=m.role_profile_id AND r.tenant_id=m.tenant_id
      JOIN sx_identities i ON i.id=m.identity_id
      WHERE u.uid=? AND i.status='active' LIMIT 2`,[legacyUid]);
    if(rows.length!==1||rows[0].uidHash!==digest(legacyUid)||rows[0].membershipStatus!=='active'||rows[0].tenantStatus!=='active')fail('PERMISSION_DENIED');
    const customPermissions=rows[0].roleProfileId?(typeof rows[0].rolePermissions==='string'?JSON.parse(rows[0].rolePermissions):rows[0].rolePermissions):null;
    if(rows[0].roleProfileId&&!Array.isArray(customPermissions))fail('TEAM_ROLE_STORAGE_INVALID');
    const subscription=await plans.loadEntitlements(db,rows[0].tenantId);
    const tenant={id:rows[0].tenantId,status:rows[0].tenantStatus,categoryKey:rows[0].categoryKey,categoryVersion:Number(rows[0].categoryVersion)};
    const category=getCategory(rows[0].categoryKey,Number(rows[0].categoryVersion));if(!category)fail('CATEGORY_UNAVAILABLE');
    const context={audience:'tenant',identity:{id:rows[0].identityId},tenant,category,subscription,membership:{id:rows[0].id,identityId:rows[0].identityId,roleProfileId:rows[0].roleProfileId,tenantId:rows[0].tenantId,role:rows[0].role,status:'active',delegatedPermissions:[],customPermissions}};
    const customization=await require('./tenant-customization').effective(db,context);
    const roleNavigation=navigation.navigationFor(context).map(item=>item.key);
    const assignedNavigation=parseNavigation(rows[0].assignedNavigation);
    let hasSharedQr=false;
    // A shared QR connection is available to a manager from the existing QR
    // screen. This grants navigation only; QR management APIs still require
    // channels.configure and remain owner/admin capabilities.
    if(rows[0].role==='manager'){
      const [sharedQr]=await db.query(`SELECT 1 FROM sx_qr_channel_shares WHERE tenant_id=? AND membership_id=? LIMIT 1`,[rows[0].tenantId,rows[0].id]);
      hasSharedQr=sharedQr.length>0;
    }
    const effectiveNavigation=effectiveSidebarNavigation({role:rows[0].role,roleNavigation,assignedNavigation,hasSharedQr,document:customization.document});
    const sidebar=await navigation.sidebarForMembership(db,context,navigation.items.filter(item=>effectiveNavigation.roleNavigation.includes(item.key)));
    return {categoryKey:rows[0].categoryKey,role:rows[0].role,roleProfileId:rows[0].roleProfileId||null,customPermissions,roleNavigation:sidebar.map(item=>item.key),assignedNavigation:effectiveNavigation.assignedNavigation};
  }finally{db.release();}
}
function effectiveSidebarNavigation({role,roleNavigation,assignedNavigation,hasSharedQr,document}){
  const roles=[...roleNavigation],assigned=assignedNavigation===null?null:[...assignedNavigation];
  // Shared QR grants navigation only. Tenant-published visibility remains the
  // final presentation restriction, including for legacy saved assignments.
  if(role==='manager'&&hasSharedQr){if(!roles.includes('whatsapp-qr'))roles.push('whatsapp-qr');if(assigned&&!assigned.includes('whatsapp-qr'))assigned.push('whatsapp-qr');}
  const visibleKeys=require('./tenant-customization').visibleNavigationKeys;
  return {roleNavigation:visibleKeys(roles,document),assignedNavigation:assigned===null?null:visibleKeys(assigned,document)};
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
      WHERE m.tenant_id=? AND m.id=? AND m.status='active' AND i.status='active' AND m.role IN ('accountant','manager','team_leader','agent') FOR UPDATE`,[scope.tenantId,membershipId]);
    if(!member)fail('MEMBER_NOT_FOUND');
    const customPermissions=member.roleProfileId?(typeof member.rolePermissions==='string'?JSON.parse(member.rolePermissions):member.rolePermissions):null;
    if(member.roleProfileId&&!Array.isArray(customPermissions))fail('TEAM_ROLE_STORAGE_INVALID');
    const context={audience:'tenant',tenant:{id:scope.tenantId,status:scope.tenantStatus,categoryKey:scope.categoryKey,categoryVersion:Number(scope.categoryVersion)},category:scope.category,subscription:scope.entitlement,
      membership:{id:member.id,roleProfileId:member.roleProfileId,tenantId:scope.tenantId,role:member.role,status:'active',delegatedPermissions:[],customPermissions}};
    const customization=await require('./tenant-customization').effective(db,context);
    const allowed=new Set((await navigation.sidebarForMembership(db,context,require('./tenant-customization').visibleNavigation(navigation.navigationFor(context),customization.document))).map(item=>item.key));
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
    const category=getCategory(invite?.categoryKey,Number(invite?.categoryVersion));
    if(!invite||!invite.validNow||invite.tenantStatus!=='active'||!category?.seatRoles?.includes(invite.role))fail('INVITE_INVALID');
    return {email:invite.email,role:invite.role,roleName:invite.roleName||null,businessName:invite.businessName,tenantSlug:invite.tenantSlug};
  }finally{db.release();}
}
async function accept(pool,input){
  if(typeof input?.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.token))fail('INVITE_INVALID');
  const activation=activationInput(input),db=await pool.getConnection();
  try{return await tx(db,()=>activate(db,{token:input.token,...activation}));}finally{db.release();}
}
function activationInput(input){
  const name=typeof input.displayName==='string'?input.displayName.trim():'';
  if(!name||name.length>200)fail('INVALID_DISPLAY_NAME');
  const mobile=typeof input.mobile==='string'?input.mobile.trim().replace(/[\s().-]/g,''):'';
  if(mobile&&!/^\+[1-9][0-9]{7,14}$/.test(mobile))fail('INVALID_MOBILE');
  if(typeof input.password!=='string'||Array.from(input.password).length<12||Buffer.byteLength(input.password,'utf8')>72)fail('INVALID_PASSWORD');
  return {displayName:name,mobile,password:input.password};
}
async function activate(db,input,creatorIdentityId=null){
    const name=input.displayName,mobile=input.mobile;
    await storage(db);
    const [[invite]]=await db.query(`SELECT v.id,v.tenant_id AS tenantId,v.email_normalized AS email,v.role,v.role_profile_id AS roleProfileId,r.status AS roleStatus,v.status,v.expires_at>UTC_TIMESTAMP(3) AS valid_now,t.slug AS tenantSlug
      FROM sx_team_invites v JOIN sx_tenants t ON t.id=v.tenant_id LEFT JOIN sx_team_roles r ON r.id=v.role_profile_id AND r.tenant_id=v.tenant_id WHERE v.token_hash=? FOR UPDATE`,[digest(input.token)]);
    if(!invite||invite.status!=='pending'||!invite.valid_now||!staffRoles.includes(invite.role))fail('INVITE_INVALID');
    if(invite.roleProfileId&&invite.roleStatus!=='active')fail('INVITE_INVALID');
    if(invite.role==='agent'&&!mobile)fail('INVALID_MOBILE');
    const [[tenant]]=await db.query('SELECT id,status,category_key,category_version FROM sx_tenants WHERE id=? FOR UPDATE',[invite.tenantId]);
    const category=getCategory(tenant?.category_key,Number(tenant?.category_version));
    if(!tenant||tenant.status!=='active'||!category?.seatRoles?.includes(invite.role))fail('INVITE_INVALID');
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
    await audit(db,creatorIdentityId||identityId,tenant.id,creatorIdentityId?'team.account-created':'team.invitation-accepted',invite.id,{role:invite.role,roleProfileId:invite.roleProfileId||null});
    return {status:'accepted',email:invite.email,role:invite.role,roleProfileId:invite.roleProfileId||null,agentUid,tenantSlug:invite.tenantSlug};
}
async function accountSession(pool,ownerUid,membershipId,{jwtKey,returning=false,sessionId=null}={}){
  if(!jwtKey)fail('AUTH_UNAVAILABLE');
  if(!returning)invitationId(membershipId);
  const db=await pool.getConnection();
  try{return await tx(db,async()=>{
    const scope=await ownerScope(db,ownerUid,{requireTeam:!returning});
    if(['agent','team_leader'].includes(scope.role))fail('PERMISSION_DENIED');
    const targetId=returning?scope.membershipId:membershipId;
    const [rows]=await db.query(`SELECT m.id,m.identity_id AS identityId,m.role,i.credential_version AS credentialVersion,
        u.uid,u.email,u.password,o.legacy_uid_hash AS uidHash
      FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
      JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='user'
      JOIN user u ON CAST(u.id AS CHAR)=o.source_id
      WHERE m.tenant_id=? AND m.id=? AND m.status='active' FOR UPDATE`,[scope.tenantId,targetId]);
    if(rows.length!==1)fail('MEMBER_NOT_FOUND');
    const member=rows[0];
    if(member.uidHash!==digest(member.uid)||(!returning&&!['manager','accountant'].includes(member.role)))fail('PERMISSION_DENIED');
    if(returning&&sessionId){
      invitationId(sessionId);
      await db.query(`UPDATE sx_sessions s JOIN sx_audit_events a ON a.resource_id=s.id AND a.resource_type='session'
        SET s.revoked_at=UTC_TIMESTAMP(3) WHERE s.id=? AND s.tenant_id=? AND a.actor_identity_id=?
        AND a.action='team.account-login'`,[sessionId,scope.tenantId,scope.identityId]);
    }
    const raw=crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID(),seconds=returning?28800:1800;
    await db.query(`INSERT INTO sx_sessions(id,token_hash,identity_id,audience,tenant_id,membership_id,credential_version,authenticated_at,expires_at)
      VALUES (?,?,?,'tenant',?,?,?,UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND))`,
      [id,digest(raw),member.identityId,scope.tenantId,member.id,member.credentialVersion,seconds]);
    await audit(db,scope.identityId,scope.tenantId,returning?'team.account-returned':'team.account-login',id,
      {membershipId:member.id,identityId:member.identityId,role:member.role,expiresInSeconds:seconds},'session');
    const legacyToken=returning?null:require('jsonwebtoken').sign({uid:member.uid,email:member.email,password:member.password,role:'user',delegatedSessionId:id},jwtKey,{expiresIn:seconds});
    return {token:legacyToken,cookieToken:raw,sessionId:id,expiresInSeconds:seconds};
  });}finally{db.release();}
}
module.exports={accountSession,create,list,updateMemberPassword,updateMemberRole,memberRoleProfileId,salesOrganization,reassignSalesMember,createRole,updateRole,archiveRole,sidebarAccess,effectiveSidebarNavigation,updateMemberNavigation,rotate,cancel,preview,accept,email,role,permissionsFor,rolePermissions,parseNavigation};
