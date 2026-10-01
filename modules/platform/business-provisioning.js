'use strict';
const crypto=require('node:crypto');
const plans=require('./plans');
const assignment=require('./business-contract-assignment');
const legacy=require('./legacy-plan-assignment');
const {platformDecision}=require('./policy');
const {trainingCenter}=require('./categories');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hash=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const email=value=>{const normalized=typeof value==='string'?value.trim().toLowerCase():'';if(!normalized||normalized.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))fail('BUSINESS_EMAIL_INVALID');return normalized;};
const tables=['user','sx_tenants','sx_identities','sx_memberships','sx_legacy_ownership','sx_plan_versions','sx_plan_assignments','sx_legacy_plan_contracts','sx_legacy_plan_assignments','sx_legacy_contract_assignments','sx_team_invites','sx_audit_events','sx_business_provisions'];
async function transaction(db,fn){const [rows]=await db.query('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('+tables.map(()=>'?').join(',')+')',tables);if(rows.length!==tables.length||rows.some(row=>row.ENGINE!=='InnoDB'))fail('PROVISION_STORAGE_NOT_READY');await db.beginTransaction();try{const result=await fn();await db.commit();return result;}catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')fail('BUSINESS_ALREADY_PROVISIONED');throw error;}}
function authorize(ctx,permission){if(!platformDecision(ctx,permission))fail('PERMISSION_DENIED');}
function roles(value){return plans.limits(value);}
function normalizeName(value){const name=typeof value==='string'?value.trim():'';if(name.length<2||name.length>200)fail('BUSINESS_NAME_INVALID');return name;}
function slug(name,uid){const base=name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,52)||'training-center';return `${base}-${crypto.createHash('sha256').update(uid).digest('hex').slice(0,10)}`;}
async function context(db,ctx,userId,{locked=false}={}){
  authorize(ctx,'tenants.create');authorize(ctx,'plans.assign');authorize(ctx,'plans.read');
  if(!Number.isSafeInteger(userId)||userId<1||userId>2147483647)fail('INVALID_ASSIGNMENT');
  const suffix=locked?' FOR UPDATE':'';
  const [[user]]=await db.query('SELECT id,uid,name,email,plan,plan_expire FROM user WHERE id=?'+suffix,[userId]);
  if(!user||typeof user.uid!=='string'||!user.uid||user.uid!==user.uid.trim())fail('USER_NOT_FOUND');
  const [sameUid]=await db.query('SELECT id FROM user WHERE uid=?'+suffix,[user.uid]);if(sameUid.length!==1)fail('AMBIGUOUS_USER');
  const links=await db.query("SELECT tenant_id,membership_id FROM sx_legacy_ownership WHERE source_table='user' AND source_id=?"+suffix,[String(user.id)]);
  if(links[0].length)fail('BUSINESS_ALREADY_PROVISIONED');
  const current=legacy.summary(user.plan);if(!current.valid||!current.plan||!Number.isSafeInteger(Number(current.plan.id))||Number(current.plan.id)<1)fail('BUSINESS_PLAN_REQUIRED');
  const normalizedEmail=email(user.email);
  const [[identity]]=await db.query('SELECT id FROM sx_identities WHERE email_normalized=?'+suffix,[normalizedEmail]);if(identity)fail('BUSINESS_IDENTITY_EXISTS');
  const [[version]]=await db.query(`SELECT v.id,v.version,v.category_key AS categoryKey,v.category_version AS categoryVersion,v.capabilities,v.role_limits AS roleLimits,
      c.legacy_plan_id AS legacyPlanId,c.commercial_snapshot AS commercialSnapshot,c.commercial_hash AS commercialHash
    FROM sx_legacy_plan_contracts c JOIN sx_plan_versions v ON v.id=c.version_id
    WHERE c.legacy_plan_id=? AND v.status='published' AND v.category_key=? AND v.category_version=?
    ORDER BY v.version DESC LIMIT 1${suffix}`,[Number(current.plan.id),trainingCenter.key,trainingCenter.version]);
  if(!version)fail('PUBLISHED_CONTRACT_REQUIRED');
  const ceiling=typeof version.roleLimits==='string'?JSON.parse(version.roleLimits):version.roleLimits;
  const capabilities=typeof version.capabilities==='string'?JSON.parse(version.capabilities):version.capabilities;
  const commercial=typeof version.commercialSnapshot==='string'?JSON.parse(version.commercialSnapshot):version.commercialSnapshot;
  const commercialText=typeof version.commercialSnapshot==='string'?version.commercialSnapshot:JSON.stringify(commercial);
  if(Number(commercial?.id)!==Number(current.plan.id)||hash(commercialText)!==version.commercialHash)fail('STORED_CONTRACT_INVALID');
  const snapshot={id:user.id,uidHash:hash(user.uid),name:user.name,email:normalizedEmail,plan:current.plan,expiresAt:user.plan_expire};
  return {user,normalizedEmail,current,version:{id:version.id,version:Number(version.version),categoryKey:version.categoryKey,categoryVersion:Number(version.categoryVersion),roleLimits:ceiling,capabilities,commercial},snapshot};
}
function selection(ctx,input){
  const userId=Number(input?.userId);if(!Number.isSafeInteger(userId)||userId<1||userId>2147483647||!uuid(input?.planVersionId)||!uuid(input?.requestId)||typeof input?.expectedState!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedState))fail('INVALID_PROVISION');
  const businessName=normalizeName(input.businessName),roleLimits=roles(input.roleLimits);
  authorize(ctx,'tenants.create');authorize(ctx,'plans.assign');authorize(ctx,'plans.read');
  return {userId,planVersionId:input.planVersionId.toLowerCase(),requestId:input.requestId.toLowerCase(),expectedState:input.expectedState,businessName,roleLimits};
}
async function preview(db,ctx,input){
  const data=selection(ctx,{...input,expectedState:'0'.repeat(64)});const base=await context(db,ctx,data.userId);
  if(base.version.id!==data.planVersionId)fail('CONTRACT_NOT_FOR_CURRENT_PLAN');
  const blockers=[];for(const role of Object.keys(data.roleLimits)){if(data.roleLimits[role]>base.version.roleLimits[role])blockers.push('PLAN_LIMIT_EXCEEDED:'+role);if(data.roleLimits[role]<(role==='owner'?1:0))blockers.push('SEATS_IN_USE:'+role);}
  const state=hash(JSON.stringify({snapshot:base.snapshot,categoryKey:trainingCenter.key,categoryVersion:trainingCenter.version,versionId:base.version.id,commercialHash:hash(JSON.stringify(base.version.commercial)),businessName:data.businessName,roleLimits:data.roleLimits}));
  return {user:{id:base.user.id,name:base.user.name,email:base.normalizedEmail,currentPlan:base.current.plan},businessName:data.businessName,category:{key:trainingCenter.key,version:trainingCenter.version,title:trainingCenter.title},contract:{id:base.version.id,version:base.version.version,commercial:base.version.commercial,capabilities:base.version.capabilities,ceiling:base.version.roleLimits},proposedLimits:data.roleLimits,used:{owner:1,accountant:0,manager:0,agent:0},blockers,canProvision:!blockers.length,expectedState:state,readOnly:true};
}
async function options(db,ctx,userId){
  const base=await context(db,ctx,userId);
  return {user:{id:base.user.id,name:base.user.name,email:base.normalizedEmail,currentPlan:base.current.plan},category:{key:trainingCenter.key,version:trainingCenter.version,title:trainingCenter.title},contract:{id:base.version.id,version:base.version.version,commercial:base.version.commercial,capabilities:base.version.capabilities,ceiling:base.version.roleLimits},defaultLimits:base.version.roleLimits};
}
async function provision(db,ctx,input){
  const data=selection(ctx,input),payloadHash=hash(JSON.stringify({userId:data.userId,planVersionId:data.planVersionId,businessName:data.businessName,roleLimits:data.roleLimits,expectedState:data.expectedState}));
  return transaction(db,async()=>{
    const [[prior]]=await db.query('SELECT request_id,user_id,tenant_id,actor_identity_id,payload_hash,assignment_id,role_limits FROM sx_business_provisions WHERE request_id=? FOR UPDATE',[data.requestId]);
    if(prior){if(Number(prior.user_id)!==data.userId||prior.actor_identity_id!==ctx.identity.id||prior.payload_hash!==payloadHash)fail('IDEMPOTENCY_CONFLICT');return {tenantId:prior.tenant_id,userId:data.userId,assignmentId:prior.assignment_id,roleLimits:typeof prior.role_limits==='string'?JSON.parse(prior.role_limits):prior.role_limits,replayed:true};}
    const base=await context(db,ctx,data.userId,{locked:true});if(base.version.id!==data.planVersionId)fail('CONTRACT_NOT_FOR_CURRENT_PLAN');
    const currentState=hash(JSON.stringify({snapshot:base.snapshot,categoryKey:trainingCenter.key,categoryVersion:trainingCenter.version,versionId:base.version.id,commercialHash:hash(JSON.stringify(base.version.commercial)),businessName:data.businessName,roleLimits:data.roleLimits}));
    if(currentState!==data.expectedState)fail('STALE_PROVISION');
    for(const role of Object.keys(data.roleLimits)){if(data.roleLimits[role]>base.version.roleLimits[role])fail('PLAN_LIMIT_EXCEEDED');if(role==='owner'&&data.roleLimits[role]!==1)fail('ONE_OWNER_REQUIRED');}
    const tenantId=crypto.randomUUID(),identityId=crypto.randomUUID(),membershipId=crypto.randomUUID();
    await db.query("INSERT INTO sx_tenants(id,slug,name,category_key,category_version,country_code,currency,timezone,status) VALUES (?,?,?,?,?,'QA','QAR','Asia/Qatar','active')",[tenantId,slug(data.businessName,tenantId),data.businessName,trainingCenter.key,trainingCenter.version]);
    await db.query("INSERT INTO sx_identities(id,email_normalized,display_name,password_hash,status) VALUES (?,?,?,NULL,'active')",[identityId,base.normalizedEmail,String(base.user.name||data.businessName).trim().slice(0,200)||data.businessName]);
    await db.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES (?,?,?,'owner','active')",[membershipId,tenantId,identityId]);
    await db.query("INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash,verified_at) VALUES ('user',?,?,?,?,UTC_TIMESTAMP(3))",[String(base.user.id),tenantId,membershipId,hash(base.user.uid)]);
    const checked=await assignment.inspect(db,ctx,{userId:data.userId,planVersionId:data.planVersionId,roleLimits:data.roleLimits},{locked:true});
    if(checked.blockers.length)fail(checked.blockers[0].split(':')[0]);
    const assigned=await assignment.assignInTransaction(db,ctx,{userId:data.userId,planVersionId:data.planVersionId,roleLimits:data.roleLimits,requestId:data.requestId,expectedState:checked.token});
    await plans.audit(db,ctx,'business.tenant-provisioned',tenantId,{legacyUserId:base.user.id,categoryKey:trainingCenter.key,categoryVersion:trainingCenter.version,planVersionId:data.planVersionId,assignmentId:assigned.id},tenantId);
    await db.query('INSERT INTO sx_business_provisions(request_id,user_id,tenant_id,actor_identity_id,payload_hash,assignment_id,role_limits) VALUES (?,?,?,?,?,?,?)',[data.requestId,data.userId,tenantId,ctx.identity.id,payloadHash,assigned.id,JSON.stringify(data.roleLimits)]);
    return {tenantId,userId:data.userId,assignmentId:assigned.id,roleLimits:data.roleLimits,status:assigned.status,expiresAt:assigned.expiresAt,replayed:false};
  });
}
module.exports={context,options,preview,provision};
