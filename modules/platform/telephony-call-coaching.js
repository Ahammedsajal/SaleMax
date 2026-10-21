'use strict';

const crypto=require('node:crypto');
const {decision}=require('./policy');

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const qualities=new Set(['effective','needs_improvement','follow_up_required']);
const fail=code=>{throw Object.assign(new Error(code),{code});};

function authorize(context,permission){
  if(context?.tenant?.categoryKey!=='7network_sales')fail('CATEGORY_UNAVAILABLE');
  const result=decision(context,{capability:'telephony.call-center',permission});
  if(!result.allowed)fail(result.code);
  return result;
}

async function subordinateIds(db,context){
  const role=context.membership.role;
  if(role==='owner'){
    const [rows]=await db.query("SELECT id AS membershipId FROM sx_memberships WHERE tenant_id=? AND role='agent' AND status='active'",[context.tenant.id]);
    return new Set(rows.map(row=>row.membershipId));
  }
  if(!['manager','team_leader'].includes(role))return new Set([context.membership.id]);
  const column=role==='manager'?'manager_membership_id':'team_leader_membership_id';
  const [rows]=await db.query(`SELECT h.membership_id AS membershipId FROM sx_sales_org_history h
    JOIN sx_memberships m ON m.tenant_id=h.tenant_id AND m.id=h.membership_id AND m.status='active'
    WHERE h.tenant_id=? AND h.${column}=? AND h.ended_at IS NULL`,[context.tenant.id,context.membership.id]);
  return new Set([context.membership.id,...rows.map(row=>row.membershipId)]);
}

async function callParticipants(db,context,callId){
  if(!UUID.test(callId||''))fail('INVALID_CALL_ID');
  const [[call]]=await db.query(`SELECT id,started_by_membership_id AS startedByMembershipId,
    answered_by_membership_id AS answeredByMembershipId FROM sx_telephony_calls WHERE tenant_id=? AND id=?`,[context.tenant.id,callId]);
  if(!call)fail('CALL_NOT_FOUND');
  const [legs]=await db.query(`SELECT DISTINCT membership_id AS membershipId FROM sx_telephony_call_legs
    WHERE tenant_id=? AND call_id=? AND membership_id IS NOT NULL`,[context.tenant.id,callId]);
  return new Set([call.startedByMembershipId,call.answeredByMembershipId,...legs.map(row=>row.membershipId)].filter(Boolean));
}

async function authorizeCall(db,context,callId,permission){
  const access=authorize(context,permission);
  const participants=await callParticipants(db,context,callId);
  if(access.scope==='tenant')return {participants,scope:await subordinateIds(db,context)};
  const scope=await subordinateIds(db,context);
  if(![...participants].some(id=>scope.has(id)))fail('CALL_NOT_FOUND');
  return {participants,scope};
}

async function list(db,context,callId){
  const access=await authorizeCall(db,context,callId,'calls.coaching.read');
  const isAgent=context.membership.role==='agent';
  const noteFilter=context.membership.role==='owner'?'':isAgent?'AND c.agent_membership_id=? AND c.visible_to_agent=1':'AND c.agent_membership_id IN (?)';
  const noteArgs=context.membership.role==='owner'?[context.tenant.id,callId]:isAgent?[context.tenant.id,callId,context.membership.id]:[context.tenant.id,callId,[...access.scope]];
  const [rows]=await db.query(`SELECT c.id,c.agent_membership_id AS agentMembershipId,a.display_name AS agentName,
    c.coach_membership_id AS coachMembershipId,x.display_name AS coachName,c.quality,c.feedback,c.next_action AS nextAction,
    c.visible_to_agent AS visibleToAgent,c.created_at AS createdAt
    FROM sx_telephony_call_coaching c
    JOIN sx_memberships am ON am.tenant_id=c.tenant_id AND am.id=c.agent_membership_id
    JOIN sx_identities a ON a.id=am.identity_id
    JOIN sx_memberships cm ON cm.tenant_id=c.tenant_id AND cm.id=c.coach_membership_id
    JOIN sx_identities x ON x.id=cm.identity_id
    WHERE c.tenant_id=? AND c.call_id=? ${noteFilter}
    ORDER BY c.created_at DESC,c.id DESC LIMIT 100`,noteArgs);
  const participantIds=[...access.participants].filter(id=>access.scope.has(id));
  const agents=participantIds.length?await db.query(`SELECT m.id AS membershipId,i.display_name AS displayName FROM sx_memberships m
    JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
    WHERE m.tenant_id=? AND m.status='active' AND m.role='agent' AND m.id IN (?) ORDER BY i.display_name,m.id`,[context.tenant.id,participantIds]).then(([items])=>items):[];
  return {items:rows.map(row=>({...row,visibleToAgent:!!row.visibleToAgent})),agents};
}

async function create(db,context,callId,input){
  const {participants,scope}=await authorizeCall(db,context,callId,'calls.coaching.write');
  if(context.membership.role==='agent'||context.membership.role==='accountant')fail('PERMISSION_DENIED');
  const agentMembershipId=typeof input?.agentMembershipId==='string'?input.agentMembershipId:'';
  const quality=typeof input?.quality==='string'?input.quality:'';
  const feedback=typeof input?.feedback==='string'?input.feedback.trim():'';
  const nextAction=typeof input?.nextAction==='string'?input.nextAction.trim():'';
  if(!UUID.test(agentMembershipId)||!participants.has(agentMembershipId))fail('INVALID_COACHING_AGENT');
  if(!qualities.has(quality))fail('INVALID_COACHING_QUALITY');
  if(feedback.length<5||feedback.length>3000)fail('INVALID_COACHING_FEEDBACK');
  if(nextAction.length>500)fail('INVALID_COACHING_ACTION');
  if(input?.visibleToAgent!==undefined&&typeof input.visibleToAgent!=='boolean')fail('INVALID_COACHING_VISIBILITY');
  const visibleToAgent=input?.visibleToAgent!==false;
  const [[agent]]=await db.query(`SELECT id FROM sx_memberships WHERE tenant_id=? AND id=? AND role='agent' AND status='active'`,[context.tenant.id,agentMembershipId]);
  if(!agent||!scope.has(agentMembershipId))fail('INVALID_COACHING_AGENT');
  const id=crypto.randomUUID();
  await db.beginTransaction();
  try{
    await db.query(`INSERT INTO sx_telephony_call_coaching(tenant_id,id,call_id,agent_membership_id,coach_membership_id,quality,feedback,next_action,visible_to_agent)
      VALUES(?,?,?,?,?,?,?,?,?)`,[context.tenant.id,id,callId,agentMembershipId,context.membership.id,quality,feedback,nextAction||null,visibleToAgent?1:0]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,reason,changes,correlation_id)
      VALUES(?,?,?,'identity','telephony.call-coaching.created','telephony-call-coaching',?,NULL,?,?)`,
      [crypto.randomUUID(),context.tenant.id,context.identity.id,id,JSON.stringify({callId,agentMembershipId,quality,visibleToAgent,feedbackLength:feedback.length,nextAction:!!nextAction}),crypto.randomUUID()]);
    await db.commit();
  }catch(error){await db.rollback();throw error;}
  return {id,callId,agentMembershipId,coachMembershipId:context.membership.id,quality,feedback,nextAction:nextAction||null,visibleToAgent,createdAt:new Date()};
}

module.exports={authorizeCall,list,create};
