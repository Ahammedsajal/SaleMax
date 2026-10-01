'use strict';
const crypto=require('node:crypto');
const bcrypt=require('bcrypt');
const plans=require('./plans');
const seats=require('./legacy-agent-seats');
const {trainingCenter}=require('./categories');

const fail=code=>{throw Object.assign(new Error(code),{code});};
const digest=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
const uid=()=>crypto.randomBytes(24).toString('base64url');
function email(value){const result=typeof value==='string'?value.trim().toLowerCase():'';if(!result||result.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))fail('INVALID_EMAIL');return result;}
function role(value){if(value!=='agent')fail('ROLE_ONBOARDING_UNAVAILABLE');return value;}
function invitationId(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))fail('INVALID_ID');return value;}
async function tx(db,fn){await db.beginTransaction();try{const out=await fn();await db.commit();return out;}catch(error){await db.rollback();throw error;}}
async function audit(db,identityId,tenantId,action,id,changes){await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
  VALUES (?,?,?,'identity',?,'team-invitation',?,?,?)`,[crypto.randomUUID(),tenantId,identityId,action,id,JSON.stringify(changes),crypto.randomUUID()]);}
async function storage(db){
  const [[table]]=await db.query("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sx_team_invites'");
  const [columns]=await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sx_team_invites' AND COLUMN_NAME IN ('token_hash','invited_by_identity_id','accepted_at')");
  if(table?.ENGINE!=='InnoDB'||columns.length!==3)fail('TEAM_INVITATION_STORAGE_NOT_READY');
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
function publicInvitation(invite,token){return {id:invite.id,email:invite.email,role:'agent',token,expiresInDays:7,status:'pending',delivery:'copy-link'};}
async function create(pool,ownerUid,input){
  const targetEmail=email(input?.email),targetRole=role(input?.role??'agent'),requestKey=invitationId(input?.requestKey);
  const token=crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID();
  const db=await pool.getConnection();try{return await tx(db,async()=>{
    await storage(db);
    const scope=await ownerScope(db,ownerUid);
    const [[prior]]=await db.query('SELECT id,email_normalized,role,status,token_hash FROM sx_team_invites WHERE tenant_id=? AND request_key=? FOR UPDATE',[scope.tenantId,requestKey]);
    if(prior){if(prior.email_normalized!==targetEmail||prior.role!==targetRole)fail('IDEMPOTENCY_CONFLICT');return {id:prior.id,email:targetEmail,role:targetRole,status:prior.status,repeated:true,delivery:'copy-link'};}
    const [[existingAgent]]=await db.query('SELECT id FROM agents WHERE LOWER(email)=? LIMIT 1 FOR UPDATE',[targetEmail]);
    const [[existingUser]]=await db.query('SELECT id FROM user WHERE LOWER(email)=? LIMIT 1 FOR UPDATE',[targetEmail]);
    const [[existingIdentity]]=await db.query('SELECT id FROM sx_identities WHERE email_normalized=? FOR UPDATE',[targetEmail]);
    if(existingAgent||existingUser||existingIdentity)fail('MEMBERSHIP_EXISTS');
    const used=await seats.activeAgentCounts(db,ownerUid,scope.tenantId);
    if(used.agent>=scope.entitlement.roleLimits.agent)fail('SEAT_LIMIT_EXCEEDED');
    const [[pending]]=await db.query("SELECT id FROM sx_team_invites WHERE tenant_id=? AND email_normalized=? AND status='pending' FOR UPDATE",[scope.tenantId,targetEmail]);
    if(pending)fail('INVITE_ALREADY_PENDING');
    const [inserted]=await db.query(`INSERT INTO sx_team_invites(id,tenant_id,request_key,email_normalized,role,token_hash,invited_by_identity_id,expires_at)
      VALUES (?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 7 DAY))`,[id,scope.tenantId,requestKey,targetEmail,targetRole,digest(token),scope.identityId]);
    await audit(db,scope.identityId,scope.tenantId,'team.invitation-created',inserted.insertId||id,{email:targetEmail,role:targetRole});
    return publicInvitation({id,email:targetEmail},token);
  });}finally{db.release();}
}
async function list(pool,ownerUid){
  const db=await pool.getConnection();try{return await tx(db,async()=>{await storage(db);const scope=await ownerScope(db,ownerUid,{requireTeam:false});
    await db.query("UPDATE sx_team_invites SET status='expired' WHERE tenant_id=? AND status='pending' AND expires_at<=UTC_TIMESTAMP(3)",[scope.tenantId]);
    const [rows]=await db.query(`SELECT id,email_normalized AS email,role,status,DATE_FORMAT(expires_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS expiresAt
      FROM sx_team_invites WHERE tenant_id=? AND token_hash IS NOT NULL ORDER BY created_at DESC,id LIMIT 200`,[scope.tenantId]);
    return {invitations:rows,availableRoles:['agent'],unsupportedRoles:['accountant','manager']};
  });}finally{db.release();}
}
async function rotate(pool,ownerUid,id){
  invitationId(id);const token=crypto.randomBytes(32).toString('base64url'),db=await pool.getConnection();
  try{return await tx(db,async()=>{await storage(db);const scope=await ownerScope(db,ownerUid);const [[invite]]=await db.query('SELECT id,email_normalized AS email,role,status,expires_at<=UTC_TIMESTAMP(3) AS expired_now FROM sx_team_invites WHERE tenant_id=? AND id=? FOR UPDATE',[scope.tenantId,id]);
    if(!invite)fail('INVITE_NOT_FOUND');if(!['pending','expired'].includes(invite.status))fail('INVITE_NOT_PENDING');
    const expired=invite.status==='expired'||Boolean(invite.expired_now);
    if(expired){const [[agent]]=await db.query('SELECT id FROM agents WHERE LOWER(email)=? LIMIT 1 FOR UPDATE',[invite.email]);const [[user]]=await db.query('SELECT id FROM user WHERE LOWER(email)=? LIMIT 1 FOR UPDATE',[invite.email]);const [[identity]]=await db.query('SELECT id FROM sx_identities WHERE email_normalized=? FOR UPDATE',[invite.email]);if(agent||user||identity)fail('MEMBERSHIP_EXISTS');const used=await seats.activeAgentCounts(db,ownerUid,scope.tenantId);if(used.agent>=scope.entitlement.roleLimits.agent)fail('SEAT_LIMIT_EXCEEDED');}
    await db.query("UPDATE sx_team_invites SET token_hash=?,status='pending',expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 7 DAY) WHERE id=?",[digest(token),id]);
    await audit(db,scope.identityId,scope.tenantId,'team.invitation-rotated',id,{role:invite.role});return publicInvitation(invite,token);
  });}finally{db.release();}
}
async function cancel(pool,ownerUid,id){
  invitationId(id);const db=await pool.getConnection();try{return await tx(db,async()=>{await storage(db);const scope=await ownerScope(db,ownerUid,{requireTeam:false});const [[invite]]=await db.query('SELECT status FROM sx_team_invites WHERE tenant_id=? AND id=? FOR UPDATE',[scope.tenantId,id]);
    if(!invite)fail('INVITE_NOT_FOUND');if(invite.status!=='pending')fail('INVITE_NOT_PENDING');
    await db.query("UPDATE sx_team_invites SET status='cancelled' WHERE id=?",[id]);await audit(db,scope.identityId,scope.tenantId,'team.invitation-cancelled',id,{});return {id,status:'cancelled'};
  });}finally{db.release();}
}
async function accept(pool,input){
  if(typeof input?.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.token))fail('INVITE_INVALID');
  const name=typeof input.displayName==='string'?input.displayName.trim():'';
  if(!name||name.length>200)fail('INVALID_DISPLAY_NAME');
  const mobile=typeof input.mobile==='string'?input.mobile.trim():'';
  if(!/^\+[1-9][0-9]{7,14}$/.test(mobile))fail('INVALID_MOBILE');
  if(typeof input.password!=='string'||Array.from(input.password).length<12||Buffer.byteLength(input.password,'utf8')>72)fail('INVALID_PASSWORD');
  const db=await pool.getConnection();
  try{return await tx(db,async()=>{
    await storage(db);
    const [[invite]]=await db.query(`SELECT v.id,v.tenant_id AS tenantId,v.email_normalized AS email,v.role,v.status,v.expires_at>UTC_TIMESTAMP(3) AS valid_now
      FROM sx_team_invites v WHERE v.token_hash=? FOR UPDATE`,[digest(input.token)]);
    if(!invite||invite.status!=='pending'||!invite.valid_now||invite.role!=='agent')fail('INVITE_INVALID');
    const [[tenant]]=await db.query('SELECT id,status,category_key,category_version FROM sx_tenants WHERE id=? FOR UPDATE',[invite.tenantId]);
    if(!tenant||tenant.status!=='active'||tenant.category_key!==trainingCenter.key||Number(tenant.category_version)!==trainingCenter.version)fail('INVITE_INVALID');
    const [[owner]]=await db.query(`SELECT u.id,u.uid FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
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
    await db.query("UPDATE sx_team_invites SET status='accepted',accepted_at=UTC_TIMESTAMP(3) WHERE id=?",[invite.id]);
    const used=await seats.activeAgentCounts(db,owner.uid,tenant.id);
    if(used.agent>=entitlement.roleLimits.agent)fail('SEAT_LIMIT_EXCEEDED');
    const passwordHash=await bcrypt.hash(input.password,12),agentUid=uid();
    const identityId=crypto.randomUUID(),membershipId=crypto.randomUUID();
    await db.query("INSERT INTO sx_identities(id,email_normalized,display_name,password_hash,status) VALUES (?,?,?,?, 'active')",[identityId,invite.email,name,passwordHash]);
    await db.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES (?,?,?,'agent','active')",[membershipId,tenant.id,identityId]);
    const [agent]=await db.query(`INSERT INTO agents(owner_uid,uid,email,password,name,mobile,comments,role,is_active)
      VALUES (?,?,?,?,?,?,?,'agent',1)`,[owner.uid,agentUid,invite.email,passwordHash,name,mobile,'']);
    await db.query(`INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash,verified_at)
      VALUES ('agents',?,?,?,?,UTC_TIMESTAMP(3))`,[String(agent.insertId),tenant.id,membershipId,digest(agentUid)]);
    await audit(db,identityId,tenant.id,'team.invitation-accepted',invite.id,{role:'agent'});
    return {status:'accepted',email:invite.email,role:'agent',agentUid};
  });}finally{db.release();}
}
module.exports={create,list,rotate,cancel,accept,email,role};
