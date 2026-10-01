'use strict';
const crypto=require('node:crypto');
const plans=require('./plans');
const legacy=require('./legacy-plan-assignment');
const {platformDecision}=require('./policy');
const {normalize}=require('./legacy-plan-editor');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function parse(value){try{return typeof value==='string'?JSON.parse(value):value;}catch(_){fail('INVALID_STORED_CONTRACT');}}
function input(ctx,body,confirm=false){
  if(!platformDecision(ctx,confirm?'plans.assign':'plans.read')||!uuid(ctx.identity?.id))fail('PERMISSION_DENIED');
  if(!body||!Number.isSafeInteger(body.userId)||body.userId<1||body.userId>2147483647||!uuid(body.planVersionId))fail('INVALID_ASSIGNMENT');
  const result={userId:body.userId,planVersionId:body.planVersionId.toLowerCase(),roleLimits:plans.limits(body.roleLimits)};
  if(confirm){
    if(!uuid(body.requestId))fail('INVALID_REQUEST_ID');
    if(typeof body.expectedState!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedState))fail('INVALID_EXPECTED_STATE');
    result.requestId=body.requestId.toLowerCase();result.expectedState=body.expectedState;
  }
  return result;
}
const tables=['user','sx_legacy_ownership','sx_tenants','sx_memberships','sx_identities','sx_plan_versions','sx_plan_assignments','sx_legacy_plan_contracts','sx_legacy_plan_assignments','sx_legacy_contract_assignments','sx_team_invites','sx_audit_events'];
async function transaction(db,fn){
  const [rows]=await db.query('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('+tables.map(()=>'?').join(',')+')',tables);
  if(rows.length!==tables.length||rows.some(row=>row.ENGINE!=='InnoDB'))fail('ASSIGNMENT_STORAGE_NOT_READY');
  await db.beginTransaction();try{const result=await fn();await db.commit();return result;}catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY')fail('IDEMPOTENCY_CONFLICT');throw error;}
}
async function userRow(db,userId,locked){
  const suffix=locked?' FOR UPDATE':'';
  const [[user]]=await db.query('SELECT id,uid,name,plan,plan_expire FROM user WHERE id=?'+suffix,[userId]);
  if(!user||typeof user.uid!=='string'||!user.uid||user.uid!==user.uid.trim()||user.uid.length>999)fail('USER_NOT_FOUND');
  const [matches]=await db.query('SELECT id,uid FROM user WHERE uid=?'+suffix,[user.uid]);
  if(matches.length!==1||matches[0].uid!==user.uid)fail('AMBIGUOUS_USER');return user;
}
async function load(db,user,data,locked){
  const suffix=locked?' FOR UPDATE':'';
  const [[mapping]]=await db.query("SELECT tenant_id,membership_id,legacy_uid_hash FROM sx_legacy_ownership WHERE source_table='user' AND source_id=?"+suffix,[String(user.id)]);
  if(!mapping||!mapping.membership_id||mapping.legacy_uid_hash!==hash(user.uid))fail('VERIFIED_BUSINESS_LINK_REQUIRED');
  // Current reads precede the tenant lock so a confirmation cannot establish
  // an old repeatable-read snapshot before waiting for another seat mutation.
  const [[tenant]]=await db.query('SELECT id,name,status,category_key,category_version,revision FROM sx_tenants WHERE id=?'+suffix,[mapping.tenant_id]);
  if(!tenant)fail('VERIFIED_BUSINESS_LINK_REQUIRED');
  const [links]=await db.query("SELECT source_id FROM sx_legacy_ownership WHERE source_table='user' AND tenant_id=?"+suffix,[tenant.id]);
  if(links.length!==1||links[0].source_id!==String(user.id))fail('AMBIGUOUS_BUSINESS_LINK');
  const [[owner]]=await db.query("SELECT m.id,m.identity_id FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id WHERE m.id=? AND m.tenant_id=? AND m.role='owner' AND m.status='active' AND i.status='active'"+suffix,[mapping.membership_id,tenant.id]);
  if(!owner)fail('VERIFIED_BUSINESS_LINK_REQUIRED');
  const [[version]]=await db.query('SELECT v.*,c.legacy_plan_id,c.commercial_snapshot FROM sx_plan_versions v JOIN sx_legacy_plan_contracts c ON c.version_id=v.id WHERE v.id=?'+suffix,[data.planVersionId]);
  if(!version||version.status!=='published')fail('PUBLISHED_PLAN_REQUIRED');
  const contract=plans.definition({categoryKey:version.category_key,categoryVersion:version.category_version,capabilities:parse(version.capabilities),roleLimits:parse(version.role_limits)});
  const commercial=parse(version.commercial_snapshot),days=Number(commercial?.plan_duration_in_days);
  if(!commercial||commercial.id!==Number(version.legacy_plan_id)||Object.keys(normalize(commercial).errors).length||!Number.isSafeInteger(days)||days<1||days>3650)fail('INVALID_STORED_CONTRACT');
  const [[current]]=await db.query("SELECT id,plan_version_id,status,role_limits,DATE_FORMAT(expires_at,'%Y-%m-%d %H:%i:%s.%f') AS expires_at FROM sx_plan_assignments WHERE tenant_id=? AND current_tenant IS NOT NULL"+suffix,[tenant.id]);
  const used=await plans.readUsage(db,tenant.id),blockers=[];
  if(tenant.status!=='active')blockers.push('ACCOUNT_INACTIVE');
  if(tenant.category_key!==contract.categoryKey||tenant.category_version!==contract.categoryVersion)blockers.push('CATEGORY_UNAVAILABLE');
  for(const role of Object.keys(contract.roleLimits)){
    if(data.roleLimits[role]>contract.roleLimits[role])blockers.push('PLAN_LIMIT_EXCEEDED:'+role);
    if(data.roleLimits[role]<used[role])blockers.push('SEATS_IN_USE:'+role);
  }
  const currentEntitlement=await plans.loadEntitlements(db,tenant.id);
  const token=hash(JSON.stringify({legacyState:legacy.state(user),mapping,tenant,owner,current,used,versionId:version.id,contract,commercial,proposed:data.roleLimits}));
  return {user,tenant,version,contract,commercial,days,used,blockers,currentEntitlement,token};
}
async function preview(db,ctx,body){
  const data=input(ctx,body);
  return transaction(db,async()=>{
    const loaded=await load(db,await userRow(db,data.userId,false),data,false);
    return {userId:data.userId,tenantId:loaded.tenant.id,businessName:loaded.tenant.name,planVersionId:data.planVersionId,version:loaded.version.version,
      categoryKey:loaded.contract.categoryKey,categoryVersion:loaded.contract.categoryVersion,commercial:loaded.commercial,durationDays:loaded.days,
      current:legacy.summary(loaded.user.plan),currentExpiresAt:loaded.user.plan_expire,currentLimits:loaded.currentEntitlement?.roleLimits||null,
      ceiling:loaded.contract.roleLimits,proposedLimits:data.roleLimits,used:loaded.used,
      addedCapabilities:loaded.contract.capabilities.filter(key=>!loaded.currentEntitlement?.capabilities.includes(key)),
      removedCapabilities:(loaded.currentEntitlement?.capabilities||[]).filter(key=>!loaded.contract.capabilities.includes(key)),
      blockers:loaded.blockers,canAssign:loaded.blockers.length===0,expectedState:loaded.token,expiryStartsAt:'confirmation',readOnly:true};
  });
}
async function assign(db,ctx,body){
  const data=input(ctx,body,true),payloadHash=hash(JSON.stringify({userId:data.userId,planVersionId:data.planVersionId,roleLimits:data.roleLimits,expectedState:data.expectedState}));
  return transaction(db,async()=>{
    const user=await userRow(db,data.userId,true);
    const [[prior]]=await db.query('SELECT r.*,a.plan_version_id,a.role_limits,a.status,h.assigned_expiry FROM sx_legacy_contract_assignments r JOIN sx_plan_assignments a ON a.id=r.assignment_id JOIN sx_legacy_plan_assignments h ON h.id=r.legacy_assignment_id WHERE r.request_id=? FOR UPDATE',[data.requestId]);
    if(prior){
      if(prior.legacy_user_id!==data.userId||prior.actor_identity_id!==ctx.identity.id||prior.payload_hash!==payloadHash)fail('IDEMPOTENCY_CONFLICT');
      return {id:prior.assignment_id,legacyAssignmentId:prior.legacy_assignment_id,tenantId:prior.tenant_id,planVersionId:prior.plan_version_id,roleLimits:parse(prior.role_limits),status:prior.status,expiresAt:Number(prior.assigned_expiry),replayed:true};
    }
    const loaded=await load(db,user,data,true);
    if(data.expectedState!==loaded.token)fail('STALE_ASSIGNMENT');
    if(loaded.blockers.length)fail(loaded.blockers[0].split(':')[0]);
    // One database UTC instant supplies both DATETIME and epoch expiries.
    // DATETIME strings avoid a local-time driver round trip.
    const [[clock]]=await db.query("SELECT DATE_FORMAT(t.started_at,'%Y-%m-%d %H:%i:%s.%f') AS starts,DATE_FORMAT(DATE_ADD(t.started_at,INTERVAL ? DAY),'%Y-%m-%d %H:%i:%s.%f') AS ends,CAST(TIMESTAMPDIFF(MICROSECOND,'1970-01-01 00:00:00',DATE_ADD(t.started_at,INTERVAL ? DAY))/1000 AS UNSIGNED) AS epoch FROM (SELECT UTC_TIMESTAMP(3) AS started_at) AS t",[loaded.days,loaded.days]);
    const id=crypto.randomUUID(),historyId=crypto.randomUUID(),status=Number(loaded.commercial.is_trial)===1?'trial':'active',snapshot=JSON.stringify(loaded.commercial);
    await db.query("UPDATE sx_plan_assignments SET status='superseded' WHERE tenant_id=? AND current_tenant IS NOT NULL",[loaded.tenant.id]);
    await db.query('INSERT INTO sx_plan_assignments(id,tenant_id,plan_version_id,role_limits,status,effective_from,expires_at) VALUES (?,?,?,?,?,?,?)',[id,loaded.tenant.id,data.planVersionId,JSON.stringify(data.roleLimits),status,clock.starts,clock.ends]);
    await db.query('INSERT INTO sx_legacy_plan_assignments(id,request_id,owner_uid,owner_uid_hash,actor_uid,plan_id,previous_snapshot,previous_expiry,assigned_snapshot,assigned_expiry) VALUES (?,?,?,?,?,?,?,?,?,?)',[historyId,data.requestId,user.uid,hash(user.uid),ctx.identity.id,loaded.version.legacy_plan_id,user.plan,user.plan_expire,snapshot,clock.epoch]);
    const [updated]=await db.query('UPDATE user SET plan=?,plan_expire=? WHERE id=?',[snapshot,clock.epoch,user.id]);if(updated.affectedRows!==1)fail('ASSIGNMENT_WRITE_FAILED');
    await db.query('UPDATE sx_tenants SET revision=revision+1 WHERE id=?',[loaded.tenant.id]);
    await db.query('INSERT INTO sx_legacy_contract_assignments(request_id,legacy_user_id,tenant_id,actor_identity_id,payload_hash,assignment_id,legacy_assignment_id) VALUES (?,?,?,?,?,?,?)',[data.requestId,user.id,loaded.tenant.id,ctx.identity.id,payloadHash,id,historyId]);
    await plans.audit(db,ctx,'legacy-business.contract-assigned',id,{userId:user.id,planVersionId:data.planVersionId,legacyPlanId:loaded.version.legacy_plan_id,roleLimits:data.roleLimits,status,durationDays:loaded.days,legacyAssignmentId:historyId},loaded.tenant.id);
    return {id,legacyAssignmentId:historyId,tenantId:loaded.tenant.id,planVersionId:data.planVersionId,roleLimits:data.roleLimits,status,expiresAt:Number(clock.epoch),replayed:false};
  });
}
module.exports={input,preview,assign};
