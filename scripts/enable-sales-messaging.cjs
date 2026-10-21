'use strict';
// Explicit owner-authorized maintenance: versioned tenant plan expansion with a
// system audit record. No platform session or MFA identity is manufactured.
const crypto=require('node:crypto');
const messaging=Object.freeze(['messaging.qr','messaging.meta','messaging.templates','campaigns.send','campaigns.dashboard','automation.flows','automation.chatbot']);
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const categories=require('../modules/platform/categories');
async function enable(db,{email,apply=false,expectedAssignmentId=null,saveBackup=null}={}){
 if(email!=='admin@salemax.qa')fail('DESIGNATED_OWNER_REQUIRED');
 await db.beginTransaction();
 try{
  const [owners]=await db.query(`SELECT u.id,u.uid,u.plan,u.plan_expire,t.id AS tenantId,t.category_key AS categoryKey,m.role
   FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
   JOIN sx_tenants t ON t.id=o.tenant_id JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=t.id
   WHERE LOWER(u.email)=? AND t.status='active' AND m.status='active' FOR UPDATE`,[email]);
  if(owners.length!==1||!categories.categoryKeyMatches(owners[0].categoryKey,categories.sevenNetworkSales.key)||owners[0].role!=='owner')fail('ACTIVE_SALES_OWNER_REQUIRED');
  const owner=owners[0];
  const [assignments]=await db.query(`SELECT a.*,v.plan_id,v.category_key,v.category_version,v.capabilities,v.role_limits AS versionRoleLimits
   FROM sx_plan_assignments a JOIN sx_plan_versions v ON v.id=a.plan_version_id
   WHERE a.tenant_id=? AND a.status IN ('active','trial','grace') AND a.effective_from<=UTC_TIMESTAMP(3)
   AND (a.expires_at IS NULL OR a.expires_at>UTC_TIMESTAMP(3)) FOR UPDATE`,[owner.tenantId]);
  if(assignments.length!==1)fail('UNIQUE_ACTIVE_PLAN_REQUIRED');const current=assignments[0];
  if(!categories.categoryKeyMatches(current.category_key,categories.sevenNetworkSales.key))fail('SALES_PLAN_REQUIRED');
  const capabilities=parse(current.capabilities),missing=messaging.filter(key=>!capabilities.includes(key));
  const preview={tenantId:owner.tenantId,assignmentId:current.id,previousVersionId:current.plan_version_id,missing,legacyPlanHash:hash(owner.plan),legacyExpiry:String(owner.plan_expire),seatLimitsUnchanged:true,commercialTermsUnchanged:true};
  if(!missing.length){await db.rollback();return {...preview,alreadyEnabled:true};}
  if(!apply){await db.rollback();return {...preview,preview:true};}
  if(expectedAssignmentId!==current.id)fail('STALE_ASSIGNMENT');
  const expanded=[...new Set([...capabilities,...messaging])].sort();
  require('../modules/platform/plans').definition({categoryKey:categories.sevenNetworkSales.key,categoryVersion:Number(current.category_version),capabilities:expanded,roleLimits:parse(current.versionRoleLimits)});
  const [[plan]]=await db.query('SELECT next_version FROM sx_plans WHERE id=? FOR UPDATE',[current.plan_id]);if(!plan)fail('PLAN_NOT_FOUND');
  const [contracts]=await db.query('SELECT * FROM sx_legacy_plan_contracts WHERE version_id=?',[current.plan_version_id]);if(contracts.length!==1)fail('EXISTING_CONTRACT_REQUIRED');
  if(saveBackup)await saveBackup({tenantId:owner.tenantId,priorAssignment:current,legacyPlanHash:preview.legacyPlanHash,legacyExpiry:preview.legacyExpiry});
  const contract=contracts[0],versionId=crypto.randomUUID(),assignmentId=crypto.randomUUID();
  const definition=require('../modules/platform/plans').definition({categoryKey:categories.sevenNetworkSales.key,categoryVersion:Number(current.category_version),capabilities:expanded,roleLimits:parse(current.versionRoleLimits)});
  await db.query(`INSERT INTO sx_plan_versions(id,plan_id,version,category_key,category_version,status,capabilities,role_limits,published_at)
   VALUES (?,?,?,?,?,'published',?,?,UTC_TIMESTAMP(3))`,[versionId,current.plan_id,plan.next_version,categories.sevenNetworkSales.key,current.category_version,JSON.stringify(expanded),current.versionRoleLimits]);
  await db.query('UPDATE sx_plans SET next_version=next_version+1 WHERE id=?',[current.plan_id]);
  await db.query(`INSERT INTO sx_legacy_plan_contracts(version_id,legacy_plan_id,request_id,actor_identity_id,commercial_snapshot,definition_hash,commercial_hash)
   VALUES (?,?,?,?,?,?,?)`,[versionId,contract.legacy_plan_id,crypto.randomUUID(),contract.actor_identity_id,contract.commercial_snapshot,hash(JSON.stringify(definition)),contract.commercial_hash]);
  await db.query("UPDATE sx_plan_assignments SET status='superseded' WHERE id=? AND status=?",[current.id,current.status]);
  await db.query(`INSERT INTO sx_plan_assignments(id,tenant_id,plan_version_id,role_limits,status,effective_from,expires_at)
   VALUES (?,?,?,?,?,UTC_TIMESTAMP(3),?)`,[assignmentId,owner.tenantId,versionId,current.role_limits,current.status,current.expires_at]);
  await db.query('UPDATE sx_tenants SET revision=revision+1 WHERE id=?',[owner.tenantId]);
  const [[after]]=await db.query('SELECT plan,plan_expire FROM user WHERE id=?',[owner.id]);if(hash(after.plan)!==preview.legacyPlanHash||String(after.plan_expire)!==preview.legacyExpiry)fail('LEGACY_TERMS_CHANGED');
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_kind,action,resource_type,resource_id,reason,changes,correlation_id)
   VALUES (?,?,'system','business.sales-messaging-enabled','plan-assignment',?,'Explicit owner request: restore QR, Meta, templates, campaigns, dashboard and automation in designated Sales workspace; preserve commercial terms and seats',?,?)`,[crypto.randomUUID(),owner.tenantId,assignmentId,JSON.stringify({...preview,versionId,assignmentId,added:missing}),crypto.randomUUID()]);
  await db.commit();return {...preview,applied:true,versionId,newAssignmentId:assignmentId};
 }catch(error){await db.rollback();throw error;}
}
module.exports={enable,messaging};
if(require.main===module){const pool=require('../database/config').promise();(async()=>{const db=await pool.getConnection();try{const backup=process.argv.find(x=>x.startsWith('--backup='))?.slice(9);if(process.argv.includes('--apply')&&!backup)fail('BACKUP_PATH_REQUIRED');console.log(JSON.stringify(await enable(db,{email:'admin@salemax.qa',apply:process.argv.includes('--apply'),expectedAssignmentId:process.argv.find(x=>x.startsWith('--expected='))?.slice(11),saveBackup:backup?data=>require('node:fs').writeFileSync(backup,JSON.stringify(data,null,2),{mode:0o600,flag:'wx'}):null})));}finally{db.release();await pool.end();}})().catch(error=>{console.error(error.code||'SALES_MESSAGING_FAILED');process.exitCode=1;});}
