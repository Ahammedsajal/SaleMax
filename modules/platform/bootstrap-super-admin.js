'use strict';
const crypto=require('node:crypto');
const bcrypt=require('bcrypt');

const fail=code=>{throw Object.assign(new Error(code),{code});};
const uidDigest=value=>crypto.createHash('sha256').update(value,'utf8').digest();
function validate(input){
  if(!input||input.confirmation!=='BOOTSTRAP PRODUCT OWNER')fail('OWNER_CONFIRMATION_REQUIRED');
  if(!Number.isSafeInteger(input.legacyAdminId)||input.legacyAdminId<1)fail('INVALID_ADMIN_ID');
  if(typeof input.legacyUid!=='string'||!input.legacyUid||input.legacyUid!==input.legacyUid.trim()||input.legacyUid.length>999)fail('INVALID_ADMIN_UID');
  if(typeof input.password!=='string'||!input.password||Buffer.byteLength(input.password,'utf8')>72)fail('INVALID_ADMIN_CREDENTIALS');
  return input;
}
async function bootstrap(connection,input){
  const data=validate(input);
  await connection.beginTransaction();
  try{
    const required=['admin','sx_identities','sx_platform_memberships','sx_legacy_admin_identities','sx_audit_events'];
    const [tables]=await connection.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${required.map(()=>'?').join(',')})`,required);
    if(new Set(tables.map(row=>row.TABLE_NAME)).size!==required.length)fail('PLATFORM_MIGRATIONS_REQUIRED');
    const [[legacy]]=await connection.query('SELECT id,uid,email,password,role FROM admin WHERE id=? FOR UPDATE',[data.legacyAdminId]);
    if(!legacy||legacy.role!=='admin'||typeof legacy.uid!=='string'||!legacy.uid)fail('LEGACY_ADMIN_NOT_FOUND');
    const expected=uidDigest(legacy.uid),supplied=uidDigest(data.legacyUid);
    if(expected.length!==supplied.length||!crypto.timingSafeEqual(expected,supplied))fail('LEGACY_ADMIN_UID_MISMATCH');
    const email=typeof legacy.email==='string'?legacy.email.trim().toLowerCase():'';
    if(!email||email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('LEGACY_ADMIN_EMAIL_INVALID');
    if(typeof legacy.password!=='string'||!await bcrypt.compare(data.password,legacy.password))fail('LEGACY_ADMIN_CREDENTIALS_INVALID');
    const [[platformCount]]=await connection.query('SELECT COUNT(*) AS total FROM sx_platform_memberships');
    if(Number(platformCount.total)!==0)fail('PLATFORM_ALREADY_PROVISIONED');
    const [[identity]]=await connection.query('SELECT id FROM sx_identities WHERE email_normalized=? FOR UPDATE',[email]);
    if(identity)fail('CANONICAL_IDENTITY_EXISTS');
    const identityId=crypto.randomUUID(),correlationId=crypto.randomUUID();
    const legacyUidHash=crypto.createHash('sha256').update(legacy.uid,'utf8').digest('hex');
    const passwordHash=await bcrypt.hash(data.password,12);
    await connection.query("INSERT INTO sx_identities(id,email_normalized,display_name,password_hash,status) VALUES (?,?,?,?,'active')",[identityId,email,email,passwordHash]);
    await connection.query("INSERT INTO sx_platform_memberships(identity_id,role,delegated_permissions) VALUES (?,'super_admin','[]')",[identityId]);
    await connection.query(`INSERT INTO sx_legacy_admin_identities(legacy_admin_id,legacy_uid,legacy_uid_hash,identity_id,verified_by,verified_at)
      VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))`,[legacy.id,legacy.uid,legacyUidHash,identityId,identityId]);
    await connection.query(`INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,'identity','platform.super-admin-bootstrapped','legacy-admin',?,?,?)`,[crypto.randomUUID(),identityId,String(legacy.id),JSON.stringify({method:'one-time-owner-bootstrap',legacyUidHash}),correlationId]);
    await connection.commit();
    return {identityId,email,legacyAdminId:legacy.id};
  }catch(error){
    await connection.rollback();
    if(error.code==='ER_DUP_ENTRY')fail('PLATFORM_ALREADY_PROVISIONED');
    throw error;
  }
}
module.exports={bootstrap,validate};
