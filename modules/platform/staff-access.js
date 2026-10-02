'use strict';
const crypto=require('node:crypto');
const bcrypt=require('bcrypt');
const {platformDecision,platformStaffAllowlist}=require('./policy');
const allowed=new Set(platformStaffAllowlist);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const uuid=value=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))fail('INVALID_ID');return value;};
const parse=value=>typeof value==='string'?JSON.parse(value):value;
function permissions(value){if(!Array.isArray(value)||value.some(item=>typeof item!=='string'||!allowed.has(item))||new Set(value).size!==value.length)fail('INVALID_STAFF_PERMISSIONS');return [...value].sort();}
function email(value){const normalized=typeof value==='string'?value.trim().toLowerCase():'';if(normalized.length>254||!normalized||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))fail('INVALID_EMAIL');return normalized;}
function authorize(context){if(!platformDecision(context,'staff.manage'))fail('PERMISSION_DENIED');}
const digest=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
async function transaction(db,fn){await db.beginTransaction();try{const result=await fn();await db.commit();return result;}catch(error){await db.rollback();throw error;}}
async function audit(db,context,action,id,changes){await db.query(`INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
  VALUES (?,?,'identity',?,'platform-staff',?,?,?)`,[crypto.randomUUID(),context.identity.id,action,id,JSON.stringify(changes),crypto.randomUUID()]);}
async function assertStorage(db){
  const names=['admin','sx_identities','sx_platform_memberships','sx_legacy_admin_identities','sx_platform_staff_invites','sx_audit_events'];
  const [rows]=await db.query(`SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names.map(()=>'?').join(',')})`,names);
  if(rows.length!==names.length||rows.some(row=>row.ENGINE!=='InnoDB'))fail('STAFF_STORAGE_NOT_READY');
}
async function list(db,context){
  authorize(context);
  const [staff]=await db.query(`SELECT i.id,i.email_normalized AS email,i.display_name AS displayName,i.status AS identityStatus,
    p.role AS platformRole,p.reports_to_identity_id AS reportsToIdentityId,manager.email_normalized AS reportsToEmail,
    p.status AS accessStatus,p.delegated_permissions AS permissions,p.permission_version AS permissionVersion
    FROM sx_platform_memberships p JOIN sx_identities i ON i.id=p.identity_id
    LEFT JOIN sx_identities manager ON manager.id=p.reports_to_identity_id
    WHERE p.role IN ('platform_admin','staff') ORDER BY p.role,i.email_normalized,i.id LIMIT 201`);
  const [invites]=await db.query(`SELECT v.id,i.email_normalized AS email,v.platform_role AS platformRole,
    v.reports_to_identity_id AS reportsToIdentityId,manager.email_normalized AS reportsToEmail,
    v.delegated_permissions AS permissions,v.status,
    DATE_FORMAT(v.expires_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS expiresAt,v.invited_by AS invitedBy
    FROM sx_platform_staff_invites v JOIN sx_identities i ON i.id=v.identity_id
    LEFT JOIN sx_identities manager ON manager.id=v.reports_to_identity_id
    WHERE v.status IN ('pending','expired') ORDER BY v.created_at DESC,v.id LIMIT 201`);
  if(staff.length>200||invites.length>200)fail('STAFF_RESULT_LIMIT');
  return {staff:staff.map(row=>({...row,permissions:parse(row.permissions)})),invitations:invites.map(row=>({...row,permissions:parse(row.permissions)})),admins:staff.filter(row=>row.platformRole==='platform_admin').map(row=>({id:row.id,email:row.email,displayName:row.displayName,status:row.accessStatus})),availablePermissions:platformStaffAllowlist};
}
async function createInvite(db,context,input){
  authorize(context);await assertStorage(db);
  if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_INVITATION');
  const targetEmail=email(input.email),platformRole=input.platformRole===undefined?'staff':input.platformRole;
  if(!['platform_admin','staff'].includes(platformRole))fail('INVALID_PLATFORM_ROLE');
  const reportsToIdentityId=platformRole==='staff'?(input.reportsToIdentityId||null):null;
  const grants=platformRole==='staff'?permissions(input.permissions||[]):[];
  const actorId=uuid(context.identity.id);
  if(reportsToIdentityId){uuid(reportsToIdentityId);const [[manager]]=await db.query(`SELECT p.role,p.status,i.status AS identity_status FROM sx_platform_memberships p JOIN sx_identities i ON i.id=p.identity_id WHERE p.identity_id=?`,[reportsToIdentityId]);if(!manager||manager.role!=='platform_admin'||manager.status!=='active'||manager.identity_status!=='active')fail('ADMIN_MANAGER_NOT_FOUND');}
  const inviteId=crypto.randomUUID(),identityId=crypto.randomUUID(),token=crypto.randomBytes(32).toString('base64url'),uid=crypto.randomBytes(32).toString('hex');
  const unknownPasswordHash=await bcrypt.hash(crypto.randomBytes(32).toString('base64url'),12);
  return transaction(db,async()=>{
    const [[identity]]=await db.query(`SELECT i.id,i.status,p.role,p.status AS membership_status,v.id AS invite_id,v.status AS invite_status
      FROM sx_identities i LEFT JOIN sx_platform_memberships p ON p.identity_id=i.id
      LEFT JOIN sx_platform_staff_invites v ON v.identity_id=i.id
      WHERE i.email_normalized=? ORDER BY v.created_at DESC LIMIT 1 FOR UPDATE`,[targetEmail]);
    if(identity){
      if(identity.status!=='disabled'||!['platform_admin','staff'].includes(identity.role)||identity.membership_status!=='inactive'||identity.invite_status!=='cancelled')fail('IDENTITY_EXISTS');
      const [[legacy]]=await db.query('SELECT id,uid FROM admin WHERE email=? LIMIT 1 FOR UPDATE',[targetEmail]);
      if(!legacy||!legacy.uid)fail('LEGACY_ADMIN_EXISTS');
      const recycledId=identity.invite_id;
      if(!recycledId)fail('IDENTITY_EXISTS');
      await db.query('UPDATE admin SET password=? WHERE id=?',[unknownPasswordHash,legacy.id]);
      await db.query("UPDATE sx_identities SET status='pending',display_name=email_normalized,password_hash=NULL,credential_version=credential_version+1 WHERE id=?",[identity.id]);
      await db.query('UPDATE sx_platform_memberships SET role=?,reports_to_identity_id=?,delegated_permissions=?,permission_version=permission_version+1 WHERE identity_id=?',[platformRole,reportsToIdentityId,JSON.stringify(grants),identity.id]);
      await db.query(`UPDATE sx_platform_staff_invites SET platform_role=?,reports_to_identity_id=?,invited_by=?,token_hash=?,delegated_permissions=?,status='pending',expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 72 HOUR),accepted_at=NULL WHERE id=?`,[platformRole,reportsToIdentityId,actorId,digest(token),JSON.stringify(grants),recycledId]);
      await audit(db,context,platformRole==='platform_admin'?'platform.admin-invited':'platform.staff-invited',recycledId,{email:targetEmail,platformRole,reportsToIdentityId,permissions:grants,expiresInHours:72,reissued:true});
      return {id:recycledId,email:targetEmail,token,platformRole,reportsToIdentityId,expiresInHours:72,status:'pending',delivery:'copy-link'};
    }
    const [[legacy]]=await db.query('SELECT id FROM admin WHERE LOWER(email)=? LIMIT 1 FOR UPDATE',[targetEmail]);
    if(legacy)fail('LEGACY_ADMIN_EXISTS');
    const [inserted]=await db.query("INSERT INTO admin(email,password,uid,role) VALUES (?,?,?,'admin')",[targetEmail,unknownPasswordHash,uid]);
    await db.query("INSERT INTO sx_identities(id,email_normalized,display_name,password_hash,status) VALUES (?,?,?,NULL,'pending')",[identityId,targetEmail,targetEmail]);
    await db.query('INSERT INTO sx_platform_memberships(identity_id,role,reports_to_identity_id,status,delegated_permissions) VALUES (?,?,?,\'inactive\',?)',[identityId,platformRole,reportsToIdentityId,JSON.stringify(grants)]);
    await db.query(`INSERT INTO sx_platform_staff_invites(id,identity_id,platform_role,reports_to_identity_id,legacy_admin_id,invited_by,token_hash,delegated_permissions,expires_at)
      VALUES (?,?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 72 HOUR))`,[inviteId,identityId,platformRole,reportsToIdentityId,inserted.insertId,actorId,digest(token),JSON.stringify(grants)]);
    await audit(db,context,platformRole==='platform_admin'?'platform.admin-invited':'platform.staff-invited',inviteId,{email:targetEmail,platformRole,reportsToIdentityId,permissions:grants,expiresInHours:72});
    return {id:inviteId,email:targetEmail,token,platformRole,reportsToIdentityId,expiresInHours:72,status:'pending',delivery:'copy-link'};
  });
}
async function rotateInvite(db,context,id){
  authorize(context);await assertStorage(db);uuid(id);
  return transaction(db,async()=>{
    const [[invite]]=await db.query("SELECT status FROM sx_platform_staff_invites WHERE id=? FOR UPDATE",[id]);
    if(!invite)fail('INVITE_NOT_FOUND');if(invite.status!=='pending')fail('INVITE_NOT_PENDING');
    const token=crypto.randomBytes(32).toString('base64url');
    await db.query('UPDATE sx_platform_staff_invites SET token_hash=?,expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 72 HOUR) WHERE id=?',[digest(token),id]);
    await audit(db,context,'platform.staff-invite-rotated',id,{expiresInHours:72});
    return {id,token,expiresInHours:72,status:'pending',delivery:'copy-link'};
  });
}
async function cancelInvite(db,context,id){
  authorize(context);await assertStorage(db);uuid(id);
  return transaction(db,async()=>{
    const [[invite]]=await db.query("SELECT identity_id,status FROM sx_platform_staff_invites WHERE id=? FOR UPDATE",[id]);
    if(!invite)fail('INVITE_NOT_FOUND');if(invite.status!=='pending')fail('INVITE_NOT_PENDING');
    await db.query("UPDATE sx_platform_staff_invites SET status='cancelled' WHERE id=?",[id]);
    await db.query("UPDATE sx_identities SET status='disabled',credential_version=credential_version+1 WHERE id=? AND status='pending'",[invite.identity_id]);
    await db.query("UPDATE sx_platform_memberships SET status='inactive',permission_version=permission_version+1 WHERE identity_id=? AND role IN ('staff','platform_admin')",[invite.identity_id]);
    await audit(db,context,'platform.access-invite-cancelled',id,{});return {id,status:'cancelled'};
  });
}
async function updateStaff(db,context,id,input){
  authorize(context);await assertStorage(db);uuid(id);
  if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.active!=='boolean')fail('INVALID_STAFF_UPDATE');
  const rawGrants=input.permissions===undefined?[]:input.permissions;
  const grants=permissions(rawGrants);
  return transaction(db,async()=>{
    const [[current]]=await db.query(`SELECT p.status,p.role,p.delegated_permissions,i.status AS identity_status FROM sx_platform_memberships p
      JOIN sx_identities i ON i.id=p.identity_id WHERE p.identity_id=? FOR UPDATE`,[id]);
    if(!current||!['staff','platform_admin'].includes(current.role))fail('STAFF_NOT_FOUND');if(current.identity_status!=='active')fail('STAFF_IDENTITY_INACTIVE');
    if(current.role==='platform_admin'&&grants.length)fail('INVALID_STAFF_PERMISSIONS');
    const status=input.active?'active':'inactive',oldPermissions=parse(current.delegated_permissions);
    await db.query('UPDATE sx_platform_memberships SET status=?,delegated_permissions=?,permission_version=permission_version+1 WHERE identity_id=?',[status,JSON.stringify(grants),id]);
    await db.query('UPDATE sx_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE identity_id=? AND audience=\'platform\' AND revoked_at IS NULL',[id]);
    await audit(db,context,current.role==='platform_admin'?'platform.admin-updated':'platform.staff-updated',id,{status,oldPermissions,permissions:grants});return {identityId:id,status,permissions:grants,platformRole:current.role};
  });
}
async function acceptInvite(db,{token,displayName,password}){
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))fail('INVITE_INVALID');
  const name=typeof displayName==='string'?displayName.trim():'';
  if(!name||name.length>200)fail('INVALID_DISPLAY_NAME');
  if(typeof password!=='string'||Array.from(password).length<12||Buffer.byteLength(password,'utf8')>72)fail('INVALID_PASSWORD');
  const passwordHash=await bcrypt.hash(password,12);
  return transaction(db,async()=>{
    const [[invite]]=await db.query(`SELECT v.id,v.identity_id,v.platform_role,v.reports_to_identity_id,v.legacy_admin_id,v.invited_by,v.status,v.expires_at>UTC_TIMESTAMP(3) AS valid_now,
      i.email_normalized FROM sx_platform_staff_invites v JOIN sx_identities i ON i.id=v.identity_id
      WHERE v.token_hash=? FOR UPDATE`,[digest(token)]);
    if(!invite||invite.status!=='pending'||!invite.valid_now)fail('INVITE_INVALID');
    if(invite.reports_to_identity_id){const [[manager]]=await db.query(`SELECT p.role,p.status,i.status AS identity_status FROM sx_platform_memberships p JOIN sx_identities i ON i.id=p.identity_id WHERE p.identity_id=? FOR UPDATE`,[invite.reports_to_identity_id]);if(!manager||manager.role!=='platform_admin'||manager.status!=='active'||manager.identity_status!=='active')fail('INVITE_INVALID');}
    const [[admin]]=await db.query('SELECT id,uid FROM admin WHERE id=? FOR UPDATE',[invite.legacy_admin_id]);
    if(!admin||!admin.uid)fail('INVITE_INVALID');
    const [[membership]]=await db.query("SELECT role,status FROM sx_platform_memberships WHERE identity_id=? FOR UPDATE",[invite.identity_id]);
    if(!membership||membership.role!==invite.platform_role||!['platform_admin','staff'].includes(membership.role)||membership.status!=='inactive')fail('INVITE_INVALID');
    await db.query("UPDATE sx_identities SET display_name=?,password_hash=?,status='active',credential_version=credential_version+1 WHERE id=? AND status='pending'",[name,passwordHash,invite.identity_id]);
    await db.query("UPDATE admin SET password=? WHERE id=? AND uid=?",[passwordHash,admin.id,admin.uid]);
    await db.query("UPDATE sx_platform_memberships SET status='active',reports_to_identity_id=?,permission_version=permission_version+1 WHERE identity_id=? AND role IN ('platform_admin','staff')",[invite.reports_to_identity_id,invite.identity_id]);
    await db.query("UPDATE sx_platform_staff_invites SET status='accepted',accepted_at=UTC_TIMESTAMP(3) WHERE id=? AND status='pending'",[invite.id]);
    await db.query(`INSERT INTO sx_legacy_admin_identities(legacy_admin_id,legacy_uid,legacy_uid_hash,identity_id,verified_by,verified_at)
      VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))`,[admin.id,admin.uid,digest(admin.uid),invite.identity_id,invite.invited_by]);
    await db.query(`INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,'identity',?,'platform-invite',?,?,?)`,[crypto.randomUUID(),invite.identity_id,invite.platform_role==='platform_admin'?'platform.admin-invite-accepted':'platform.staff-invite-accepted',invite.id,JSON.stringify({email:invite.email_normalized,platformRole:invite.platform_role,reportsToIdentityId:invite.reports_to_identity_id}),crypto.randomUUID()]);
    return {status:'accepted',email:invite.email_normalized};
  });
}
module.exports={platformStaffAllowlist,permissions,email,list,createInvite,rotateInvite,cancelInvite,updateStaff,acceptInvite};
