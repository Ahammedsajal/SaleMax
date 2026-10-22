'use strict';
const crypto=require('node:crypto');
const plans=require('./plans');
const {salemaxSales,getCategory,categoryKeyMatches}=require('./categories');
const {decision}=require('./policy');
const sha=value=>crypto.createHash('sha256').update(String(value),'utf8').digest('hex');
const normalizedEmail=value=>String(value||'').trim().toLowerCase();
const deny=code=>({denied:true,code});
const parseValue=value=>{if(typeof value!=='string')return value;try{return JSON.parse(value);}catch{return null;}};
function categoryContext(linked,subscription,category){
  const customPermissions=linked.roleProfileId?parseValue(linked.rolePermissions):null;
  const assignedNavigation=parseValue(linked.assignedNavigation);
  if((linked.roleProfileId&&(!Array.isArray(customPermissions)||customPermissions.some(value=>typeof value!=='string')||linked.seatRole!==linked.role||!['active','archived'].includes(linked.roleStatus)))||(assignedNavigation!==null&&(!Array.isArray(assignedNavigation)||assignedNavigation.some(value=>typeof value!=='string'))))return null;
  return {audience:'tenant',identity:{id:linked.identityId},tenant:{id:linked.tenantId,status:linked.tenantStatus,categoryKey:category.key,categoryVersion:category.version},
    category,subscription,membership:{id:linked.membershipId,tenantId:linked.tenantId,role:linked.role,status:'active',
      customPermissions,assignedNavigation,delegatedPermissions:[]},runtimeReady:{}};
}

// Resolve verified owners/staff for registered lead-capable categories.
// Unmapped actors and Training Center v1 owners retain their explicit legacy path.
async function resolve(pool,user,{loadEntitlements=plans.loadEntitlements,categoryFor=getCategory}={}){
  if(!user||!Number.isSafeInteger(Number(user.id))||Number(user.id)<1||typeof user.uid!=='string'||!user.uid)return deny('AUTH_REQUIRED');
  const db=await pool.getConnection();
  try{
    const [rows]=await db.query(`SELECT t.id AS tenantId,t.status AS tenantStatus,t.category_key AS categoryKey,t.category_version AS categoryVersion,
        m.id AS membershipId,m.identity_id AS identityId,m.role,m.status AS membershipStatus,m.role_profile_id AS roleProfileId,
        m.assigned_navigation AS assignedNavigation,r.permissions AS rolePermissions,r.status AS roleStatus,r.seat_role AS seatRole,
        i.email_normalized AS identityEmail,i.status AS identityStatus,o.legacy_uid_hash AS legacyUidHash
      FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
      JOIN sx_tenants t ON t.id=o.tenant_id JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=t.id
      LEFT JOIN sx_team_roles r ON r.id=m.role_profile_id AND r.tenant_id=m.tenant_id
      JOIN sx_identities i ON i.id=m.identity_id WHERE u.id=? AND u.uid=? LIMIT 2`,[Number(user.id),user.uid]);
    if(!rows.length)return null;
    if(rows.length!==1)return deny('BUSINESS_LINK_INVALID');
    const linked=rows[0];
    if(linked.legacyUidHash!==sha(user.uid)||normalizedEmail(linked.identityEmail)!==normalizedEmail(user.email)||linked.identityStatus!=='active'||linked.membershipStatus!=='active'||linked.tenantStatus!=='active')return deny('BUSINESS_ACCESS_INACTIVE');
    const category=categoryFor(linked.categoryKey,Number(linked.categoryVersion));
    if(!pipelineCategory(category))return deny('CATEGORY_UNAVAILABLE');
    const legacyTraining=category.key==='training_center'&&category.version===1;
    if(linked.role==='owner'&&legacyTraining)return null;
    if(linked.role==='accountant')return deny('PERMISSION_DENIED');
    if(linked.role!=='owner'&&linked.role!=='manager'&&!(categoryKeyMatches(linked.categoryKey,salemaxSales.key)&&linked.role==='team_leader'))return deny('PERMISSION_DENIED');
    const entitlement=await loadEntitlements(db,linked.tenantId);
    if(!entitlement||!['active','trial','grace'].includes(entitlement.status)||!entitlement.capabilities?.includes('crm.leads'))return deny('FEATURE_UNAVAILABLE');
    const canonicalContext=categoryContext(linked,entitlement,category);
    if(!legacyTraining){
      if(!canonicalContext)return deny('BUSINESS_LINK_INVALID');
      const access=decision(canonicalContext,{capability:'crm.leads',permission:'leads.read'});
      if(!access.allowed)return deny(access.code);
    }
    const [owners]=await db.query(`SELECT u.uid,u.timezone,o.legacy_uid_hash AS ownerUidHash
      FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
      JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=o.tenant_id AND m.role='owner' AND m.status='active'
      JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
      WHERE o.tenant_id=? LIMIT 2`,[linked.tenantId]);
    if(owners.length!==1||owners[0].ownerUidHash!==sha(owners[0].uid))return deny('BUSINESS_LINK_INVALID');
    let scopeAgentIds,scopeIdentityIds;
    if(categoryKeyMatches(linked.categoryKey,salemaxSales.key)&&linked.role!=='owner'){
      const scopeColumn=linked.role==='manager'?'h.manager_membership_id':'h.team_leader_membership_id';
      const [agents]=await db.query(`SELECT a.id,a.uid,o.legacy_uid_hash AS legacyUidHash
        FROM agents a JOIN sx_legacy_ownership o ON o.source_table='agents' AND o.source_id=CAST(a.id AS CHAR) AND o.tenant_id=?
        JOIN sx_memberships am ON am.id=o.membership_id AND am.tenant_id=o.tenant_id AND am.role='agent' AND am.status='active'
        JOIN sx_sales_org_history h ON h.tenant_id=o.tenant_id AND h.membership_id=am.id AND h.ended_at IS NULL
        WHERE a.owner_uid=? AND a.is_active=1 AND ${scopeColumn}=? ORDER BY a.id`,
      [linked.tenantId,owners[0].uid,linked.membershipId]);
      scopeAgentIds=[...new Set(agents.filter(agent=>agent.legacyUidHash===sha(agent.uid)).map(agent=>Number(agent.id)).filter(id=>Number.isSafeInteger(id)&&id>0))];
      const [identities]=await db.query(`SELECT DISTINCT m.identity_id AS identityId FROM sx_memberships m
        LEFT JOIN sx_sales_org_history h ON h.tenant_id=m.tenant_id AND h.membership_id=m.id AND h.ended_at IS NULL
        WHERE m.tenant_id=? AND m.status='active' AND m.role IN ('manager','team_leader')
          AND (m.id=? OR (?='manager' AND h.manager_membership_id=?)) ORDER BY m.identity_id`,
      [linked.tenantId,linked.membershipId,linked.role,linked.membershipId]);
      scopeIdentityIds=[...new Set([linked.identityId,...identities.map(row=>row.identityId)])];
    }
    return {uid:owners[0].uid,role:linked.role,actorType:'user',actorId:linked.identityId,identityId:linked.identityId,membershipId:linked.membershipId,
      tenantId:linked.tenantId,categoryKey:linked.categoryKey,categoryVersion:category.version,legacyUserId:Number(user.id),legacyUid:user.uid,timezone:owners[0].timezone||'Asia/Qatar',
      ...(!legacyTraining?{canonicalContext}:{}),...(scopeAgentIds?{scopeAgentIds,scopeIdentityIds}:{})};
  }finally{db.release();}
}
async function resolveAgent(pool,agent,options={}){
  if(!agent||!Number.isSafeInteger(Number(agent.id))||typeof agent.uid!=='string'||!agent.uid||typeof agent.owner_uid!=='string'||!agent.owner_uid)return null;
  const db=await pool.getConnection();
  try{
    const [owners]=await db.query('SELECT id,uid,email,timezone FROM user WHERE uid=? LIMIT 2',[agent.owner_uid]);
    if(owners.length!==1)return owners.length?deny('BUSINESS_LINK_INVALID'):null;
    const ownerActor=await resolve(pool,owners[0],options);
    if(ownerActor?.denied)return ownerActor;
    if(!ownerActor?.canonicalContext)return null;
    const [rows]=await db.query(`SELECT t.id AS tenantId,t.status AS tenantStatus,t.category_key AS categoryKey,t.category_version AS categoryVersion,
        m.id AS membershipId,m.identity_id AS identityId,m.role,m.status AS membershipStatus,m.role_profile_id AS roleProfileId,
        m.assigned_navigation AS assignedNavigation,r.permissions AS rolePermissions,r.status AS roleStatus,r.seat_role AS seatRole,i.email_normalized AS identityEmail,i.status AS identityStatus,
        o.legacy_uid_hash AS legacyUidHash
      FROM sx_legacy_ownership o JOIN sx_tenants t ON t.id=o.tenant_id JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=t.id
      JOIN sx_identities i ON i.id=m.identity_id LEFT JOIN sx_team_roles r ON r.id=m.role_profile_id AND r.tenant_id=m.tenant_id
      WHERE o.source_table='agents' AND o.source_id=CAST(? AS CHAR) AND o.tenant_id=? LIMIT 2`,[Number(agent.id),ownerActor.tenantId]);
    if(rows.length!==1)return deny('BUSINESS_LINK_INVALID');
    const linked=rows[0];
    if(linked.legacyUidHash!==sha(agent.uid)||linked.categoryKey!==ownerActor.categoryKey||Number(linked.categoryVersion)!==ownerActor.categoryVersion||linked.tenantStatus!=='active'||linked.membershipStatus!=='active'||linked.identityStatus!=='active'||linked.role!=='agent'||normalizedEmail(linked.identityEmail)!==normalizedEmail(agent.email))return deny('BUSINESS_ACCESS_INACTIVE');
    const canonicalContext=categoryContext(linked,ownerActor.canonicalContext.subscription,ownerActor.canonicalContext.category);
    if(!canonicalContext)return deny('BUSINESS_LINK_INVALID');
    const access=decision(canonicalContext,{capability:'crm.leads',permission:'leads.read'});
    if(!access.allowed)return deny(access.code);
    return {...ownerActor,role:'agent',actorType:'agent',actorId:String(agent.id),agentId:Number(agent.id),agentUid:agent.uid,
      identityId:linked.identityId,membershipId:linked.membershipId,canonicalContext,scopeAgentIds:undefined};
  }finally{db.release();}
}
function pipelineCategory(category){return Boolean(category?.planable&&category.capabilities?.includes('crm.leads'));}
function canUsePipeline(actor){
  return Boolean(actor&&!actor.denied&&['owner','manager','team_leader'].includes(actor.role)&&
    pipelineCategory(actor.canonicalContext?.category||getCategory(actor.categoryKey,actor.categoryVersion??1)));
}
module.exports={resolve,resolveAgent,canUsePipeline,pipelineCategory};
