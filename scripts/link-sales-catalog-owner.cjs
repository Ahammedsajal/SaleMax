'use strict';
// Explicit infrastructure-operator task. No browser session, MFA assertion or
// user credential is manufactured. All mutations carry a system audit event.
const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const id=()=>crypto.randomUUID();
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const fail=code=>{throw Object.assign(Error(code),{code});};
async function link(db,{email,apply=false}){
 if(email!=='admin@salemax.qa')fail('DESIGNATED_OWNER_REQUIRED');
 await db.beginTransaction();
 try{
  const [users]=await db.query('SELECT id,uid,name,email,plan,plan_expire,timezone FROM user WHERE LOWER(email)=? FOR UPDATE',[email]);
  if(users.length!==1)fail('UNIQUE_EXISTING_ACCOUNT_REQUIRED');const user=users[0];
  const [[existing]]=await db.query("SELECT t.category_key AS categoryKey,t.id AS tenantId FROM sx_legacy_ownership o JOIN sx_tenants t ON t.id=o.tenant_id WHERE o.source_table='user' AND o.source_id=?",[String(user.id)]);
  if(existing){if(existing.categoryKey!=='salemax_sales')fail('EXISTING_CATEGORY_MUST_BE_PRESERVED');await db.rollback();return {alreadyLinked:true,categoryKey:existing.categoryKey,tenantId:existing.tenantId};}
  const [[identity]]=await db.query('SELECT id FROM sx_identities WHERE email_normalized=?',[email]);if(identity)fail('EXISTING_IDENTITY_REQUIRES_REVIEW');
  const [[duplicates]]=await db.query('SELECT COUNT(*) AS n FROM user WHERE uid=?',[user.uid]);if(Number(duplicates.n)!==1)fail('AMBIGUOUS_ACCOUNT');
  const current=require('../modules/platform/legacy-plan-assignment').summary(user.plan);if(!current.valid||!current.plan)fail('ASSIGNED_PLAN_REQUIRED');
  const commercial=parse(user.plan),legacyId=Number(commercial.id),expiry=Number(user.plan_expire);
  if(!Number.isSafeInteger(legacyId)||legacyId<1||!Number.isFinite(expiry)||expiry<=Date.now())fail('ACTIVE_PLAN_REQUIRED');
  if(Object.keys(require('../modules/platform/legacy-plan-editor').normalize(commercial).errors).length)fail('INVALID_ASSIGNED_COMMERCIAL_TERMS');
  const [[platformOwner]]=await db.query("SELECT p.identity_id AS id FROM sx_platform_memberships p JOIN sx_identities i ON i.id=p.identity_id WHERE p.role='super_admin' AND p.status='active' AND i.status='active'");if(!platformOwner)fail('PLATFORM_CUSTODIAN_REQUIRED');
  const [[ceiling]]=await db.query("SELECT v.role_limits AS roleLimits FROM sx_plan_versions v JOIN sx_legacy_plan_contracts c ON c.version_id=v.id WHERE c.legacy_plan_id=? AND v.category_key='training_center' AND v.status='published' ORDER BY v.version DESC LIMIT 1",[legacyId]);
  const baseline=ceiling?parse(ceiling.roleLimits):{owner:1,accountant:0,manager:0,agent:0};
  const roleLimits={owner:1,accountant:baseline.accountant,manager:baseline.manager,team_leader:0,agent:baseline.agent};
  const category=require('../modules/platform/categories').salemaxSales;
  const definition=require('../modules/platform/plans').definition({categoryKey:category.key,categoryVersion:category.version,capabilities:[...category.capabilities],roleLimits});
  const preview={account:email,userId:user.id,categoryKey:category.key,legacyPlanId:legacyId,expiresAt:new Date(expiry).toISOString(),timezone:user.timezone||'Asia/Qatar',roleLimits,legacyPlanHash:hash(user.plan),legacyAccountUnchanged:true,trainingWorkspacesUnchanged:true};
  if(!apply){await db.rollback();return {...preview,preview:true};}
  const tenantId=id(),identityId=id(),membershipId=id(),versionId=id(),assignmentId=id(),requestId=id();
  let [[mapping]]=await db.query('SELECT plan_id AS planId FROM sx_legacy_plan_catalogue WHERE legacy_plan_id=? FOR UPDATE',[legacyId]);
  if(!mapping){mapping={planId:id()};await db.query('INSERT INTO sx_plans(id,name) VALUES (?,?)',[mapping.planId,String(commercial.title||'Existing plan')]);await db.query('INSERT INTO sx_legacy_plan_catalogue(legacy_plan_id,plan_id) VALUES (?,?)',[legacyId,mapping.planId]);}
  const [[plan]]=await db.query('SELECT next_version AS nextVersion FROM sx_plans WHERE id=? FOR UPDATE',[mapping.planId]);
  await db.query("INSERT INTO sx_plan_versions(id,plan_id,version,category_key,category_version,status,capabilities,role_limits,published_at) VALUES (?,?,?,?,1,'published',?,?,UTC_TIMESTAMP(3))",[versionId,mapping.planId,plan.nextVersion,category.key,JSON.stringify(definition.capabilities),JSON.stringify(roleLimits)]);
  await db.query('UPDATE sx_plans SET next_version=next_version+1 WHERE id=?',[mapping.planId]);
  const snapshot=JSON.stringify(commercial);
  await db.query('INSERT INTO sx_legacy_plan_contracts(version_id,legacy_plan_id,request_id,actor_identity_id,commercial_snapshot,definition_hash,commercial_hash) VALUES (?,?,?,?,?,?,?)',[versionId,legacyId,requestId,platformOwner.id,snapshot,hash(JSON.stringify(definition)),hash(snapshot)]);
  await db.query("INSERT INTO sx_tenants(id,slug,name,category_key,category_version,country_code,currency,timezone,status) VALUES (?,?,?,'salemax_sales',1,'QA','QAR',?,'active')",[tenantId,'salemax-sales-'+tenantId.slice(0,8),String(user.name||'SaleMaX Sales'),user.timezone||'Asia/Qatar']);
  await db.query("INSERT INTO sx_identities(id,email_normalized,display_name,password_hash,status) VALUES (?,?,?,NULL,'active')",[identityId,email,String(user.name||'SaleMaX Sales')]);
  await db.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES (?,?,?,'owner','active')",[membershipId,tenantId,identityId]);
  await db.query("INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash,verified_at) VALUES ('user',?,?,?,?,UTC_TIMESTAMP(3))",[String(user.id),tenantId,membershipId,hash(user.uid)]);
  await db.query("INSERT INTO sx_plan_assignments(id,tenant_id,plan_version_id,role_limits,status,effective_from,expires_at) VALUES (?,?,?,?,'active',UTC_TIMESTAMP(3),FROM_UNIXTIME(?/1000))",[assignmentId,tenantId,versionId,JSON.stringify(roleLimits),expiry]);
  await db.query("INSERT INTO sx_audit_events(id,tenant_id,actor_kind,action,resource_type,resource_id,reason,changes,correlation_id) VALUES (?,?,'system','business.sales-catalog-linked','tenant',?,'Explicit owner request via authorized SSH maintenance; preserve existing login, plan expiry, commercial terms and Training Center data',?,?)",[id(),tenantId,tenantId,JSON.stringify({...preview,planVersionId:versionId,assignmentId,custodianIdentityId:platformOwner.id}),requestId]);
  const [[after]]=await db.query('SELECT plan,plan_expire FROM user WHERE id=?',[user.id]);if(hash(after.plan)!==preview.legacyPlanHash||Number(after.plan_expire)!==expiry)fail('LEGACY_ACCOUNT_CHANGED');
  await db.commit();return {...preview,tenantId,planVersionId:versionId,assignmentId,applied:true};
 }catch(error){await db.rollback();throw error;}
}
module.exports={link};
if(require.main===module){const args=process.argv.slice(2);if(args.some(arg=>!['--apply','--preview','admin@salemax.qa'].includes(arg))||!args.includes('admin@salemax.qa'))throw Error('USE_PREVIEW_OR_APPLY_WITH_DESIGNATED_EMAIL');const pool=require('../database/config').promise();(async()=>{const db=await pool.getConnection();try{console.log(JSON.stringify(await link(db,{email:'admin@salemax.qa',apply:args.includes('--apply')})));}finally{db.release();await pool.end();}})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});}
