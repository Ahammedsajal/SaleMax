'use strict';

const crypto=require('node:crypto');
const plans=require('./plans');
const {platformDecision}=require('./policy');
const {getCategory,categoryKeysFor,categoryKeyMatches}=require('./categories');
const normalize=require('./legacy-plan-editor').normalize;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const json=value=>{try{return typeof value==='string'?JSON.parse(value):value;}catch(_){fail('INVALID_STORED_CONTRACT');}};
const tables=['user','sx_tenants','sx_identities','sx_memberships','sx_legacy_ownership','sx_plan_versions','sx_legacy_plan_contracts','sx_plan_assignments','sx_legacy_plan_assignments','sx_legacy_contract_assignments','sx_team_invites','sx_audit_events'];

function authorize(ctx,category){
  if(!platformDecision(ctx,'tenants.category-change')||!platformDecision(ctx,'plans.read')||!uuid(ctx?.identity?.id))fail('PERMISSION_DENIED');
  if(category?.public===false&&!platformDecision(ctx,'categories.manage'))fail('PERMISSION_DENIED');
}
function input(ctx,body,confirm=false){
  if(!body||!Number.isSafeInteger(body.userId)||body.userId<1||body.userId>2147483647)fail('INVALID_ASSIGNMENT');
  if(typeof body.categoryKey!=='string'||!Number.isSafeInteger(body.categoryVersion)||body.categoryVersion<1)fail('INVALID_CATEGORY');
  const category=getCategory(body.categoryKey,body.categoryVersion);if(!category?.planable)fail('CATEGORY_UNAVAILABLE');authorize(ctx,category);
  const data={userId:body.userId,category,categoryKey:category.key,categoryVersion:category.version};
  if(confirm){
    if(!uuid(body.requestId))fail('INVALID_REQUEST_ID');
    if(typeof body.expectedState!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedState))fail('INVALID_EXPECTED_STATE');
    data.requestId=body.requestId.toLowerCase();data.expectedState=body.expectedState;
  }
  return data;
}
async function transaction(db,fn){
  const [rows]=await db.query('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('+tables.map(()=>'?').join(',')+')',tables);
  if(rows.length!==tables.length||rows.some(row=>row.ENGINE!=='InnoDB'))fail('CATEGORY_CHANGE_STORAGE_NOT_READY');
  await db.beginTransaction();try{const result=await fn();await db.commit();return result;}catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')fail('IDEMPOTENCY_CONFLICT');throw error;}
}
async function load(db,ctx,data,locked=false){
  const suffix=locked?' FOR UPDATE':'';
  const [[user]]=await db.query('SELECT id,uid,name,plan,plan_expire FROM user WHERE id=?'+suffix,[data.userId]);
  if(!user||typeof user.uid!=='string'||!user.uid||user.uid!==user.uid.trim()||user.uid.length>999)fail('USER_NOT_FOUND');
  const [sameUid]=await db.query('SELECT id,uid FROM user WHERE uid=?'+suffix,[user.uid]);if(sameUid.length!==1||sameUid[0].uid!==user.uid)fail('AMBIGUOUS_USER');
  const [[mapping]]=await db.query("SELECT tenant_id,membership_id,legacy_uid_hash,verified_at FROM sx_legacy_ownership WHERE source_table='user' AND source_id=?"+suffix,[String(user.id)]);
  if(!mapping||!mapping.membership_id||mapping.legacy_uid_hash!==hash(user.uid))fail('VERIFIED_BUSINESS_LINK_REQUIRED');
  const [[tenant]]=await db.query('SELECT id,name,status,category_key,category_version,country_code,currency,timezone,revision FROM sx_tenants WHERE id=?'+suffix,[mapping.tenant_id]);
  if(!tenant||tenant.id!==mapping.tenant_id)fail('VERIFIED_BUSINESS_LINK_REQUIRED');
  const [owners]=await db.query("SELECT o.source_id FROM sx_legacy_ownership o JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id AND m.role='owner' AND m.status='active' WHERE o.source_table='user' AND o.tenant_id=?"+suffix,[tenant.id]);
  if(owners.length!==1||owners[0].source_id!==String(user.id))fail('AMBIGUOUS_BUSINESS_LINK');
  const [[owner]]=await db.query("SELECT m.id,m.identity_id FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id WHERE m.id=? AND m.tenant_id=? AND m.role='owner' AND m.status='active' AND i.status='active'"+suffix,[mapping.membership_id,tenant.id]);
  if(!owner)fail('VERIFIED_BUSINESS_LINK_REQUIRED');
  const [[current]]=await db.query(`SELECT a.id,a.status,a.role_limits,DATE_FORMAT(a.effective_from,'%Y-%m-%d %H:%i:%s.%f') AS effective_from,DATE_FORMAT(a.expires_at,'%Y-%m-%d %H:%i:%s.%f') AS expires_at,v.id AS version_id,v.version,v.category_key,v.category_version,v.capabilities,c.legacy_plan_id,c.commercial_snapshot,h.plan_id AS assigned_plan_id,h.assigned_snapshot,h.assigned_expiry
    FROM sx_plan_assignments a JOIN sx_plan_versions v ON v.id=a.plan_version_id JOIN sx_legacy_plan_contracts c ON c.version_id=v.id
    LEFT JOIN sx_legacy_contract_assignments r ON r.assignment_id=a.id LEFT JOIN sx_legacy_plan_assignments h ON h.id=r.legacy_assignment_id
    WHERE a.tenant_id=? AND a.current_tenant IS NOT NULL${suffix}`,[tenant.id]);
  if(!current)fail('ACTIVE_CONTRACT_REQUIRED');
  const currentCategory=getCategory(tenant.category_key,Number(tenant.category_version));
  if(!currentCategory||!categoryKeyMatches(current.category_key,tenant.category_key)||Number(current.category_version)!==Number(tenant.category_version))fail('CURRENT_CONTRACT_MISMATCH');
  const currentDefinition=plans.definition({categoryKey:current.category_key,categoryVersion:Number(current.category_version),capabilities:json(current.capabilities),roleLimits:json(current.role_limits)});
  const roleLimits=currentDefinition.roleLimits;
  // Assignment history records the plan terms that were actually given for
  // this paid period. A different target-category price must not rewrite it.
  const assignedCommercial=current.assigned_snapshot==null?null:json(current.assigned_snapshot);
  const currentCommercial=assignedCommercial||json(current.commercial_snapshot),legacySnapshot=json(user.plan),targetKeys=categoryKeysFor(data.categoryKey);
  const [versions]=await db.query(`SELECT v.id,v.version,v.category_key,v.category_version,v.role_limits,v.capabilities,c.legacy_plan_id,c.commercial_snapshot
    FROM sx_plan_versions v JOIN sx_legacy_plan_contracts c ON c.version_id=v.id
    WHERE v.status='published' AND v.category_key IN (${targetKeys.map(()=>'?').join(',')}) AND v.category_version=? AND c.legacy_plan_id=?
    ORDER BY CASE WHEN v.category_key=? THEN 0 ELSE 1 END,v.version DESC LIMIT 20`,[...targetKeys,data.categoryVersion,current.legacy_plan_id,data.categoryKey]);
  const blockers=[];
  if(tenant.status!=='active')blockers.push('ACCOUNT_INACTIVE');
  if(!['active','trial','grace'].includes(current.status))blockers.push('ACTIVE_CONTRACT_REQUIRED');
  if(!legacySnapshot||typeof legacySnapshot!=='object'||Array.isArray(legacySnapshot)||Number(legacySnapshot.id)!==Number(current.legacy_plan_id)||Number(currentCommercial.id)!==Number(current.legacy_plan_id)||(assignedCommercial&&Number(current.assigned_plan_id)!==Number(current.legacy_plan_id)))blockers.push('LEGACY_PLAN_MISMATCH');
  else if(['id','title','price','price_strike','plan_duration_in_days','is_trial'].some(key=>String(legacySnapshot[key]??'')!==String(currentCommercial[key]??'')))blockers.push('LEGACY_PLAN_MISMATCH');
  if(assignedCommercial&&Number(current.assigned_expiry)!==Number(user.plan_expire))blockers.push('LEGACY_PLAN_MISMATCH');
  if(!Number.isSafeInteger(Number(user.plan_expire))||Number(user.plan_expire)<1)blockers.push('LEGACY_EXPIRY_INVALID');
  if(categoryKeyMatches(tenant.category_key,data.categoryKey)&&Number(tenant.category_version)===data.categoryVersion)blockers.push('CATEGORY_UNCHANGED');
  const targetVersion=versions[0]||null;
  let contract=null,targetCommercial=null,targetLimits=null,capabilities=[],targetTermsMatch=false;
  if(!targetVersion)blockers.push('MATCHING_CONTRACT_REQUIRED');
  else{
    targetCommercial=json(targetVersion.commercial_snapshot);
    const targetCategory=getCategory(targetVersion.category_key,Number(targetVersion.category_version));
    contract=plans.definition({categoryKey:targetVersion.category_key,categoryVersion:Number(targetVersion.category_version),capabilities:json(targetVersion.capabilities),roleLimits:json(targetVersion.role_limits)});
    if(!categoryKeyMatches(targetVersion.category_key,data.categoryKey)||Number(targetVersion.category_version)!==data.categoryVersion||!targetCategory)blockers.push('CATEGORY_UNAVAILABLE');
    const currentNormalized=normalize(currentCommercial),targetNormalized=normalize(targetCommercial);
    if(Object.keys(currentNormalized.errors).length||Object.keys(targetNormalized.errors).length||Number(targetVersion.legacy_plan_id)!==Number(current.legacy_plan_id)||Number(targetCommercial.id)!==Number(current.legacy_plan_id))blockers.push('STORED_CONTRACT_INVALID');
    else targetTermsMatch=['id','price','price_strike','plan_duration_in_days','is_trial'].every(key=>String(currentCommercial[key]??'')===String(targetCommercial[key]??''));
    targetLimits=contract.roleLimits;
    capabilities=contract.capabilities;
  }
  const [members]=await db.query("SELECT role,COUNT(*) AS n FROM sx_memberships WHERE tenant_id=? AND status='active' GROUP BY role",[tenant.id]);
  const [invites]=await db.query("SELECT role,COUNT(*) AS n FROM sx_team_invites WHERE tenant_id=? AND status='pending' AND expires_at>UTC_TIMESTAMP(3) GROUP BY role",[tenant.id]);
  const usage=Object.fromEntries(data.category.seatRoles.map(role=>[role,0]));
  const unsupported=[];
  for(const row of [...members,...invites]){const n=Number(row.n);if(Object.hasOwn(usage,row.role))usage[row.role]+=n;else if(row.role!=='owner'||n!==1)unsupported.push({role:row.role,count:n});}
  if(unsupported.length)blockers.push('UNSUPPORTED_ACTIVE_ROLES');
  if(targetLimits){
    const proposed={};
    for(const role of data.category.seatRoles){
      proposed[role]=role==='owner'?1:Math.min(roleLimits[role]??0,targetLimits[role]??0);
      if(proposed[role]>targetLimits[role])blockers.push('PLAN_LIMIT_EXCEEDED:'+role);
      if(proposed[role]<usage[role])blockers.push('SEATS_IN_USE:'+role);
    }
    if(data.category.seatRoles.filter(role=>role==='owner').length!==1)blockers.push('ONE_OWNER_REQUIRED');
    const oldCaps=currentDefinition.capabilities,newCaps=capabilities;
    const state=hash(JSON.stringify({user:{id:user.id,uid:user.uid,plan:user.plan==null?null:String(user.plan),planExpire:user.plan_expire==null?null:String(user.plan_expire)},mapping,tenant,current:{...current,commercial_snapshot:currentCommercial},members,invites,targetVersionId:targetVersion.id,targetRoleLimits:targetLimits,proposed}));
    return {user,tenant,mapping,current,currentCategory,targetVersion,targetCategory:data.category,currentCommercial,targetCommercial,targetTermsMatch,targetLimits,roleLimits,proposed,usage,unsupported,oldCapabilities:oldCaps,newCapabilities:newCaps,addedCapabilities:newCaps.filter(cap=>!oldCaps.includes(cap)),removedCapabilities:oldCaps.filter(cap=>!newCaps.includes(cap)),blockers,state};
  }
  const state=hash(JSON.stringify({user:{id:user.id,uid:user.uid,plan:user.plan==null?null:String(user.plan),planExpire:user.plan_expire==null?null:String(user.plan_expire)},mapping,tenant,current:{...current,commercial_snapshot:currentCommercial},members,invites,targetCategory:data.category}));
  return {user,tenant,mapping,current,currentCategory,targetCategory:data.category,currentCommercial,targetCommercial:null,targetVersion:null,targetLimits:null,proposed:null,usage,unsupported,oldCapabilities:json(current.capabilities),newCapabilities:[],addedCapabilities:[],removedCapabilities:[],blockers,state};
}
function resultView(data){
  const {user,tenant,current,currentCategory,targetCategory,targetVersion,currentCommercial,targetCommercial,targetTermsMatch,targetLimits,proposed,usage,addedCapabilities,removedCapabilities,blockers,state}=data;
  return {userId:user.id,tenantId:tenant.id,businessName:tenant.name,currentCategory:{key:currentCategory.key,version:currentCategory.version,title:currentCategory.title},targetCategory:{key:targetCategory.key,version:targetCategory.version,title:targetCategory.title},currentPlan:currentCommercial.title,targetPlan:targetCommercial?.title||null,currentPrice:currentCommercial.price,targetPrice:targetCommercial?.price??null,currentDurationDays:Number(currentCommercial.plan_duration_in_days),targetDurationDays:targetCommercial?Number(targetCommercial.plan_duration_in_days):null,targetTermsMatch,currency:tenant.currency,expiresAt:user.plan_expire,locale:{countryCode:tenant.country_code,currency:tenant.currency,timezone:tenant.timezone},planVersionId:targetVersion?.id||null,planVersion:targetVersion?.version??null,roleLimits:proposed,ceiling:targetLimits,used:usage,addedCapabilities,removedCapabilities,blockers,canChange:blockers.length===0,expectedState:state,expiresAtPreserved:true,currentPlanTermsPreserved:true,accountAndWorkspacePreserved:true,dataPreserved:true,readOnly:true};
}
async function preview(db,ctx,body){
  const data=input(ctx,body);return transaction(db,async()=>resultView(await load(db,ctx,data,false)));
}
async function change(db,ctx,body){
  const data=input(ctx,body,true),payloadHash=hash(JSON.stringify({userId:data.userId,categoryKey:data.categoryKey,categoryVersion:data.categoryVersion,expectedState:data.expectedState}));
  return transaction(db,async()=>{
    const [[prior]]=await db.query('SELECT r.*,a.plan_version_id,a.role_limits,a.status,h.assigned_expiry FROM sx_legacy_contract_assignments r JOIN sx_plan_assignments a ON a.id=r.assignment_id JOIN sx_legacy_plan_assignments h ON h.id=r.legacy_assignment_id WHERE r.request_id=? FOR UPDATE',[data.requestId]);
    if(prior){if(Number(prior.legacy_user_id)!==data.userId||prior.actor_identity_id!==ctx.identity.id||prior.payload_hash!==payloadHash)fail('IDEMPOTENCY_CONFLICT');return {id:prior.assignment_id,tenantId:prior.tenant_id,planVersionId:prior.plan_version_id,roleLimits:json(prior.role_limits),status:prior.status,expiresAt:Number(prior.assigned_expiry),replayed:true};}
    const loaded=await load(db,ctx,data,true);
    if(data.expectedState!==loaded.state)fail('STALE_CATEGORY_CHANGE');
    if(loaded.blockers.length)fail(loaded.blockers[0].split(':')[0]);
    // Expire stale invitations only after the reviewed state is confirmed.
    await db.query("UPDATE sx_team_invites SET status='expired' WHERE tenant_id=? AND status='pending' AND expires_at<=UTC_TIMESTAMP(3)",[loaded.tenant.id]);
    const id=crypto.randomUUID(),historyId=crypto.randomUUID(),snapshot=JSON.stringify(loaded.currentCommercial);
    await db.query("UPDATE sx_plan_assignments SET status='superseded' WHERE id=? AND current_tenant IS NOT NULL",[loaded.current.id]);
    const [assigned]=await db.query('INSERT INTO sx_plan_assignments(id,tenant_id,plan_version_id,role_limits,status,effective_from,expires_at) VALUES (?,?,?,?,?,?,?)',[id,loaded.tenant.id,loaded.targetVersion.id,JSON.stringify(loaded.proposed),loaded.current.status,loaded.current.effective_from,loaded.current.expires_at]);
    if(assigned.affectedRows!==1)fail('CATEGORY_CHANGE_WRITE_FAILED');
    await db.query('INSERT INTO sx_legacy_plan_assignments(id,request_id,owner_uid,owner_uid_hash,actor_uid,plan_id,previous_snapshot,previous_expiry,assigned_snapshot,assigned_expiry) VALUES (?,?,?,?,?,?,?,?,?,?)',[historyId,data.requestId,loaded.user.uid,hash(loaded.user.uid),ctx.identity.id,loaded.current.legacy_plan_id,loaded.user.plan,loaded.user.plan_expire,snapshot,Number(loaded.user.plan_expire)]);
    const [tenantUpdate]=await db.query('UPDATE sx_tenants SET category_key=?,category_version=?,revision=revision+1 WHERE id=? AND revision=?',[data.categoryKey,data.categoryVersion,loaded.tenant.id,loaded.tenant.revision]);
    if(tenantUpdate.affectedRows!==1)fail('STALE_CATEGORY_CHANGE');
    await db.query('INSERT INTO sx_legacy_contract_assignments(request_id,legacy_user_id,tenant_id,actor_identity_id,payload_hash,assignment_id,legacy_assignment_id) VALUES (?,?,?,?,?,?,?)',[data.requestId,loaded.user.id,loaded.tenant.id,ctx.identity.id,payloadHash,id,historyId]);
    const changes={from:{categoryKey:loaded.tenant.category_key,categoryVersion:Number(loaded.tenant.category_version),planVersionId:loaded.current.version_id},to:{categoryKey:data.categoryKey,categoryVersion:data.categoryVersion,planVersionId:loaded.targetVersion.id,roleLimits:loaded.proposed},legacyPlanId:Number(loaded.current.legacy_plan_id),currentPlanTermsPreserved:true,termsMatchTargetContract:loaded.targetTermsMatch,currentPrice:loaded.currentCommercial.price,currentDurationDays:Number(loaded.currentCommercial.plan_duration_in_days),targetContractPrice:loaded.targetCommercial.price,targetContractDurationDays:Number(loaded.targetCommercial.plan_duration_in_days),currency:loaded.tenant.currency,expiryPreserved:true,localePreserved:true};
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','business.category-changed','business-account',?,?,?)`,[crypto.randomUUID(),loaded.tenant.id,ctx.identity.id,loaded.tenant.id,JSON.stringify(changes),crypto.randomUUID()]);
    return {id,tenantId:loaded.tenant.id,planVersionId:loaded.targetVersion.id,roleLimits:loaded.proposed,status:loaded.current.status,expiresAt:Number(loaded.user.plan_expire),replayed:false};
  });
}
module.exports={preview,change,load,resultView};
