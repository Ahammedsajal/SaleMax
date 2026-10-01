'use strict';
const crypto=require('node:crypto');
const plans=require('./plans');
const {platformDecision}=require('./policy');
const {columns,normalize}=require('./legacy-plan-editor');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function authorize(ctx,permission){if(!platformDecision(ctx,permission)||!uuid(ctx.identity?.id))fail('PERMISSION_DENIED');}
function id(value){if(!Number.isSafeInteger(value)||value<1||value>2147483647)fail('INVALID_LEGACY_PLAN_ID');return value;}
function snapshot(row){return Object.fromEntries(['id',...columns].map(key=>[key,row[key]]));}
const parse=value=>typeof value==='string'?JSON.parse(value):value;
async function transaction(db,fn){const [tables]=await db.query("SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('plan','sx_plans','sx_plan_versions','sx_legacy_plan_catalogue','sx_legacy_plan_contracts','sx_audit_events')");if(tables.length!==6||tables.some(table=>table.ENGINE!=='InnoDB'))fail('CATALOGUE_STORAGE_NOT_READY');await db.beginTransaction();try{const result=await fn();await db.commit();return result;}catch(error){await db.rollback();throw error;}}
async function audit(db,ctx,action,resource,changes){await db.query("INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,'identity',?,'plan-version',?,?,?)",[crypto.randomUUID(),ctx.identity.id,action,resource,JSON.stringify(changes),crypto.randomUUID()]);}
async function createDraft(db,ctx,input){
  authorize(ctx,'plans.draft');const legacyId=id(input?.legacyPlanId),definition=plans.definition(input);
  if(!uuid(input.requestId))fail('INVALID_REQUEST_ID');const requestId=input.requestId.toLowerCase();
  return transaction(db,async()=>{
    // Catalogue first: this serializes first mapping and subsequent version allocation.
    const [[row]]=await db.query('SELECT * FROM plan WHERE id=? FOR UPDATE',[legacyId]);if(!row)fail('PLAN_NOT_FOUND');
    const [[prior]]=await db.query('SELECT c.*,v.version,v.revision,v.status FROM sx_legacy_plan_contracts c JOIN sx_plan_versions v ON v.id=c.version_id WHERE c.request_id=?',[requestId]);
    if(prior){
      const same=prior.legacy_plan_id===legacyId&&prior.actor_identity_id===ctx.identity.id&&prior.definition_hash===hash(JSON.stringify(definition));
      if(!same)fail('IDEMPOTENCY_CONFLICT');return {id:prior.version_id,version:prior.version,revision:prior.revision,status:prior.status,replayed:true};
    }
    if(Object.keys(normalize(row).errors).length)fail('LEGACY_PLAN_INVALID');
    let [[mapping]]=await db.query('SELECT plan_id FROM sx_legacy_plan_catalogue WHERE legacy_plan_id=?',[legacyId]);
    if(!mapping){mapping={plan_id:crypto.randomUUID()};await db.query('INSERT INTO sx_plans(id,name) VALUES (?,?)',[mapping.plan_id,row.title.slice(0,200)]);await db.query('INSERT INTO sx_legacy_plan_catalogue(legacy_plan_id,plan_id) VALUES (?,?)',[legacyId,mapping.plan_id]);}
    const [[catalogue]]=await db.query('SELECT next_version FROM sx_plans WHERE id=? FOR UPDATE',[mapping.plan_id]);
    const versionId=crypto.randomUUID(),commercial=snapshot(row),commercialJson=JSON.stringify(commercial);
    await db.query('INSERT INTO sx_plan_versions(id,plan_id,version,category_key,category_version,capabilities,role_limits) VALUES (?,?,?,?,?,?,?)',[versionId,mapping.plan_id,catalogue.next_version,definition.categoryKey,definition.categoryVersion,JSON.stringify(definition.capabilities),JSON.stringify(definition.roleLimits)]);
    await db.query('UPDATE sx_plans SET next_version=next_version+1 WHERE id=?',[mapping.plan_id]);
    await db.query('INSERT INTO sx_legacy_plan_contracts(version_id,legacy_plan_id,request_id,actor_identity_id,commercial_snapshot,commercial_hash,definition_hash) VALUES (?,?,?,?,?,?,?)',[versionId,legacyId,requestId,ctx.identity.id,commercialJson,hash(commercialJson),hash(JSON.stringify(definition))]);
    await audit(db,ctx,'legacy-plan.draft-created',versionId,{legacyPlanId:legacyId,version:catalogue.next_version});
    return {id:versionId,version:catalogue.next_version,revision:1,status:'draft',commercial,commercialHash:hash(commercialJson),replayed:false};
  });
}
async function list(db,ctx,legacyPlanId){
  authorize(ctx,'plans.read');id(legacyPlanId);
  const [rows]=await db.query('SELECT v.id,v.version,v.revision,v.status,v.category_key AS categoryKey,v.category_version AS categoryVersion,v.capabilities,v.role_limits AS roleLimits,c.commercial_snapshot AS commercial,c.commercial_hash AS commercialHash FROM sx_legacy_plan_contracts c JOIN sx_plan_versions v ON v.id=c.version_id WHERE c.legacy_plan_id=? ORDER BY v.version DESC LIMIT 100',[legacyPlanId]);
  return rows.map(row=>({...row,capabilities:parse(row.capabilities),roleLimits:parse(row.roleLimits),commercial:parse(row.commercial)}));
}
async function publish(db,ctx,input){
  authorize(ctx,'plans.publish');const legacyId=id(input?.legacyPlanId);if(!uuid(input.versionId))fail('INVALID_ID');
  if(!Number.isSafeInteger(input.revision)||input.revision<1)fail('INVALID_REVISION');
  return transaction(db,async()=>{
    const [[row]]=await db.query('SELECT * FROM plan WHERE id=? FOR UPDATE',[legacyId]);if(!row)fail('PLAN_NOT_FOUND');
    const [[version]]=await db.query('SELECT v.*,c.commercial_hash FROM sx_plan_versions v JOIN sx_legacy_plan_contracts c ON c.version_id=v.id WHERE v.id=? AND c.legacy_plan_id=? FOR UPDATE',[input.versionId,legacyId]);if(!version)fail('PLAN_NOT_FOUND');
    if(version.status!=='draft')fail('PUBLISHED_PLAN_IMMUTABLE');if(Number(version.revision)!==input.revision)fail('STALE_REVISION');
    if(hash(JSON.stringify(snapshot(row)))!==version.commercial_hash)fail('STALE_COMMERCIAL_CONTRACT');
    plans.definition({categoryKey:version.category_key,categoryVersion:version.category_version,capabilities:parse(version.capabilities),roleLimits:parse(version.role_limits)});
    await db.query("UPDATE sx_plan_versions SET status='published',revision=revision+1,published_at=UTC_TIMESTAMP(3) WHERE id=?",[input.versionId]);
    await audit(db,ctx,'legacy-plan.published',input.versionId,{legacyPlanId:legacyId,revision:input.revision+1});
    return {id:input.versionId,status:'published',revision:input.revision+1};
  });
}
module.exports={snapshot,createDraft,list,publish};
