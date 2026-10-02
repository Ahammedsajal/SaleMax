'use strict';
const crypto=require('node:crypto');
const plans=require('./plans');
const sha=value=>crypto.createHash('sha256').update(String(value),'utf8').digest('hex');
const normalizedEmail=value=>String(value||'').trim().toLowerCase();
const deny=code=>({denied:true,code});

// Resolve only explicitly linked team users. Unmapped users and verified tenant
// owners keep the original legacy pipeline behavior during the migration.
async function resolve(pool,user,{loadEntitlements=plans.loadEntitlements}={}){
  if(!user||!Number.isSafeInteger(Number(user.id))||Number(user.id)<1||typeof user.uid!=='string'||!user.uid)return deny('AUTH_REQUIRED');
  const db=await pool.getConnection();
  try{
    const [rows]=await db.query(`SELECT t.id AS tenantId,t.status AS tenantStatus,t.category_key AS categoryKey,t.category_version AS categoryVersion,
        m.id AS membershipId,m.identity_id AS identityId,m.role,m.status AS membershipStatus,
        i.email_normalized AS identityEmail,i.status AS identityStatus,o.legacy_uid_hash AS legacyUidHash
      FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
      JOIN sx_tenants t ON t.id=o.tenant_id JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=t.id
      JOIN sx_identities i ON i.id=m.identity_id WHERE u.id=? AND u.uid=? LIMIT 2`,[Number(user.id),user.uid]);
    if(!rows.length)return null;
    if(rows.length!==1)return deny('BUSINESS_LINK_INVALID');
    const linked=rows[0];
    if(linked.legacyUidHash!==sha(user.uid)||normalizedEmail(linked.identityEmail)!==normalizedEmail(user.email)||linked.identityStatus!=='active'||linked.membershipStatus!=='active'||linked.tenantStatus!=='active'||linked.categoryKey!=='training_center'||Number(linked.categoryVersion)!==1)return deny('BUSINESS_ACCESS_INACTIVE');
    if(linked.role==='owner')return null;
    if(linked.role==='accountant')return deny('PERMISSION_DENIED');
    if(linked.role!=='manager')return deny('PERMISSION_DENIED');
    const entitlement=await loadEntitlements(db,linked.tenantId);
    if(!entitlement||!['active','trial','grace'].includes(entitlement.status)||!entitlement.capabilities?.includes('crm.leads'))return deny('FEATURE_UNAVAILABLE');
    const [owners]=await db.query(`SELECT u.uid,u.timezone,o.legacy_uid_hash AS ownerUidHash
      FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
      JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=o.tenant_id AND m.role='owner' AND m.status='active'
      JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
      WHERE o.tenant_id=? LIMIT 2`,[linked.tenantId]);
    if(owners.length!==1||owners[0].ownerUidHash!==sha(owners[0].uid))return deny('BUSINESS_LINK_INVALID');
    return {uid:owners[0].uid,role:'manager',actorType:'user',actorId:linked.identityId,identityId:linked.identityId,membershipId:linked.membershipId,
      tenantId:linked.tenantId,legacyUserId:Number(user.id),legacyUid:user.uid,timezone:owners[0].timezone||'Asia/Qatar'};
  }finally{db.release();}
}
module.exports={resolve};
