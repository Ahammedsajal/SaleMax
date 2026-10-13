'use strict';
const crypto=require('node:crypto');
const {salemaxSales}=require('./categories');
const {decision}=require('./policy');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function assertContext(ctx){
  if(ctx?.audience!=='tenant'||ctx.category?.key!==salemaxSales.key||ctx.category?.version!==salemaxSales.version||ctx.tenant?.categoryKey!==salemaxSales.key||Number(ctx.tenant?.categoryVersion)!==salemaxSales.version)fail('CATEGORY_UNAVAILABLE');
  if(ctx.tenant.status!=='active'||!ctx.subscription||!['active','trial','grace'].includes(ctx.subscription.status)||!ctx.subscription.capabilities?.includes('team.members'))fail('FEATURE_UNAVAILABLE');
  if(!ctx.identity?.id||!ctx.membership?.id||ctx.membership.status!=='active'||ctx.membership.tenantId!==ctx.tenant.id)fail('PERMISSION_DENIED');
}
function reason(value){const text=typeof value==='string'?value.trim():'';if(text.length<3||text.length>1000)fail('INVALID_REASON');return text;}
async function list(db,ctx){
  assertContext(ctx);
  if(!['owner','manager','team_leader'].includes(ctx.membership.role))fail('PERMISSION_DENIED');
  if(!decision(ctx,{capability:'team.members',permission:'team.read'}).allowed)fail('PERMISSION_DENIED');
  const params=[ctx.tenant.id];
  let scope='';
  if(ctx.membership.role==='manager'){scope=' AND (m.id=? OR o.manager_membership_id=?)';params.push(ctx.membership.id,ctx.membership.id);}
  if(ctx.membership.role==='team_leader'){scope=' AND (m.id=? OR o.team_leader_membership_id=?)';params.push(ctx.membership.id,ctx.membership.id);}
  const [rows]=await db.query(`SELECT m.id AS membershipId,m.role,m.status,i.email_normalized AS email,i.display_name AS displayName,
      o.manager_membership_id AS managerMembershipId,mi.display_name AS managerName,
      o.team_leader_membership_id AS teamLeaderMembershipId,li.display_name AS teamLeaderName,
      DATE_FORMAT(o.started_at,'%Y-%m-%dT%H:%i:%s.%fZ') AS assignedAt,o.reason
    FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id
    LEFT JOIN sx_sales_org_history o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.ended_at IS NULL
    LEFT JOIN sx_memberships mm ON mm.tenant_id=o.tenant_id AND mm.id=o.manager_membership_id
    LEFT JOIN sx_identities mi ON mi.id=mm.identity_id
    LEFT JOIN sx_memberships lm ON lm.tenant_id=o.tenant_id AND lm.id=o.team_leader_membership_id
    LEFT JOIN sx_identities li ON li.id=lm.identity_id
    WHERE m.tenant_id=? AND m.status='active' AND i.status='active' AND m.role IN ('owner','manager','team_leader','agent','accountant')${scope}
    ORDER BY FIELD(m.role,'owner','manager','team_leader','agent','accountant'),i.display_name,i.email_normalized LIMIT 1000`,params);
  return {members:rows,canReassign:['owner','manager'].includes(ctx.membership.role)};
}
async function reassign(db,ctx,membershipId,input){
  assertContext(ctx);
  if(!uuid(membershipId)||!uuid(input?.managerMembershipId))fail('INVALID_ASSIGNMENT');
  if(!['owner','manager'].includes(ctx.membership.role))fail('PERMISSION_DENIED');
  if(ctx.membership.role==='owner'){
    if(!decision(ctx,{capability:'team.members',permission:'team.invite'}).allowed)fail('PERMISSION_DENIED');
  }else if(!ctx.membership.customPermissions||!Array.isArray(ctx.membership.customPermissions)||ctx.membership.customPermissions.includes('team.invite')){
    // Managers may shuffle only people already in their reporting scope below.
  }else fail('PERMISSION_DENIED');
  const why=reason(input.reason);
  await db.beginTransaction();
  try{
    const [[lockedTenant]]=await db.query('SELECT id FROM sx_tenants WHERE id=? AND status=\'active\' FOR UPDATE',[ctx.tenant.id]);
    if(!lockedTenant)fail('CATEGORY_UNAVAILABLE');
    const [[target]]=await db.query(`SELECT id,role,status FROM sx_memberships WHERE tenant_id=? AND id=? FOR UPDATE`,[ctx.tenant.id,membershipId]);
    if(!target||target.status!=='active'||!['team_leader','agent'].includes(target.role))fail('MEMBER_NOT_FOUND');
    const [[manager]]=await db.query(`SELECT id,role,status FROM sx_memberships WHERE tenant_id=? AND id=? FOR UPDATE`,[ctx.tenant.id,input.managerMembershipId]);
    if(!manager||manager.role!=='manager'||manager.status!=='active')fail('INVALID_MANAGER');
    if(ctx.membership.role==='manager'&&manager.id!==ctx.membership.id)fail('PERMISSION_DENIED');
    let leader=null;
    if(target.role==='agent'){
      if(!uuid(input?.teamLeaderMembershipId))fail('INVALID_ASSIGNMENT');
      [[leader]]=await db.query(`SELECT id,role,status FROM sx_memberships WHERE tenant_id=? AND id=? FOR UPDATE`,[ctx.tenant.id,input.teamLeaderMembershipId]);
      if(!leader||leader.role!=='team_leader'||leader.status!=='active')fail('INVALID_TEAM_LEADER');
      const [[leaderAssignment]]=await db.query(`SELECT manager_membership_id AS managerMembershipId FROM sx_sales_org_history WHERE tenant_id=? AND membership_id=? AND ended_at IS NULL FOR UPDATE`,[ctx.tenant.id,leader.id]);
      if(!leaderAssignment||leaderAssignment.managerMembershipId!==manager.id)fail('TEAM_LEADER_OUTSIDE_MANAGER');
    }
    const [[current]]=await db.query(`SELECT manager_membership_id AS managerMembershipId,team_leader_membership_id AS teamLeaderMembershipId,reason
      FROM sx_sales_org_history WHERE tenant_id=? AND membership_id=? AND ended_at IS NULL FOR UPDATE`,[ctx.tenant.id,target.id]);
    if(ctx.membership.role==='manager'&&current?.managerMembershipId&&current.managerMembershipId!==ctx.membership.id)fail('PERMISSION_DENIED');
    const nextLeaderId=leader?.id||null;
    if(current?.managerMembershipId===manager.id&&current?.teamLeaderMembershipId===nextLeaderId){await db.commit();return {membershipId:target.id,managerMembershipId:manager.id,teamLeaderMembershipId:nextLeaderId,unchanged:true};}
    let followers=[];
    if(target.role==='team_leader'&&current){
      const [rows]=await db.query(`SELECT membership_id AS membershipId FROM sx_sales_org_history WHERE tenant_id=? AND team_leader_membership_id=? AND ended_at IS NULL ORDER BY membership_id FOR UPDATE`,[ctx.tenant.id,target.id]);
      followers=rows;
      if(ctx.membership.role==='manager'&&followers.length&&current.managerMembershipId!==ctx.membership.id)fail('PERMISSION_DENIED');
    }
    if(current)await db.query('UPDATE sx_sales_org_history SET ended_at=GREATEST(UTC_TIMESTAMP(3),started_at) WHERE tenant_id=? AND membership_id=? AND ended_at IS NULL',[ctx.tenant.id,target.id]);
    const assignmentId=crypto.randomUUID();
    await db.query(`INSERT INTO sx_sales_org_history(id,tenant_id,membership_id,manager_membership_id,team_leader_membership_id,assigned_by_identity_id,reason)
      VALUES (?,?,?,?,?,?,?)`,[assignmentId,ctx.tenant.id,target.id,manager.id,nextLeaderId,ctx.identity.id,why]);
    for(const follower of followers){
      const [[followerCurrent]]=await db.query(`SELECT team_leader_membership_id AS teamLeaderMembershipId FROM sx_sales_org_history WHERE tenant_id=? AND membership_id=? AND ended_at IS NULL FOR UPDATE`,[ctx.tenant.id,follower.membershipId]);
      if(!followerCurrent)continue;
      await db.query('UPDATE sx_sales_org_history SET ended_at=GREATEST(UTC_TIMESTAMP(3),started_at) WHERE tenant_id=? AND membership_id=? AND ended_at IS NULL',[ctx.tenant.id,follower.membershipId]);
      await db.query(`INSERT INTO sx_sales_org_history(id,tenant_id,membership_id,manager_membership_id,team_leader_membership_id,assigned_by_identity_id,reason)
        VALUES (?,?,?,?,?,?,?)`,[crypto.randomUUID(),ctx.tenant.id,follower.membershipId,manager.id,followerCurrent.teamLeaderMembershipId,ctx.identity.id,why]);
    }
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,reason,changes,correlation_id)
      VALUES (?,?,?,'identity','sales.organisation.reassigned','membership',?,?,?,?)`,[crypto.randomUUID(),ctx.tenant.id,ctx.identity.id,target.id,why,JSON.stringify({oldManagerMembershipId:current?.managerMembershipId||null,oldTeamLeaderMembershipId:current?.teamLeaderMembershipId||null,managerMembershipId:manager.id,teamLeaderMembershipId:nextLeaderId,followersMoved:followers.length}),crypto.randomUUID()]);
    await db.query('UPDATE sx_tenants SET revision=revision+1 WHERE id=?',[ctx.tenant.id]);
    await db.commit();
    return {membershipId:target.id,managerMembershipId:manager.id,teamLeaderMembershipId:nextLeaderId,followersMoved:followers.length,assignmentId,unchanged:false};
  }catch(error){await db.rollback();throw error;}
}
module.exports={assertContext,list,reassign};
