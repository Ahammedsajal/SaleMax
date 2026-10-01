const crypto=require('node:crypto');
const {platformDecision,decision}=require('./policy');
const {trainingCenter}=require('./categories');
function fail(code){throw Object.assign(new Error(code),{code});}
function json(value){return typeof value==='string'?JSON.parse(value):value;}
function uuid(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))fail('INVALID_ID');return value;}
function limits(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4)fail('INVALID_ROLE_LIMITS');
  const result={};
  for(const role of ['owner','accountant','manager','agent']){
    if(!Number.isSafeInteger(value[role])||value[role]<0||value[role]>10000)fail('INVALID_ROLE_LIMITS');
    result[role]=value[role];
  }
  if(result.owner!==1)fail('ONE_OWNER_REQUIRED');
  return result;
}
function definition(input){
  if(!input||input.categoryKey!==trainingCenter.key||input.categoryVersion!==trainingCenter.version)fail('CATEGORY_UNAVAILABLE');
  if(!Array.isArray(input.capabilities)||!input.capabilities.length||input.capabilities.some(c=>!trainingCenter.capabilities.includes(c))||new Set(input.capabilities).size!==input.capabilities.length)fail('INVALID_CAPABILITIES');
  return {categoryKey:input.categoryKey,categoryVersion:input.categoryVersion,capabilities:[...input.capabilities].sort(),roleLimits:limits(input.roleLimits)};
}
async function transaction(db,fn){await db.beginTransaction();try{const result=await fn();await db.commit();return result;}catch(error){await db.rollback();throw error;}}
async function audit(db,ctx,action,resourceId,changes,tenantId=null){
  if(!ctx.identity?.id)fail('IDENTITY_REQUIRED');
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?,?,?,'identity',?,'platform',?,?,?)`,[crypto.randomUUID(),tenantId,ctx.identity.id,action,resourceId,JSON.stringify(changes),crypto.randomUUID()]);
}
function authorize(ctx,permission){if(!platformDecision(ctx,permission))fail('PERMISSION_DENIED');}
async function createDraft(db,ctx,input){
  authorize(ctx,'plans.draft');const data=definition(input);
  const name=typeof input.name==='string'?input.name.trim():'';
  if(!input.planId&&(!name||name.length>200))fail('INVALID_PLAN_NAME');
  const planId=input.planId?uuid(input.planId):crypto.randomUUID(),id=crypto.randomUUID();
  return transaction(db,async()=>{
    if(!input.planId)await db.query('INSERT INTO sx_plans(id,name) VALUES (?,?)',[planId,name]);
    const [[plan]]=await db.query('SELECT next_version FROM sx_plans WHERE id=? FOR UPDATE',[planId]);
    if(!plan)fail('PLAN_NOT_FOUND');
    await db.query(`INSERT INTO sx_plan_versions(id,plan_id,version,category_key,category_version,capabilities,role_limits) VALUES (?,?,?,?,?,?,?)`,[id,planId,plan.next_version,data.categoryKey,data.categoryVersion,JSON.stringify(data.capabilities),JSON.stringify(data.roleLimits)]);
    await db.query('UPDATE sx_plans SET next_version=next_version+1 WHERE id=?',[planId]);
    await audit(db,ctx,'plan.draft-created',id,{planId,version:plan.next_version});
    return {id,planId,version:plan.next_version,revision:1,status:'draft'};
  });
}
async function updateDraft(db,ctx,id,revision,input){
  authorize(ctx,'plans.draft');uuid(id);const data=definition(input);
  if(!Number.isSafeInteger(revision)||revision<1)fail('INVALID_REVISION');
  return transaction(db,async()=>{
    const [[row]]=await db.query('SELECT status,revision FROM sx_plan_versions WHERE id=? FOR UPDATE',[id]);
    if(!row)fail('PLAN_NOT_FOUND');if(row.status!=='draft')fail('PUBLISHED_PLAN_IMMUTABLE');if(Number(row.revision)!==revision)fail('STALE_REVISION');
    await db.query('UPDATE sx_plan_versions SET category_key=?,category_version=?,capabilities=?,role_limits=?,revision=revision+1 WHERE id=?',[data.categoryKey,data.categoryVersion,JSON.stringify(data.capabilities),JSON.stringify(data.roleLimits),id]);
    await audit(db,ctx,'plan.draft-updated',id,{revision:revision+1});return {id,revision:revision+1,status:'draft'};
  });
}
async function publish(db,ctx,id,revision){
  authorize(ctx,'plans.publish');uuid(id);
  return transaction(db,async()=>{
    const [[row]]=await db.query('SELECT * FROM sx_plan_versions WHERE id=? FOR UPDATE',[id]);
    if(!row)fail('PLAN_NOT_FOUND');if(row.status!=='draft')fail('PUBLISHED_PLAN_IMMUTABLE');if(Number(row.revision)!==revision)fail('STALE_REVISION');
    definition({categoryKey:row.category_key,categoryVersion:row.category_version,capabilities:json(row.capabilities),roleLimits:json(row.role_limits)});
    await db.query("UPDATE sx_plan_versions SET status='published',revision=revision+1,published_at=UTC_TIMESTAMP(3) WHERE id=?",[id]);
    await audit(db,ctx,'plan.published',id,{revision:revision+1});return {id,status:'published',revision:revision+1};
  });
}
async function lockTenant(db,tenantId){
  const [[tenant]]=await db.query('SELECT * FROM sx_tenants WHERE id=? FOR UPDATE',[uuid(tenantId)]);
  if(!tenant)fail('TENANT_NOT_FOUND');if(tenant.status!=='active')fail('ACCOUNT_INACTIVE');return tenant;
}
async function usage(db,tenantId){
  // Cleanup and counting happen under the same tenant lock as every seat mutation.
  await db.query("UPDATE sx_team_invites SET status='expired' WHERE tenant_id=? AND status='pending' AND expires_at<=UTC_TIMESTAMP(3)",[tenantId]);
  return readUsage(db,tenantId);
}
async function readUsage(db,tenantId){
  const [members]=await db.query("SELECT role,COUNT(*) AS n FROM sx_memberships WHERE tenant_id=? AND status='active' GROUP BY role",[tenantId]);
  const [invites]=await db.query("SELECT role,COUNT(*) AS n FROM sx_team_invites WHERE tenant_id=? AND status='pending' AND expires_at>UTC_TIMESTAMP(3) GROUP BY role",[tenantId]);
  const result={owner:0,accountant:0,manager:0,agent:0};for(const row of [...members,...invites])result[row.role]+=Number(row.n);return result;
}
async function previewAssignment(db,ctx,input){
  authorize(ctx,'plans.assign');uuid(input.tenantId);uuid(input.planVersionId);const proposed=limits(input.roleLimits);
  return transaction(db,async()=>{
    const [[tenant]]=await db.query('SELECT category_key,category_version,status FROM sx_tenants WHERE id=?',[input.tenantId]);
    if(!tenant)fail('TENANT_NOT_FOUND');
    const [[plan]]=await db.query('SELECT * FROM sx_plan_versions WHERE id=?',[input.planVersionId]);
    if(!plan||plan.status!=='published')fail('PUBLISHED_PLAN_REQUIRED');
    const used=await readUsage(db,input.tenantId),ceiling=limits(json(plan.role_limits)),current=await loadEntitlements(db,input.tenantId);
    const blockers=[];
    if(tenant.status!=='active')blockers.push('ACCOUNT_INACTIVE');
    if(plan.category_key!==tenant.category_key||plan.category_version!==tenant.category_version)blockers.push('CATEGORY_UNAVAILABLE');
    for(const role of Object.keys(ceiling)){
      if(proposed[role]>ceiling[role])blockers.push('PLAN_LIMIT_EXCEEDED:'+role);
      if(proposed[role]<used[role])blockers.push('SEATS_IN_USE:'+role);
    }
    const nextCapabilities=json(plan.capabilities);
    return {tenantId:input.tenantId,planVersionId:plan.id,used,proposedLimits:proposed,currentLimits:current?.roleLimits||null,
      removedCapabilities:(current?.capabilities||[]).filter(key=>!nextCapabilities.includes(key)),
      addedCapabilities:nextCapabilities.filter(key=>!current?.capabilities.includes(key)),blockers,canAssign:blockers.length===0,previewOnly:true};
  });
}
async function assign(db,ctx,input){
  authorize(ctx,'plans.assign');uuid(input.tenantId);uuid(input.planVersionId);
  const roleLimits=limits(input.roleLimits);
  if(!Number.isSafeInteger(input.durationDays)||input.durationDays<1||input.durationDays>3650)fail('INVALID_DURATION');
  const status=input.status||'active';if(!['active','trial'].includes(status))fail('INVALID_ASSIGNMENT_STATUS');
  return transaction(db,async()=>{
    const tenant=await lockTenant(db,input.tenantId);
    const [[plan]]=await db.query('SELECT * FROM sx_plan_versions WHERE id=?',[input.planVersionId]);
    if(!plan||plan.status!=='published')fail('PUBLISHED_PLAN_REQUIRED');
    if(plan.category_key!==tenant.category_key||plan.category_version!==tenant.category_version)fail('CATEGORY_UNAVAILABLE');
    const ceiling=limits(json(plan.role_limits)),used=await usage(db,tenant.id);
    for(const role of Object.keys(ceiling)){if(roleLimits[role]>ceiling[role])fail('PLAN_LIMIT_EXCEEDED');if(roleLimits[role]<used[role])fail('SEATS_IN_USE');}
    const id=crypto.randomUUID();
    await db.query("UPDATE sx_plan_assignments SET status='superseded' WHERE tenant_id=? AND current_tenant IS NOT NULL",[tenant.id]);
    await db.query(`INSERT INTO sx_plan_assignments(id,tenant_id,plan_version_id,role_limits,status,effective_from,expires_at)
      VALUES (?,?,?,?,?,UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? DAY))`,[id,tenant.id,plan.id,JSON.stringify(roleLimits),status,input.durationDays]);
    await db.query('UPDATE sx_tenants SET revision=revision+1 WHERE id=?',[tenant.id]);
    await audit(db,ctx,'tenant.plan-assigned',id,{planVersionId:plan.id,roleLimits,status,durationDays:input.durationDays},tenant.id);
    return {id,tenantId:tenant.id,planVersionId:plan.id,roleLimits,status};
  });
}
async function loadEntitlements(db,tenantId){
  const [[row]]=await db.query(`SELECT a.id,a.status,a.role_limits,p.capabilities,p.category_key,p.category_version,
    (a.effective_from<=UTC_TIMESTAMP(3) AND a.expires_at>UTC_TIMESTAMP(3)) AS current_period
    FROM sx_plan_assignments a JOIN sx_plan_versions p ON p.id=a.plan_version_id AND p.status='published'
    WHERE a.tenant_id=? AND a.current_tenant IS NOT NULL`,[uuid(tenantId)]);
  if(!row)return null;
  return {assignmentId:row.id,status:row.current_period?row.status:'expired',roleLimits:limits(json(row.role_limits)),capabilities:json(row.capabilities),categoryKey:row.category_key,categoryVersion:row.category_version};
}
async function reserveInvite(db,ctx,input){
  if(!decision(ctx,{capability:'team.members',permission:'team.invite'}).allowed)fail('PERMISSION_DENIED');
  if(!['accountant','manager','agent'].includes(input.role))fail('INVALID_INVITE_ROLE');
  uuid(input.requestKey);
  const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
  if(email.length>254||!email||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('INVALID_EMAIL');
  return transaction(db,async()=>{
    const tenant=await lockTenant(db,ctx.tenant.id);
    const [[member]]=await db.query(`SELECT m.role,m.status,m.delegated_permissions FROM sx_memberships m
      JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
      WHERE m.tenant_id=? AND m.id=? AND m.identity_id=?`,[ctx.tenant.id,ctx.membership.id,ctx.identity.id]);
    if(!member)fail('PERMISSION_DENIED');
    const entitlement=await loadEntitlements(db,ctx.tenant.id);
    const trusted={...ctx,tenant:{...ctx.tenant,status:tenant.status,categoryKey:tenant.category_key,categoryVersion:tenant.category_version},category:trainingCenter,membership:{...ctx.membership,role:member.role,status:member.status,delegatedPermissions:json(member.delegated_permissions)},subscription:entitlement};
    if(!entitlement||entitlement.categoryKey!==tenant.category_key||entitlement.categoryVersion!==tenant.category_version||!decision(trusted,{capability:'team.members',permission:'team.invite'}).allowed)fail('FEATURE_UNAVAILABLE');
    const used=await usage(db,ctx.tenant.id);
    const [[prior]]=await db.query('SELECT id,email_normalized,role,status FROM sx_team_invites WHERE tenant_id=? AND request_key=?',[ctx.tenant.id,input.requestKey]);
    if(prior){if(prior.email_normalized!==email||prior.role!==input.role)fail('IDEMPOTENCY_CONFLICT');return {id:prior.id,status:prior.status,repeated:true};}
    if(used[input.role]>=entitlement.roleLimits[input.role])fail('SEAT_LIMIT_EXCEEDED');
    const [[existing]]=await db.query(`SELECT m.id FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id WHERE m.tenant_id=? AND i.email_normalized=?`,[ctx.tenant.id,email]);
    if(existing)fail('MEMBERSHIP_EXISTS');
    const [[pending]]=await db.query("SELECT id FROM sx_team_invites WHERE tenant_id=? AND email_normalized=? AND status='pending'",[ctx.tenant.id,email]);
    if(pending)fail('INVITE_ALREADY_PENDING');
    const id=crypto.randomUUID();
    await db.query(`INSERT INTO sx_team_invites(id,tenant_id,request_key,email_normalized,role,expires_at) VALUES (?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 7 DAY))`,[id,ctx.tenant.id,input.requestKey,email,input.role]);
    await audit(db,ctx,'team.invite-reserved',id,{role:input.role},ctx.tenant.id);
    return {id,status:'pending',repeated:false,deliveryQueued:false};
  });
}
module.exports={definition,limits,createDraft,updateDraft,publish,previewAssignment,assign,loadEntitlements,reserveInvite};
