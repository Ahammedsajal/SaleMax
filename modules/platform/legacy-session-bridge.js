'use strict';
const crypto=require('node:crypto');
const bcrypt=require('bcrypt');
const {createAuthentication}=require('./authentication');

const uidHash=value=>crypto.createHash('sha256').update(String(value),'utf8').digest('hex');
const email=value=>String(value||'').trim().toLowerCase();
function configuration(overrides={}){
  if(process.env.SALEMAX_PLATFORM_ENABLED!=='true')return null;
  const value=overrides.key?Buffer.from(overrides.key).toString('base64'):process.env.SALEMAX_PLATFORM_KEY_BASE64;
  if(typeof value!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(value))throw Object.assign(new Error('AUTH_UNAVAILABLE'),{code:'AUTH_UNAVAILABLE'});
  const key=Buffer.from(value,'base64');
  if(key.length!==32||key.toString('base64')!==value)throw Object.assign(new Error('AUTH_UNAVAILABLE'),{code:'AUTH_UNAVAILABLE'});
  return {key,pool:overrides.pool||(overrides.getPool?.())||require('../../database/config').promise(),local:overrides.local??process.env.LOCAL_ONLY_MODE==='true',origin:overrides.expectedOrigin??process.env.SALEMAX_PLATFORM_ORIGIN};
}
async function withConnection(pool,work){const db=await pool.getConnection();try{return await work(db);}finally{db.release();}}

// Called only after the existing legacy login has verified this exact password.
// The old stored hash is never copied; the submitted password is freshly hashed
// with the canonical cost before the tenant session is created.
async function issueForVerifiedLegacyAccount({kind,legacyId,legacyUid,legacyEmail,password,address,origin,tenantHost,expectedOrigin,pool,key,local}={}){
  const config=configuration({pool,key,expectedOrigin,local});if(!config)return null;
  const customOrigin=typeof tenantHost==='string'&&origin===`https://${tenantHost}`;
  if(!origin||(origin!==config.origin&&!customOrigin))return null;
  const source=kind==='user'?'user':kind==='agent'?'agents':null;
  const expectedRoles=kind==='user'?['owner','accountant','manager']:kind==='agent'?['agent']:null;
  if(!source||!expectedRoles||!Number.isSafeInteger(Number(legacyId))||Number(legacyId)<1||typeof legacyUid!=='string'||!legacyUid||email(legacyEmail)===''||typeof password!=='string')return null;
  const db=await config.pool.getConnection();
  try{
    await db.beginTransaction();
    const [rows]=await db.query(`SELECT o.tenant_id AS tenantId,o.membership_id AS membershipId,o.legacy_uid_hash AS legacyUidHash,
      m.identity_id AS identityId,m.role,m.status AS membershipStatus,t.status AS tenantStatus,t.category_key AS categoryKey,
      t.category_version AS categoryVersion,i.email_normalized AS email,i.password_hash AS passwordHash,i.status AS identityStatus
      FROM sx_legacy_ownership o JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id
      JOIN sx_tenants t ON t.id=o.tenant_id JOIN sx_identities i ON i.id=m.identity_id
      WHERE o.source_table=? AND o.source_id=? FOR UPDATE`,[source,String(legacyId)]);
    if(!rows.length){await db.commit();return null;}
    if(rows.length!==1)throw Object.assign(new Error('BUSINESS_LINK_INVALID'),{code:'BUSINESS_LINK_INVALID'});
    const mapping=rows[0];
    if(customOrigin)await require('./tenant-crm-domains').assertTenantHost(db,{crmTenantDomain:{hostname:tenantHost,tenantId:mapping.tenantId}},mapping.tenantId);
    if(mapping.legacyUidHash!==uidHash(legacyUid)||email(mapping.email)!==email(legacyEmail)||!expectedRoles.includes(mapping.role)||mapping.membershipStatus!=='active'||mapping.identityStatus!=='active'||mapping.tenantStatus!=='active'||mapping.categoryKey!=='training_center'||Number(mapping.categoryVersion)!==1){
      throw Object.assign(new Error('BUSINESS_ACCESS_INACTIVE'),{code:'BUSINESS_ACCESS_INACTIVE'});
    }
    const canonicalHash=typeof mapping.passwordHash==='string'?mapping.passwordHash:null;
    const supportedHash=canonicalHash&&/^\$2[ab]\$(1[2-6])\$[./A-Za-z0-9]{53}$/.test(canonicalHash);
    const alreadyMatches=supportedHash&&await bcrypt.compare(password,canonicalHash);
    if(!alreadyMatches){
      const nextHash=await bcrypt.hash(password,12);
      const [updated]=await db.query(`UPDATE sx_identities SET password_hash=?,credential_version=credential_version+1
        WHERE id=? AND status='active'`,[nextHash,mapping.identityId]);
      if(updated.affectedRows!==1)throw Object.assign(new Error('BUSINESS_ACCESS_INACTIVE'),{code:'BUSINESS_ACCESS_INACTIVE'});
    }
    await db.commit();
    const auth=createAuthentication({key:config.key});
    const result=await auth.login(db,{audience:'tenant',tenantId:mapping.tenantId,email:email(legacyEmail),password},address);
    return {token:result.token,context:result.context,csrfToken:result.csrfToken,maxAgeSeconds:result.maxAgeSeconds,
      cookieName:config.local?'salemax_dev_session':'__Host-salemax_session',cookie:{httpOnly:true,secure:!config.local,sameSite:'strict',path:'/'}};
  }catch(error){try{await db.rollback();}catch(_){}throw error;}
  finally{db.release();}
}
module.exports={issueForVerifiedLegacyAccount};
