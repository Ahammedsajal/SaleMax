'use strict';
const crypto=require('node:crypto');
const plans=require('./plans');
const assignment=require('./business-contract-assignment');
const legacy=require('./legacy-plan-assignment');
const catalogue=require('./catalogue-bridge');
const {normalize:normalizeLegacyPlan}=require('./legacy-plan-editor');
const {platformDecision}=require('./policy');
const {trainingCenter,salemaxSales,getCategory,categoryKeysFor,categoryKeyMatches,canonicalCategoryKey}=require('./categories');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hash=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const email=value=>{const normalized=typeof value==='string'?value.trim().toLowerCase():'';if(!normalized||normalized.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))fail('BUSINESS_EMAIL_INVALID');return normalized;};
const tables=['user','sx_tenants','sx_identities','sx_memberships','sx_legacy_ownership','sx_plan_versions','sx_plan_assignments','sx_legacy_plan_contracts','sx_legacy_plan_assignments','sx_legacy_contract_assignments','sx_team_invites','sx_audit_events','sx_business_provisions'];
async function transaction(db,fn){const [rows]=await db.query('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('+tables.map(()=>'?').join(',')+')',tables);if(rows.length!==tables.length||rows.some(row=>row.ENGINE!=='InnoDB'))fail('PROVISION_STORAGE_NOT_READY');await db.beginTransaction();try{const result=await fn();await db.commit();return result;}catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')fail('BUSINESS_ALREADY_PROVISIONED');throw error;}}
function authorize(ctx,permission){if(!platformDecision(ctx,permission))fail('PERMISSION_DENIED');}
function provisionCategory(ctx,key='training_center',version=1){
  const category=getCategory(key,version);
  if(!category||category.planable!==true)fail('CATEGORY_UNAVAILABLE');
  if(category.public===false&&!platformDecision(ctx,'categories.manage'))fail('PERMISSION_DENIED');
  return category;
}
function roles(value,category){return plans.limits(value,category.seatRoles);}
const activationDefaults=Object.freeze({owner:1,accountant:1,manager:1,team_leader:0,agent:7});
function defaultRoleCeiling(category){
  return roles(Object.fromEntries(category.seatRoles.map(role=>[role,role==='owner'?1:10000])),category);
}
function defaultRoleLimits(category,ceiling=null){
  const value=Object.fromEntries(category.seatRoles.map(role=>[role,Math.min(activationDefaults[role]||0,ceiling?Number(ceiling[role]||0):activationDefaults[role]||0)]));
  return roles(value,category);
}
function validateQuickRoleLimits(category,proposed,ceiling,legacyStaffCount=0){
  const selected=roles(proposed,category),maximum=roles(ceiling,category);
  for(const role of category.seatRoles)if(selected[role]>maximum[role])fail('PLAN_LIMIT_EXCEEDED');
  if(Number.isSafeInteger(selected.agent)&&Number(legacyStaffCount)>selected.agent)fail('SEATS_IN_USE');
  return selected;
}
function planSignature(value){
  let parsed=value;try{if(typeof parsed==='string')parsed=JSON.parse(parsed);}catch(_){fail('BUSINESS_PLAN_REQUIRED');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||!Number.isSafeInteger(Number(parsed.id))||Number(parsed.id)<1)fail('BUSINESS_PLAN_REQUIRED');
  const normalized=normalizeLegacyPlan(parsed);if(Object.keys(normalized.errors).length)fail('BUSINESS_PLAN_REQUIRED');
  return hash(JSON.stringify({id:Number(parsed.id),...normalized.value}));
}
function activeExpiry(value){const expiry=Number(value);if(!Number.isSafeInteger(expiry)||expiry<=Date.now()||!Number.isFinite(new Date(expiry).getTime()))fail('BUSINESS_PLAN_EXPIRED');return expiry;}
function normalizeName(value){const name=typeof value==='string'?value.trim():'';if(name.length<2||name.length>200)fail('BUSINESS_NAME_INVALID');return name;}
function slug(name,uid){const base=name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,52)||'salemax-business';return `${base}-${crypto.createHash('sha256').update(uid).digest('hex').slice(0,10)}`;}
async function adoptLegacyAgents(db,owner,tenantId){
  const [agents]=await db.query("SELECT id,uid,email,name,owner_uid,is_active,role FROM agents WHERE owner_uid=? AND role='agent' AND is_active=1 ORDER BY id FOR UPDATE",[owner.uid]);
  for(const agent of agents){
    if(typeof agent.uid!=='string'||!agent.uid||agent.owner_uid!==owner.uid)fail('LEGACY_STAFF_LINK_INVALID');
    const [sameUid]=await db.query('SELECT id FROM agents WHERE uid=? FOR UPDATE',[agent.uid]);if(sameUid.length!==1)fail('LEGACY_STAFF_LINK_INVALID');
    const [[mapping]]=await db.query("SELECT tenant_id,membership_id,legacy_uid_hash FROM sx_legacy_ownership WHERE source_table='agents' AND source_id=? FOR UPDATE",[String(agent.id)]);
    if(mapping){
      if(mapping.tenant_id!==tenantId||mapping.legacy_uid_hash!==hash(agent.uid))fail('LEGACY_STAFF_LINK_INVALID');
      const [[member]]=await db.query("SELECT id FROM sx_memberships WHERE id=? AND tenant_id=? AND role='agent' AND status='active' FOR UPDATE",[mapping.membership_id,tenantId]);
      if(!member)fail('LEGACY_STAFF_LINK_INVALID');
      continue;
    }
    const normalizedEmail=email(agent.email);
    const [[identity]]=await db.query('SELECT id FROM sx_identities WHERE email_normalized=? FOR UPDATE',[normalizedEmail]);
    if(identity)fail('LEGACY_STAFF_IDENTITY_EXISTS');
    const identityId=crypto.randomUUID(),membershipId=crypto.randomUUID();
    await db.query("INSERT INTO sx_identities(id,email_normalized,display_name,password_hash,status) VALUES (?,?,?,NULL,'active')",[identityId,normalizedEmail,String(agent.name||normalizedEmail).trim().slice(0,200)]);
    await db.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES (?,?,?,'agent','active')",[membershipId,tenantId,identityId]);
    await db.query("INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash,verified_at) VALUES ('agents',?,?,?,?,UTC_TIMESTAMP(3))",[String(agent.id),tenantId,membershipId,hash(agent.uid)]);
  }
  return agents.length;
}
async function context(db,ctx,userId,{locked=false,categoryKey='training_center',categoryVersion=1,allowMissingContract=false}={}){
  authorize(ctx,'tenants.create');authorize(ctx,'plans.assign');authorize(ctx,'plans.read');
  const category=provisionCategory(ctx,categoryKey,categoryVersion);
  if(!Number.isSafeInteger(userId)||userId<1||userId>2147483647)fail('INVALID_ASSIGNMENT');
  const suffix=locked?' FOR UPDATE':'';
  const [[user]]=await db.query('SELECT id,uid,name,email,plan,plan_expire FROM user WHERE id=?'+suffix,[userId]);
  if(!user||typeof user.uid!=='string'||!user.uid||user.uid!==user.uid.trim())fail('USER_NOT_FOUND');
  const [sameUid]=await db.query('SELECT id FROM user WHERE uid=?'+suffix,[user.uid]);if(sameUid.length!==1)fail('AMBIGUOUS_USER');
  const links=await db.query("SELECT tenant_id,membership_id FROM sx_legacy_ownership WHERE source_table='user' AND source_id=?"+suffix,[String(user.id)]);
  if(links[0].length)fail('BUSINESS_ALREADY_PROVISIONED');
  const current=legacy.summary(user.plan);if(!current.valid||!current.plan||!Number.isSafeInteger(Number(current.plan.id))||Number(current.plan.id)<1)fail('BUSINESS_PLAN_REQUIRED');
  const normalizedEmail=email(user.email);
  if(category.key===salemaxSales.key&&normalizedEmail!=='admin@salemax.qa')fail('DESIGNATED_OWNER_REQUIRED');
  const [[identity]]=await db.query('SELECT id FROM sx_identities WHERE email_normalized=?'+suffix,[normalizedEmail]);if(identity)fail('BUSINESS_IDENTITY_EXISTS');
  const categoryKeys=categoryKeysFor(category.key);
  const [[version]]=await db.query(`SELECT v.id,v.version,v.category_key AS categoryKey,v.category_version AS categoryVersion,v.capabilities,v.role_limits AS roleLimits,
      c.legacy_plan_id AS legacyPlanId,c.commercial_snapshot AS commercialSnapshot,c.commercial_hash AS commercialHash
    FROM sx_legacy_plan_contracts c JOIN sx_plan_versions v ON v.id=c.version_id
    WHERE c.legacy_plan_id=? AND v.status='published' AND v.category_key IN (${categoryKeys.map(()=>'?').join(',')}) AND v.category_version=?
    ORDER BY v.version DESC LIMIT 1${suffix}`,[Number(current.plan.id),...categoryKeys,category.version]);
  if(!version){
    if(!allowMissingContract)fail('PUBLISHED_CONTRACT_REQUIRED');
    const snapshot={id:user.id,uidHash:hash(user.uid),name:user.name,email:normalizedEmail,plan:current.plan,expiresAt:user.plan_expire};
    return {user,normalizedEmail,current,category,version:null,snapshot};
  }
  const ceiling=typeof version.roleLimits==='string'?JSON.parse(version.roleLimits):version.roleLimits;
  const capabilities=typeof version.capabilities==='string'?JSON.parse(version.capabilities):version.capabilities;
  const commercial=typeof version.commercialSnapshot==='string'?JSON.parse(version.commercialSnapshot):version.commercialSnapshot;
  const commercialText=typeof version.commercialSnapshot==='string'?version.commercialSnapshot:JSON.stringify(commercial);
  if(Number(commercial?.id)!==Number(current.plan.id)||hash(commercialText)!==version.commercialHash)fail('STORED_CONTRACT_INVALID');
  const snapshot={id:user.id,uidHash:hash(user.uid),name:user.name,email:normalizedEmail,plan:current.plan,expiresAt:user.plan_expire};
  return {user,normalizedEmail,current,category,version:{id:version.id,version:Number(version.version),categoryKey:canonicalCategoryKey(version.categoryKey),categoryVersion:Number(version.categoryVersion),roleLimits:ceiling,capabilities,commercial,commercialHash:version.commercialHash},snapshot};
}
function selection(ctx,input){
  const userId=Number(input?.userId);if(!Number.isSafeInteger(userId)||userId<1||userId>2147483647||!uuid(input?.planVersionId)||!uuid(input?.requestId)||typeof input?.expectedState!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedState))fail('INVALID_PROVISION');
  const businessName=normalizeName(input.businessName),category=provisionCategory(ctx,input.categoryKey||'training_center',input.categoryVersion===undefined?1:input.categoryVersion),roleLimits=roles(input.roleLimits,category);
  authorize(ctx,'tenants.create');authorize(ctx,'plans.assign');authorize(ctx,'plans.read');
  return {userId,planVersionId:input.planVersionId.toLowerCase(),requestId:input.requestId.toLowerCase(),expectedState:input.expectedState,businessName,roleLimits,category};
}
async function preview(db,ctx,input){
  const data=selection(ctx,{...input,expectedState:'0'.repeat(64)});const base=await context(db,ctx,data.userId,{categoryKey:data.category.key,categoryVersion:data.category.version});
  if(base.version.id!==data.planVersionId||!categoryKeyMatches(base.version.categoryKey,data.category.key))fail('CONTRACT_NOT_FOR_CURRENT_PLAN');
  const blockers=[];for(const role of Object.keys(data.roleLimits)){if(data.roleLimits[role]>base.version.roleLimits[role])blockers.push('PLAN_LIMIT_EXCEEDED:'+role);if(data.roleLimits[role]<(role==='owner'?1:0))blockers.push('SEATS_IN_USE:'+role);}
  const state=hash(JSON.stringify({snapshot:base.snapshot,categoryKey:data.category.key,categoryVersion:data.category.version,versionId:base.version.id,commercialHash:hash(JSON.stringify(base.version.commercial)),businessName:data.businessName,roleLimits:data.roleLimits}));
  return {user:{id:base.user.id,name:base.user.name,email:base.normalizedEmail,currentPlan:base.current.plan},businessName:data.businessName,category:{key:data.category.key,version:data.category.version,title:data.category.title,seatRoles:data.category.seatRoles},contract:{id:base.version.id,version:base.version.version,commercial:base.version.commercial,capabilities:base.version.capabilities,ceiling:base.version.roleLimits},proposedLimits:data.roleLimits,used:Object.fromEntries(data.category.seatRoles.map(role=>[role,role==='owner'?1:0])),blockers,canProvision:!blockers.length,expectedState:state,readOnly:true};
}
async function options(db,ctx,userId,categoryKey='training_center',categoryVersion=1){
  const base=await context(db,ctx,userId,{categoryKey,categoryVersion});
  return {user:{id:base.user.id,name:base.user.name,email:base.normalizedEmail,currentPlan:base.current.plan},category:{key:base.category.key,version:base.category.version,title:base.category.title,seatRoles:base.category.seatRoles},contract:{id:base.version.id,version:base.version.version,commercial:base.version.commercial,capabilities:base.version.capabilities,ceiling:base.version.roleLimits},defaultLimits:base.version.roleLimits};
}
async function quickOptions(db,ctx,userId,categoryKey='training_center',categoryVersion=1){
  const base=await context(db,ctx,userId,{categoryKey,categoryVersion,allowMissingContract:true});
  const expiry=activeExpiry(base.user.plan_expire),name=normalizeName(base.user.name),currentPlanHash=planSignature(base.user.plan);
  const [[cataloguePlan]]=await db.query('SELECT * FROM plan WHERE id=?',[Number(base.current.plan.id)]);
  if(!cataloguePlan)fail('BUSINESS_PLAN_REQUIRED');
  const cataloguePlanHash=planSignature(cataloguePlan);
  if(currentPlanHash!==cataloguePlanHash)fail('CURRENT_PLAN_SNAPSHOT_STALE');
  if(base.version&&planSignature(base.version.commercial)!==currentPlanHash)fail('CURRENT_PLAN_CONTRACT_STALE');
  const commercialHash=hash(JSON.stringify(catalogue.snapshot(cataloguePlan)));
  const roleCeiling=base.version?.roleLimits||defaultRoleCeiling(base.category);
  const roleLimits=defaultRoleLimits(base.category,roleCeiling);
  const [[staff]]=await db.query("SELECT COUNT(*) AS total FROM agents WHERE owner_uid=? AND role='agent' AND is_active=1",[base.user.uid]);
  const legacyStaffCount=Number(staff?.total||0);
  const profile={version:'category-default-v1',capabilities:base.category.capabilities,roleCeiling,roleLimits};
  const profileHash=hash(JSON.stringify(profile));
  const expectedState=hash(JSON.stringify({userId:base.user.id,uidHash:hash(base.user.uid),name,email:base.normalizedEmail,planHash:currentPlanHash,expiresAt:String(base.user.plan_expire),categoryKey:base.category.key,categoryVersion:base.category.version,contractId:base.version?.id||null,contractHash:base.version?.commercialHash||null,profileHash,roleCeiling,roleLimits,legacyStaffCount}));
  return {user:{id:base.user.id,name:base.user.name,email:base.normalizedEmail},category:{key:base.category.key,version:base.category.version,title:base.category.title,seatRoles:base.category.seatRoles},currentPlan:base.current.plan,planHash:currentPlanHash,expiresAt:expiry,contract:base.version?{id:base.version.id,version:base.version.version,commercial:base.version.commercial,capabilities:base.version.capabilities,ceiling:base.version.roleLimits}:null,defaultContractWillBePublished:!base.version,defaultLimits:roleLimits,roleCeiling,legacyStaffCount,capabilities:base.version?.capabilities||profile.capabilities,commercialHash,expectedState,readOnly:true};
}
function quickSelection(input){
  const userId=Number(input?.userId),requestId=input?.requestId,categoryKey=input?.categoryKey||'training_center',categoryVersion=input?.categoryVersion===undefined?1:input.categoryVersion;
  if(!Number.isSafeInteger(userId)||userId<1||userId>2147483647||!uuid(requestId)||!Number.isSafeInteger(categoryVersion)||categoryVersion<1||typeof categoryKey!=='string'||typeof input?.expectedState!=='string'||!/^[a-f0-9]{64}$/.test(input.expectedState))fail('INVALID_PROVISION');
  const category=getCategory(categoryKey,categoryVersion);if(!category||category.planable!==true||category.key===salemaxSales.key)fail('CATEGORY_UNAVAILABLE');
  const roleLimits=input?.roleLimits===undefined?null:roles(input.roleLimits,category);
  return {userId,requestId:requestId.toLowerCase(),category,expectedState:input.expectedState,roleLimits};
}
async function quickReplay(db,ctx,data,payloadHash){
  const [[prior]]=await db.query('SELECT request_id,user_id,tenant_id,actor_identity_id,payload_hash,assignment_id,role_limits FROM sx_business_provisions WHERE request_id=?',[data.requestId]);
  if(!prior)return null;
  if(Number(prior.user_id)!==data.userId||prior.actor_identity_id!==ctx.identity.id||prior.payload_hash!==payloadHash)fail('IDEMPOTENCY_CONFLICT');
  const [[staff]]=await db.query("SELECT COUNT(*) AS total FROM sx_legacy_ownership WHERE source_table='agents' AND tenant_id=?",[prior.tenant_id]);
  return {tenantId:prior.tenant_id,userId:data.userId,assignmentId:prior.assignment_id,roleLimits:typeof prior.role_limits==='string'?JSON.parse(prior.role_limits):prior.role_limits,staffAdopted:Number(staff?.total||0),replayed:true};
}
async function quickProvision(db,ctx,input){
  const data=quickSelection(input);authorize(ctx,'tenants.create');authorize(ctx,'plans.assign');authorize(ctx,'plans.read');
  // Keep legacy no-limit request hashes replayable; new requests bind every selected seat limit.
  const payloadHash=data.roleLimits
    ?hash(JSON.stringify({mode:'category-default-v2',userId:data.userId,categoryKey:data.category.key,categoryVersion:data.category.version,roleLimits:data.roleLimits}))
    :hash(JSON.stringify({mode:'category-default-v1',userId:data.userId,categoryKey:data.category.key,categoryVersion:data.category.version}));
  const replay=await quickReplay(db,ctx,data,payloadHash);if(replay)return replay;
  try{
    const prepared=await quickOptions(db,ctx,data.userId,data.category.key,data.category.version);
    if(prepared.expectedState!==data.expectedState)fail('STALE_PROVISION');
    const roleLimits=validateQuickRoleLimits(data.category,data.roleLimits||prepared.defaultLimits,prepared.roleCeiling||prepared.defaultLimits,Number(prepared.legacyStaffCount||0));
    if(prepared.defaultContractWillBePublished){
      await catalogue.ensureDefaultPublished(db,ctx,{legacyPlanId:Number(prepared.currentPlan.id),categoryKey:data.category.key,categoryVersion:data.category.version,capabilities:data.category.capabilities,roleLimits:defaultRoleCeiling(data.category),expectedCommercialHash:prepared.commercialHash});
    }
    const base=await context(db,ctx,data.userId,{categoryKey:data.category.key,categoryVersion:data.category.version});
    if(activeExpiry(base.user.plan_expire)!==prepared.expiresAt||planSignature(base.user.plan)!==prepared.planHash)fail('STALE_PROVISION');
    if(planSignature(base.version.commercial)!==prepared.planHash)fail('CURRENT_PLAN_CONTRACT_STALE');
    const businessName=normalizeName(base.user.name);
    const previewData=await preview(db,ctx,{userId:data.userId,categoryKey:data.category.key,categoryVersion:data.category.version,planVersionId:base.version.id,businessName,roleLimits,requestId:data.requestId});
    if(!previewData.canProvision)fail(previewData.blockers[0]?.split(':')[0]||'PROVISION_BLOCKED');
    return await provision(db,ctx,{userId:data.userId,categoryKey:data.category.key,categoryVersion:data.category.version,planVersionId:base.version.id,businessName,roleLimits,requestId:data.requestId,expectedState:previewData.expectedState},{preserveCurrentPeriod:true,payloadHashOverride:payloadHash,activationMode:'category-default'});
  }catch(error){
    if(error.code==='BUSINESS_ALREADY_PROVISIONED'){const completed=await quickReplay(db,ctx,data,payloadHash);if(completed)return completed;}
    throw error;
  }
}
async function provision(db,ctx,input,{preserveCurrentPeriod=false,payloadHashOverride=null,activationMode=null}={}){
  const data=selection(ctx,input),computedHash=hash(JSON.stringify({userId:data.userId,categoryKey:data.category.key,...(data.category.version===1?{}:{categoryVersion:data.category.version}),planVersionId:data.planVersionId,businessName:data.businessName,roleLimits:data.roleLimits,expectedState:data.expectedState}));
  if(payloadHashOverride!==null&&(!/^[a-f0-9]{64}$/.test(payloadHashOverride)))fail('INVALID_PROVISION');
  const payloadHash=payloadHashOverride||computedHash;
  return transaction(db,async()=>{
    const [[prior]]=await db.query('SELECT request_id,user_id,tenant_id,actor_identity_id,payload_hash,assignment_id,role_limits FROM sx_business_provisions WHERE request_id=? FOR UPDATE',[data.requestId]);
    if(prior){
      if(Number(prior.user_id)!==data.userId||prior.actor_identity_id!==ctx.identity.id||prior.payload_hash!==payloadHash)fail('IDEMPOTENCY_CONFLICT');
      let staffAdopted=0;if(activationMode==='category-default'){const [[staff]]=await db.query("SELECT COUNT(*) AS total FROM sx_legacy_ownership WHERE source_table='agents' AND tenant_id=?",[prior.tenant_id]);staffAdopted=Number(staff?.total||0);}
      return {tenantId:prior.tenant_id,userId:data.userId,assignmentId:prior.assignment_id,roleLimits:typeof prior.role_limits==='string'?JSON.parse(prior.role_limits):prior.role_limits,staffAdopted,replayed:true};
    }
    const base=await context(db,ctx,data.userId,{locked:true,categoryKey:data.category.key,categoryVersion:data.category.version});if(base.version.id!==data.planVersionId||!categoryKeyMatches(base.version.categoryKey,data.category.key))fail('CONTRACT_NOT_FOR_CURRENT_PLAN');
    if(preserveCurrentPeriod)activeExpiry(base.user.plan_expire);
    const currentState=hash(JSON.stringify({snapshot:base.snapshot,categoryKey:data.category.key,categoryVersion:data.category.version,versionId:base.version.id,commercialHash:hash(JSON.stringify(base.version.commercial)),businessName:data.businessName,roleLimits:data.roleLimits}));
    if(currentState!==data.expectedState)fail('STALE_PROVISION');
    for(const role of Object.keys(data.roleLimits)){if(data.roleLimits[role]>base.version.roleLimits[role])fail('PLAN_LIMIT_EXCEEDED');if(role==='owner'&&data.roleLimits[role]!==1)fail('ONE_OWNER_REQUIRED');}
    const tenantId=crypto.randomUUID(),identityId=crypto.randomUUID(),membershipId=crypto.randomUUID();
    const locale=data.category.key==='7network_sales'?{country:'IN',currency:'INR',timezone:'Asia/Kolkata'}:{country:'QA',currency:'QAR',timezone:'Asia/Qatar'};
    await db.query('INSERT INTO sx_tenants(id,slug,name,category_key,category_version,country_code,currency,timezone,status) VALUES (?,?,?,?,?,?,?,?,?)',[tenantId,slug(data.businessName,tenantId),data.businessName,data.category.key,data.category.version,locale.country,locale.currency,locale.timezone,'active']);
    await db.query("INSERT INTO sx_identities(id,email_normalized,display_name,password_hash,status) VALUES (?,?,?,NULL,'active')",[identityId,base.normalizedEmail,String(base.user.name||data.businessName).trim().slice(0,200)||data.businessName]);
    await db.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES (?,?,?,'owner','active')",[membershipId,tenantId,identityId]);
    await db.query("INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash,verified_at) VALUES ('user',?,?,?,?,UTC_TIMESTAMP(3))",[String(base.user.id),tenantId,membershipId,hash(base.user.uid)]);
    const staffAdopted=await adoptLegacyAgents(db,base.user,tenantId);
    const checked=await assignment.inspect(db,ctx,{userId:data.userId,planVersionId:data.planVersionId,roleLimits:data.roleLimits},{locked:true});
    if(checked.blockers.length)fail(checked.blockers[0].split(':')[0]);
    const assigned=await assignment.assignInTransaction(db,ctx,{userId:data.userId,planVersionId:data.planVersionId,roleLimits:data.roleLimits,requestId:data.requestId,expectedState:checked.token},{preserveCurrentPeriod});
    await plans.audit(db,ctx,'business.tenant-provisioned',tenantId,{legacyUserId:base.user.id,categoryKey:data.category.key,categoryVersion:data.category.version,planVersionId:data.planVersionId,assignmentId:assigned.id,activationMode:activationMode||'reviewed-contract',preservedCurrentPlan:preserveCurrentPeriod,legacyStaffAdopted:staffAdopted},tenantId);
    await db.query('INSERT INTO sx_business_provisions(request_id,user_id,tenant_id,actor_identity_id,payload_hash,assignment_id,role_limits) VALUES (?,?,?,?,?,?,?)',[data.requestId,data.userId,tenantId,ctx.identity.id,payloadHash,assigned.id,JSON.stringify(data.roleLimits)]);
    return {tenantId,userId:data.userId,assignmentId:assigned.id,roleLimits:data.roleLimits,staffAdopted,status:assigned.status,expiresAt:assigned.expiresAt,replayed:false};
  });
}
module.exports={context,options,quickOptions,quickProvision,quickSelection,validateQuickRoleLimits,preview,provision,selection,provisionCategory,defaultRoleLimits,defaultRoleCeiling};
