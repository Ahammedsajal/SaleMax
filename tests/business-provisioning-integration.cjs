'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const express=require('express');
const http=require('node:http');
const provisioning=require('../modules/platform/business-provisioning');
module.exports=async(db,other,{i1})=>{
  const [[emailColumn]]=await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='user' AND COLUMN_NAME='email'");
  if(!emailColumn)await db.query('ALTER TABLE user ADD COLUMN email VARCHAR(999) NULL');
  const [[contract]]=await db.query("SELECT c.legacy_plan_id,c.commercial_snapshot,v.id AS version_id,v.role_limits FROM sx_legacy_plan_contracts c JOIN sx_plan_versions v ON v.id=c.version_id WHERE v.status='published' AND v.category_key='training_center' ORDER BY v.published_at DESC LIMIT 1");
  assert.ok(contract,'published existing-catalogue training plan contract');
  const commercial=typeof contract.commercial_snapshot==='string'?JSON.parse(contract.commercial_snapshot):contract.commercial_snapshot;
  const roleLimits=typeof contract.role_limits==='string'?JSON.parse(contract.role_limits):contract.role_limits;
  assert.equal(Number(commercial.id),Number(contract.legacy_plan_id));
  const uid='provision-'+crypto.randomUUID(),email=`provision-${crypto.randomUUID()}@example.invalid`,expiry=String(Date.now()+86400000);
  const [user]=await db.query('INSERT INTO user(uid,name,email,plan,plan_expire) VALUES (?,?,?,?,?)',[uid,'Synthetic Training Centre',email,JSON.stringify(commercial),expiry]);
  const actor={audience:'platform',identity:{id:i1},membership:{role:'super_admin',status:'active'},mfaVerified:true,recentlyAuthenticated:true};
  let [[adminLink]]=await db.query("SELECT legacy_admin_id,legacy_uid FROM sx_legacy_admin_identities WHERE identity_id=? AND status='active' LIMIT 1",[i1]);
  if(!adminLink){const legacyAdminId=2147480000,legacyAdminUid='synthetic-provisioning-admin-'+crypto.randomUUID();await db.query('INSERT INTO sx_legacy_admin_identities(legacy_admin_id,legacy_uid,legacy_uid_hash,identity_id,verified_by,verified_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))',[legacyAdminId,legacyAdminUid,crypto.createHash('sha256').update(legacyAdminUid).digest('hex'),i1,i1]);adminLink={legacy_admin_id:legacyAdminId,legacy_uid:legacyAdminUid};}
  const legacyAdminId=adminLink.legacy_admin_id,legacyAdminUid=adminLink.legacy_uid;
  db.release=()=>{};
  const app=express();
  const router=require('../modules/platform/existing-business-router').createExistingBusinessRouter({pool:{getConnection:async()=>db},legacyGuard:(req,res,next)=>{req.legacyAdminId=legacyAdminId;req.decode={uid:legacyAdminUid};next();},canonicalGuard:(req,res,next)=>{req.businessContext=actor;next();}});
  app.use('/api/admin/business-contracts',router);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const request=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/admin/business-contracts/${path}`,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};};
  const requestId=crypto.randomUUID(),businessName='Synthetic Training Centre QA';
  try {
  const options=await request(`${user.insertId}/provision-options`);assert.equal(options.status,200);assert.equal(options.body.data.user.id,user.insertId);assert.equal(options.body.data.contract.id,contract.version_id);
  const previewResult=await request(`${user.insertId}/provision-preview`,{planVersionId:contract.version_id,roleLimits,businessName,requestId});assert.equal(previewResult.status,200);const preview=previewResult.body.data;
  assert.equal(preview.readOnly,true);assert.equal(preview.canProvision,true);assert.equal(preview.category.key,'training_center');
  await db.query('UPDATE user SET name=? WHERE id=?',['Changed during preview',user.insertId]);
  const stale=await request(`${user.insertId}/provision`,{planVersionId:contract.version_id,roleLimits,businessName,requestId,expectedState:preview.expectedState});assert.equal(stale.status,409);assert.equal(stale.body.code,'STALE_PROVISION');
  await db.query('UPDATE user SET name=? WHERE id=?',['Synthetic Training Centre',user.insertId]);
  const reviewed=(await request(`${user.insertId}/provision-preview`,{planVersionId:contract.version_id,roleLimits,businessName,requestId})).body.data;
  const confirmed=await request(`${user.insertId}/provision`,{planVersionId:contract.version_id,roleLimits,businessName,requestId,expectedState:reviewed.expectedState});assert.equal(confirmed.status,201);const result=confirmed.body.data;
  assert.equal(result.replayed,false);assert.equal(result.status,Number(commercial.is_trial)===1?'trial':'active');
  const replay=(await request(`${user.insertId}/provision`,{planVersionId:contract.version_id,roleLimits,businessName,requestId,expectedState:reviewed.expectedState})).body.data;assert.equal(replay.replayed,true);assert.equal(replay.tenantId,result.tenantId);
  const [[tenant]]=await db.query('SELECT name,category_key,category_version,country_code,currency,timezone,status FROM sx_tenants WHERE id=?',[result.tenantId]);assert.equal(tenant.name,businessName);assert.equal(tenant.category_key,'training_center');assert.equal(Number(tenant.category_version),1);assert.equal(tenant.country_code,'QA');assert.equal(tenant.currency,'QAR');assert.equal(tenant.timezone,'Asia/Qatar');assert.equal(tenant.status,'active');
  const [[identity]]=await db.query("SELECT i.email_normalized,i.password_hash,i.status,m.role FROM sx_legacy_ownership o JOIN sx_memberships m ON m.id=o.membership_id JOIN sx_identities i ON i.id=m.identity_id WHERE o.source_table='user' AND o.source_id=?",[String(user.insertId)]);assert.equal(identity.email_normalized,email);assert.equal(identity.password_hash,null);assert.equal(identity.status,'active');assert.equal(identity.role,'owner');
  const [[assignment]]=await db.query('SELECT id,tenant_id,plan_version_id,role_limits,status FROM sx_plan_assignments WHERE id=?',[result.assignmentId]);assert.equal(assignment.tenant_id,result.tenantId);assert.equal(assignment.plan_version_id,contract.version_id);
  const [[ownerMap]]=await db.query("SELECT legacy_uid_hash FROM sx_legacy_ownership WHERE source_table='user' AND source_id=? AND tenant_id=?",[String(user.insertId),result.tenantId]);assert.equal(ownerMap.legacy_uid_hash,crypto.createHash('sha256').update(uid).digest('hex'));
  await assert.rejects(provisioning.options(db,actor,user.insertId),{code:'BUSINESS_ALREADY_PROVISIONED'});
  const denied={...actor,mfaVerified:false};await assert.rejects(provisioning.options(db,denied,user.insertId),{code:'PERMISSION_DENIED'});
  const [[audit]]=await db.query("SELECT COUNT(*) n FROM sx_audit_events WHERE tenant_id=? AND action='business.tenant-provisioned'",[result.tenantId]);assert.equal(Number(audit.n),1);
  return {existingBusinessProvisionHttpWorkflow:true,existingUserProvisionedInPlace:true,trainingCategoryAndQatarDefaults:true,publishedPlanAssignedAtomically:true,provisionPreviewStalenessEnforced:true,provisionIdempotency:true,reviewedLegacyOwnerLinkCreated:true,provisioningAudited:true,unauthorizedProvisionDenied:true};
  } finally {await new Promise(resolve=>server.close(resolve));}
};
