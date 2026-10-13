'use strict';

const crypto=require('node:crypto');
const {decision}=require('./policy');
const {assertContext}=require('./sales-organization');

const fail=code=>{throw Object.assign(new Error(code),{code});};
function parsePeriod(value){
  if(typeof value!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(value))fail('INVALID_TARGET_PERIOD');
  return {period:value,start:`${value}-01`,end:`${value}-01`};
}
function targetAccess(ctx){
  assertContext(ctx);
  const access=decision(ctx,{capability:'sales.targets',permission:'targets.read'});
  if(!access.allowed)fail(access.code);
  return access;
}
async function visibleMembers(db,ctx){
  const role=ctx.membership.role;
  if(!['owner','manager','team_leader','agent'].includes(role))fail('PERMISSION_DENIED');
  const params=[ctx.tenant.id];
  let scope='';
  if(role==='manager'){
    scope=' AND (m.id=? OR o.manager_membership_id=?)';params.push(ctx.membership.id,ctx.membership.id);
  }else if(role==='team_leader'){
    scope=' AND (m.id=? OR o.team_leader_membership_id=?)';params.push(ctx.membership.id,ctx.membership.id);
  }else if(role==='agent'){
    scope=' AND m.id=?';params.push(ctx.membership.id);
  }else scope=" AND m.role IN ('manager','team_leader','agent')";
  const [rows]=await db.query(`SELECT m.id AS membershipId,m.role,i.display_name AS displayName,
      o.manager_membership_id AS managerMembershipId,o.team_leader_membership_id AS teamLeaderMembershipId
    FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id
    LEFT JOIN sx_sales_org_history o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.ended_at IS NULL
    WHERE m.tenant_id=? AND m.status='active' AND i.status='active'${scope}
    ORDER BY FIELD(m.role,'manager','team_leader','agent'),i.display_name,i.email_normalized LIMIT 1000`,params);
  return rows;
}
async function list(db,ctx,periodValue){
  targetAccess(ctx);
  const period=parsePeriod(periodValue);
  const members=await visibleMembers(db,ctx);
  if(!members.length)return {period:period.period,canManage:false,members:[]};
  const ids=members.map(row=>row.membershipId);
  const [[range]]=await db.query(`SELECT CAST(? AS DATE) AS starts_at,DATE_ADD(CAST(? AS DATE),INTERVAL 1 MONTH) AS ends_at`,[period.start,period.end]);
  const [targetRows]=await db.query(`SELECT membership_id AS membershipId,metric,currency,target_value AS targetValue
    FROM sx_sales_targets WHERE tenant_id=? AND period_start=? AND membership_id IN (?)`,[ctx.tenant.id,range.starts_at,ids]);
  const [dealRows]=await db.query(`SELECT seller_membership_id AS membershipId,manager_membership_id AS managerMembershipId,
      team_leader_membership_id AS teamLeaderMembershipId,currency,SUM(amount_minor) AS actualMinor
    FROM sx_sales_deals WHERE tenant_id=? AND status='approved' AND decided_at>=? AND decided_at<?
      AND (seller_membership_id IN (?) OR manager_membership_id IN (?) OR team_leader_membership_id IN (?))
    GROUP BY seller_membership_id,manager_membership_id,team_leader_membership_id,currency`,[ctx.tenant.id,range.starts_at,range.ends_at,ids,ids,ids]);
  const [callRows]=await db.query(`SELECT c.answered_by_membership_id AS membershipId,h.manager_membership_id AS managerMembershipId,
      h.team_leader_membership_id AS teamLeaderMembershipId,COUNT(*) AS actualCalls
    FROM sx_telephony_calls c LEFT JOIN sx_sales_org_history h ON h.tenant_id=c.tenant_id AND h.membership_id=c.answered_by_membership_id
      AND h.started_at<=c.answered_at AND (h.ended_at IS NULL OR h.ended_at>c.answered_at)
    WHERE c.tenant_id=? AND c.answered_at>=? AND c.answered_at<? AND (c.answered_by_membership_id IN (?) OR h.manager_membership_id IN (?) OR h.team_leader_membership_id IN (?))
    GROUP BY c.answered_by_membership_id,h.manager_membership_id,h.team_leader_membership_id`,[ctx.tenant.id,range.starts_at,range.ends_at,ids,ids,ids]);
  const targets=new Map(targetRows.map(row=>[`${row.membershipId}:${row.metric}:${row.currency}`,String(row.targetValue)]));
  const canManage=['owner','manager'].includes(ctx.membership.role)&&decision(ctx,{capability:'sales.targets',permission:'targets.manage'}).allowed;
  return {period:period.period,canManage,members:members.map(member=>{
    const actualByCurrency=new Map();
    const belongs=row=>row.membershipId===member.membershipId||member.role==='manager'&&row.managerMembershipId===member.membershipId||member.role==='team_leader'&&row.teamLeaderMembershipId===member.membershipId;
    for(const row of dealRows)if(belongs(row))actualByCurrency.set(row.currency,(actualByCurrency.get(row.currency)||0n)+BigInt(row.actualMinor||0));
    const currencySet=new Set([...targetRows.filter(row=>row.membershipId===member.membershipId&&row.metric==='sales_amount').map(row=>row.currency),...actualByCurrency.keys()]);
    return {membershipId:member.membershipId,role:member.role,displayName:member.displayName||'',managerMembershipId:member.managerMembershipId||null,teamLeaderMembershipId:member.teamLeaderMembershipId||null,
      targets:{connectedCalls:targets.get(`${member.membershipId}:connected_calls:---`)||null,
        salesByCurrency:[...currencySet].sort().map(currency=>({currency,actualMinor:(actualByCurrency.get(currency)||0n).toString(),targetMinor:targets.get(`${member.membershipId}:sales_amount:${currency}`)||null}))},
      actual:{connectedCalls:callRows.reduce((sum,row)=>sum+(belongs(row)?Number(row.actualCalls||0):0),0)}};
  })};
}
async function save(db,ctx,membershipId,input){
  targetAccess(ctx);
  if(!['owner','manager'].includes(ctx.membership.role)||!decision(ctx,{capability:'sales.targets',permission:'targets.manage'}).allowed)fail('PERMISSION_DENIED');
  if(typeof membershipId!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(membershipId))fail('INVALID_TARGET_MEMBER');
  const period=parsePeriod(input?.period),metric=input?.metric;
  if(!['connected_calls','sales_amount'].includes(metric))fail('INVALID_TARGET_METRIC');
  const value=String(input?.targetValue??'');
  if(!/^\d{1,15}$/.test(value)||BigInt(value)>9000000000000000n)fail('INVALID_TARGET_VALUE');
  const targetValue=BigInt(value);
  const currency=metric==='sales_amount'?String(input.currency||'').toUpperCase():'---';
  if(metric==='sales_amount'&&!/^[A-Z]{3}$/.test(currency))fail('INVALID_TARGET_CURRENCY');
  await db.beginTransaction();
  try{
    await db.query('SELECT id FROM sx_tenants WHERE id=? AND status=\'active\' FOR UPDATE',[ctx.tenant.id]);
    const [[member]]=await db.query(`SELECT m.id,m.role FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
      WHERE m.tenant_id=? AND m.id=? AND m.status='active' FOR UPDATE`,[ctx.tenant.id,membershipId]);
    if(!member||!['manager','team_leader','agent'].includes(member.role))fail('TARGET_MEMBER_NOT_FOUND');
    if(ctx.membership.role==='manager'){
      const [[assignment]]=await db.query(`SELECT manager_membership_id FROM sx_sales_org_history WHERE tenant_id=? AND membership_id=? AND ended_at IS NULL FOR UPDATE`,[ctx.tenant.id,membershipId]);
      if(member.id!==ctx.membership.id&&assignment?.manager_membership_id!==ctx.membership.id)fail('PERMISSION_DENIED');
    }
    const [[before]]=await db.query(`SELECT target_value AS targetValue FROM sx_sales_targets
      WHERE tenant_id=? AND membership_id=? AND period_start=CAST(? AS DATE) AND metric=? AND currency=? FOR UPDATE`,[ctx.tenant.id,membershipId,period.start,metric,currency]);
    if(targetValue===0n){
      await db.query(`DELETE FROM sx_sales_targets WHERE tenant_id=? AND membership_id=? AND period_start=CAST(? AS DATE) AND metric=? AND currency=?`,[ctx.tenant.id,membershipId,period.start,metric,currency]);
    }else{
      await db.query(`INSERT INTO sx_sales_targets(id,tenant_id,membership_id,period_start,metric,currency,target_value,created_by_identity_id,updated_by_identity_id)
        VALUES(?,?,?,CAST(? AS DATE),?,?,?,?,?) ON DUPLICATE KEY UPDATE target_value=VALUES(target_value),updated_by_identity_id=VALUES(updated_by_identity_id)`,
      [crypto.randomUUID(),ctx.tenant.id,membershipId,period.start,metric,currency,value,ctx.identity.id,ctx.identity.id]);
    }
    const action=targetValue===0n?'sales.target.cleared':'sales.target.updated';
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,reason,changes,correlation_id)
      VALUES(?,?,?,'identity',?,'sales_target',?,?,?,?)`,[crypto.randomUUID(),ctx.tenant.id,ctx.identity.id,action,membershipId,
      `Monthly ${metric} target ${period.period}`,JSON.stringify({period:period.period,metric,currency,before:before?String(before.targetValue):null,after:targetValue===0n?null:value}),crypto.randomUUID()]);
    await db.commit();
    return {membershipId,period:period.period,metric,currency,targetValue:targetValue===0n?null:value};
  }catch(error){await db.rollback();throw error;}
}
module.exports={parsePeriod,visibleMembers,list,save};
