'use strict';
const crypto=require('node:crypto');
const bcrypt=require('bcrypt');
const {platformDecision}=require('./policy');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const digest=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
function authorize(context){if(context?.audience!=='platform'||!platformDecision(context,'categories.manage')||!platformDecision(context,'tenants.create'))fail('PERMISSION_DENIED');}
function inputPassword(value){if(typeof value!=='string'||value.length<12||Buffer.byteLength(value,'utf8')>72)fail('INVALID_PASSWORD');return value;}
async function storage(db){
  const names=['sx_business_owner_invites','sx_tenants','sx_identities','sx_memberships','sx_legacy_ownership','sx_audit_events','user'];
  const [rows]=await db.query(`SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names.map(()=>'?').join(',')})`,names);
  if(rows.length!==names.length||rows.some(row=>row.ENGINE!=='InnoDB'))fail('OWNER_INVITATION_STORAGE_NOT_READY');
}
async function audit(db,actorId,action,resourceId,changes){
  await db.query(`INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?,?,'identity',?,'business-owner-invitation',?,?,?)`,[crypto.randomUUID(),actorId,action,resourceId,JSON.stringify(changes),crypto.randomUUID()]);
}
async function create(db,context,userId){
  authorize(context);await storage(db);
  if(!Number.isSafeInteger(Number(userId))||Number(userId)<1)fail('INVALID_USER_ID');
  const token=crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID(),tokenHash=digest(token);
  await db.beginTransaction();
  try{
    const [[owner]]=await db.query(`SELECT u.id AS userId,u.email,u.uid,o.tenant_id AS tenantId,o.membership_id AS membershipId,
        m.identity_id AS identityId,m.role,m.status AS membershipStatus,i.status AS identityStatus,i.password_hash AS passwordHash,t.category_key AS categoryKey,t.status AS tenantStatus
      FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
      JOIN sx_tenants t ON t.id=o.tenant_id JOIN sx_memberships m ON m.tenant_id=t.id AND m.id=o.membership_id
      JOIN sx_identities i ON i.id=m.identity_id WHERE u.id=? FOR UPDATE`,[Number(userId)]);
    if(!owner||owner.categoryKey!=='salemax_sales'||owner.role!=='owner'||owner.membershipStatus!=='active'||owner.identityStatus!=='active'||owner.tenantStatus!=='active')fail('SALES_OWNER_NOT_READY');
    if(String(owner.email).trim().toLowerCase()!=='admin@salemax.qa')fail('DESIGNATED_OWNER_REQUIRED');
    if(owner.passwordHash)fail('OWNER_ALREADY_ACTIVATED');
    const [[legacyCheck]]=await db.query('SELECT id,uid FROM user WHERE id=? FOR UPDATE',[owner.userId]);
    const [matches]=await db.query('SELECT id FROM user WHERE uid=? FOR UPDATE',[legacyCheck.uid]);if(matches.length!==1)fail('AMBIGUOUS_USER');
    await db.query("UPDATE sx_business_owner_invites SET status='cancelled' WHERE tenant_id=? AND status='pending'",[owner.tenantId]);
    await db.query(`INSERT INTO sx_business_owner_invites(id,tenant_id,identity_id,legacy_user_id,token_hash,invited_by_identity_id,expires_at)
      VALUES (?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 72 HOUR))`,[id,owner.tenantId,owner.identityId,owner.userId,tokenHash,context.identity.id]);
    await audit(db,context.identity.id,'business.owner-invite-created',id,{email:String(owner.email).toLowerCase(),expiresInHours:72,delivery:'copy-link'});
    await db.commit();
    return {id,email:String(owner.email).toLowerCase(),token,expiresInHours:72,status:'pending',delivery:'copy-link'};
  }catch(error){await db.rollback();throw error;}
}
async function accept(db,input){
  const token=typeof input?.token==='string'?input.token:'';if(!/^[A-Za-z0-9_-]{40,64}$/.test(token))fail('INVITE_INVALID');
  if(typeof input?.name!=='string'||input.name.trim().length<2||input.name.trim().length>200)fail('INVALID_DISPLAY_NAME');
  const password=inputPassword(input.password);await storage(db);const tokenHash=digest(token);
  await db.beginTransaction();
  try{
    const [[invite]]=await db.query(`SELECT v.id,v.tenant_id AS tenantId,v.identity_id AS identityId,v.legacy_user_id AS legacyUserId,v.status,
        i.email_normalized AS email,i.password_hash AS currentPasswordHash,i.status AS identityStatus,m.role,m.status AS membershipStatus,t.status AS tenantStatus,t.category_key AS categoryKey,u.uid,LOWER(u.email) AS legacyEmail
      FROM sx_business_owner_invites v JOIN sx_identities i ON i.id=v.identity_id
      JOIN sx_memberships m ON m.tenant_id=v.tenant_id AND m.identity_id=v.identity_id
      JOIN sx_tenants t ON t.id=v.tenant_id JOIN user u ON u.id=v.legacy_user_id
      JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR) AND o.tenant_id=v.tenant_id AND o.membership_id=m.id
      WHERE v.token_hash=? AND v.expires_at>UTC_TIMESTAMP(3) FOR UPDATE`,[tokenHash]);
    if(!invite||invite.status!=='pending'||invite.currentPasswordHash||invite.identityStatus!=='active'||invite.membershipStatus!=='active'||invite.role!=='owner'||invite.tenantStatus!=='active'||invite.categoryKey!=='salemax_sales'||invite.email!=='admin@salemax.qa'||invite.legacyEmail!==invite.email)fail('INVITE_INVALID');
    const [sameUid]=await db.query('SELECT id FROM user WHERE uid=? FOR UPDATE',[invite.uid]);if(sameUid.length!==1)fail('INVITE_INVALID');
    const passwordHash=await bcrypt.hash(password,12);
    const [updated]=await db.query('UPDATE user SET name=?,password=? WHERE id=?',[input.name.trim(),passwordHash,invite.legacyUserId]);if(updated.affectedRows!==1)fail('INVITE_INVALID');
    const [identity]=await db.query("UPDATE sx_identities SET display_name=?,password_hash=?,credential_version=credential_version+1 WHERE id=? AND status='active' AND password_hash IS NULL",[input.name.trim(),passwordHash,invite.identityId]);if(identity.affectedRows!==1)fail('INVITE_INVALID');
    await db.query("UPDATE sx_business_owner_invites SET status='accepted',accepted_at=UTC_TIMESTAMP(3) WHERE id=? AND status='pending'",[invite.id]);
    await audit(db,invite.identityId,'business.owner-invite-accepted',invite.id,{email:invite.email});
    await db.commit();return {status:'accepted',email:invite.email,loginPath:'/user/login'};
  }catch(error){await db.rollback();throw error;}
}
module.exports={create,accept};
