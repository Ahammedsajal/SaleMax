'use strict';

const crypto=require('node:crypto');
const bcrypt=require('bcrypt');
const {platformDecision}=require('./policy');

const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
const digest=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const email=value=>{const normalized=typeof value==='string'?value.trim().toLowerCase():'';if(!normalized||normalized.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))fail('INVALID_EMAIL',400);return normalized;};
const password=value=>{if(typeof value!=='string'||value.length<12||Buffer.byteLength(value,'utf8')>72)fail('INVALID_PASSWORD',400);return value;};
const tables=['sx_tenants','sx_identities','sx_memberships','sx_legacy_ownership','sx_sessions','sx_audit_events','sx_tenant_owner_transfers','user','agents'];

function authorize(context){
  if(!platformDecision(context,'tenants.owner-transfer')||context.membership?.role!=='super_admin')fail('PERMISSION_DENIED',403);
  if(context.mfaVerified!==true||context.recentlyAuthenticated!==true)fail('RECENT_MFA_REQUIRED',403);
}
function transferInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['email','reason'].includes(key)))fail('INVALID_OWNER_TRANSFER',400);
  const recipientEmail=email(input.email),reason=typeof input.reason==='string'?input.reason.trim():'';
  if(reason.length<10||reason.length>1000)fail('INVALID_REASON',400);
  return {recipientEmail,reason};
}
async function storage(db){
  const [rows]=await db.query(`SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tables.map(()=>'?').join(',')})`,tables);
  if(rows.length!==tables.length||rows.some(row=>row.ENGINE!=='InnoDB'))fail('OWNER_TRANSFER_STORAGE_NOT_READY',503);
}
async function audit(db,{tenantId,actorId,action,transferId,changes,reason}){
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,reason,changes,correlation_id)
    VALUES (?, ?, ?, 'identity', ?, 'tenant-owner-transfer', ?, ?, ?, ?)`,[crypto.randomUUID(),tenantId,actorId,action,transferId,reason,JSON.stringify(changes),crypto.randomUUID()]);
}
async function ensureRecipientAvailable(db,recipientEmail){
  const [[identity]]=await db.query('SELECT id FROM sx_identities WHERE email_normalized=? LIMIT 1 FOR UPDATE',[recipientEmail]);
  const [[legacyUser]]=await db.query('SELECT id FROM user WHERE LOWER(email)=? LIMIT 1 FOR UPDATE',[recipientEmail]);
  const [[agent]]=await db.query('SELECT id FROM agents WHERE LOWER(email)=? LIMIT 1 FOR UPDATE',[recipientEmail]);
  if(identity||legacyUser||agent)fail('OWNER_RECIPIENT_ACCOUNT_EXISTS',409);
}
async function create(db,context,tenantId,input){
  authorize(context);
  if(!uuid(tenantId))fail('INVALID_TENANT_ID',400);
  const data=transferInput(input);
  await storage(db);
  const token=crypto.randomBytes(32).toString('base64url'),transferId=crypto.randomUUID(),tokenHash=digest(token);
  await db.beginTransaction();
  try{
    const [[tenant]]=await db.query("SELECT id,status FROM sx_tenants WHERE id=? FOR UPDATE",[tenantId]);
    if(!tenant||tenant.status!=='active')fail('TENANT_NOT_TRANSFERABLE',404);
    // Expired rows otherwise continue reserving their generated unique email
    // key forever because only explicit cancellation changes their status.
    await db.query("UPDATE sx_tenant_owner_transfers SET status='expired' WHERE tenant_id=? AND status='pending' AND expires_at<=UTC_TIMESTAMP(3)",[tenantId]);
    const [owners]=await db.query(`SELECT u.id AS legacyUserId,u.uid,u.email,m.id AS membershipId,m.identity_id AS identityId,
        i.status AS identityStatus,o.legacy_uid_hash AS legacyUidHash
      FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id
      JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='user'
      JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED)
      WHERE m.tenant_id=? AND m.role='owner' AND m.status='active' FOR UPDATE`,[tenantId]);
    if(owners.length!==1)fail('BUSINESS_LINK_INVALID',409);
    const owner=owners[0];
    if(owner.identityStatus!=='active'||owner.legacyUidHash!==digest(owner.uid))fail('BUSINESS_LINK_INVALID',409);
    if(owner.email&&String(owner.email).trim().toLowerCase()===data.recipientEmail)fail('OWNER_TRANSFER_SAME_EMAIL',400);
    await ensureRecipientAvailable(db,data.recipientEmail);
    await db.query("UPDATE sx_tenant_owner_transfers SET status='cancelled' WHERE tenant_id=? AND status='pending'",[tenantId]);
    await db.query(`INSERT INTO sx_tenant_owner_transfers(id,tenant_id,legacy_user_id,legacy_uid_hash,prior_identity_id,prior_membership_id,
        recipient_email_normalized,token_hash,invited_by_identity_id,reason,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 72 HOUR))`,[transferId,tenantId,owner.legacyUserId,digest(owner.uid),owner.identityId,owner.membershipId,data.recipientEmail,tokenHash,context.identity.id,data.reason]);
    await audit(db,{tenantId,actorId:context.identity.id,action:'tenant.owner-transfer.invited',transferId,reason:data.reason,changes:{priorIdentityId:owner.identityId,recipientEmailHash:digest(data.recipientEmail),legacyRootHash:digest(owner.uid),expiresInHours:72}});
    await db.commit();
    return {id:transferId,tenantId,email:data.recipientEmail,token,expiresInHours:72,status:'pending',delivery:'copy-link'};
  }catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')fail('OWNER_TRANSFER_CONFLICT',409);throw error;}
}
async function accept(db,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['token','name','password'].includes(key)))fail('INVALID_OWNER_TRANSFER',400);
  const token=typeof input.token==='string'?input.token:'';
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))fail('TRANSFER_INVALID',410);
  const name=typeof input.name==='string'?input.name.trim():'';
  if(name.length<2||name.length>200)fail('INVALID_DISPLAY_NAME',400);
  const newPassword=password(input.password);
  await storage(db);
  await db.beginTransaction();
  try{
    const [[transfer]]=await db.query(`SELECT id,tenant_id AS tenantId,legacy_user_id AS legacyUserId,legacy_uid_hash AS legacyUidHash,
        prior_identity_id AS priorIdentityId,prior_membership_id AS priorMembershipId,recipient_email_normalized AS recipientEmail,
        invited_by_identity_id AS invitedByIdentityId,reason,status,(expires_at>UTC_TIMESTAMP(3)) AS validNow
      FROM sx_tenant_owner_transfers WHERE token_hash=? FOR UPDATE`,[digest(token)]);
    if(!transfer||transfer.status!=='pending'||!transfer.validNow)fail('TRANSFER_INVALID',410);
    const [[tenant]]=await db.query("SELECT status FROM sx_tenants WHERE id=? FOR UPDATE",[transfer.tenantId]);
    if(tenant?.status!=='active')fail('TRANSFER_INVALID',410);
    await ensureRecipientAvailable(db,transfer.recipientEmail);
    const [[owner]]=await db.query(`SELECT u.id AS legacyUserId,u.uid,m.id AS membershipId,m.identity_id AS identityId,
        m.role,m.status AS membershipStatus,i.status AS identityStatus,o.legacy_uid_hash AS legacyUidHash
      FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR) AND o.tenant_id=?
      JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id
      JOIN sx_identities i ON i.id=m.identity_id
      WHERE u.id=? AND m.id=? AND m.identity_id=? FOR UPDATE`,[transfer.tenantId,transfer.legacyUserId,transfer.priorMembershipId,transfer.priorIdentityId]);
    if(!owner||owner.role!=='owner'||owner.membershipStatus!=='active'||owner.identityStatus!=='active'||owner.legacyUidHash!==transfer.legacyUidHash||digest(owner.uid)!==transfer.legacyUidHash)fail('TRANSFER_INVALID',410);
    const passwordHash=await bcrypt.hash(newPassword,12),identityId=crypto.randomUUID(),membershipId=crypto.randomUUID();
    const [oldMembership]=await db.query("UPDATE sx_memberships SET status='inactive',permission_version=permission_version+1 WHERE tenant_id=? AND id=? AND identity_id=? AND role='owner' AND status='active'",[transfer.tenantId,transfer.priorMembershipId,transfer.priorIdentityId]);
    if(oldMembership.affectedRows!==1)fail('TRANSFER_INVALID',410);
    await db.query("INSERT INTO sx_identities(id,email_normalized,display_name,password_hash,status) VALUES (?,?,?,?,'active')",[identityId,transfer.recipientEmail,name,passwordHash]);
    await db.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES (?,?,?,'owner','active')",[membershipId,transfer.tenantId,identityId]);
    const [mapping]=await db.query("UPDATE sx_legacy_ownership SET membership_id=?,legacy_uid_hash=?,verified_at=UTC_TIMESTAMP(3) WHERE source_table='user' AND source_id=? AND tenant_id=? AND membership_id=?",[membershipId,transfer.legacyUidHash,String(transfer.legacyUserId),transfer.tenantId,transfer.priorMembershipId]);
    if(mapping.affectedRows!==1)fail('TRANSFER_INVALID',410);
    const [legacy]=await db.query('UPDATE user SET name=?,email=?,password=? WHERE id=? AND uid=?',[name,transfer.recipientEmail,passwordHash,transfer.legacyUserId,owner.uid]);
    if(legacy.affectedRows!==1)fail('TRANSFER_INVALID',410);
    await db.query("UPDATE sx_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND membership_id=? AND revoked_at IS NULL",[transfer.tenantId,transfer.priorMembershipId]);
    const [completed]=await db.query("UPDATE sx_tenant_owner_transfers SET status='accepted',accepted_at=UTC_TIMESTAMP(3),new_identity_id=?,new_membership_id=? WHERE id=? AND status='pending' AND expires_at>UTC_TIMESTAMP(3)",[identityId,membershipId,transfer.id]);
    if(completed.affectedRows!==1)fail('TRANSFER_INVALID',410);
    await audit(db,{tenantId:transfer.tenantId,actorId:identityId,action:'tenant.owner-transfer.accepted',transferId:transfer.id,reason:transfer.reason,changes:{priorIdentityId:transfer.priorIdentityId,newIdentityId:identityId,priorMembershipId:transfer.priorMembershipId,newMembershipId:membershipId,legacyRootHash:transfer.legacyUidHash,revokedMembershipSessions:true}});
    await db.commit();
    return {status:'accepted',tenantId:transfer.tenantId,email:transfer.recipientEmail,loginPath:'/user/login'};
  }catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')fail('OWNER_TRANSFER_CONFLICT',409);throw error;}
}
module.exports={create,accept,authorize,transferInput};
