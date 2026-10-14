'use strict';

const pipeline=require('../../helper/pipeline/leadPipeline');
const pipelineActors=require('./legacy-pipeline-actor');
const callCoaching=require('./telephony-call-coaching');
const {decision}=require('./policy');
const fail=code=>{throw Object.assign(new Error(code),{code});};

function normalizeInput(input,{categoryKey}={}){
  const outcomes=new Set(['no_answer','connected','interested','not_interested','follow_up_scheduled','wrong_number','requested_call','sale_requested',...(categoryKey==='salemax_sales'?['do_not_call']:[])]);
  if(!input||typeof input!=='object'||Array.isArray(input)||!outcomes.has(input.outcome))fail('INVALID_CALL_OUTCOME');
  if(input.followUpRequired!==undefined&&typeof input.followUpRequired!=='boolean')fail('INVALID_CALL_OUTCOME');
  if(input.followUpRequired&&typeof input.nextFollowUpAt!=='string')fail('INVALID_CALL_OUTCOME');
  if(input.nextFollowUpAt!==undefined&&input.nextFollowUpAt!==null&&typeof input.nextFollowUpAt!=='string')fail('INVALID_CALL_OUTCOME');
  if(input.followUpRequired!==true&&input.nextFollowUpAt!==undefined&&input.nextFollowUpAt!==null)fail('INVALID_CALL_OUTCOME');
  if(input.note!==undefined&&typeof input.note!=='string')fail('INVALID_CALL_OUTCOME');
  const note=String(input.note||'').trim();if(note.length>2000)fail('INVALID_CALL_OUTCOME');
  if(input.outcome==='do_not_call'){
    if(input.followUpRequired===true||input.nextFollowUpAt!==undefined&&input.nextFollowUpAt!==null)fail('INVALID_CALL_OUTCOME');
    return {outcome:input.outcome,note,followUpRequired:false,nextFollowUpAt:null};
  }
  return {outcome:input.outcome,note,
    ...(input.followUpRequired===true?{followUpRequired:true,nextFollowUpAt:input.nextFollowUpAt}:{})};
}

async function actorForMembership(db,pool,context){
  const role=context.membership.role,sourceTable=role==='agent'?'agents':'user';
  const [links]=await db.query(`SELECT source_id AS sourceId FROM sx_legacy_ownership
    WHERE tenant_id=? AND membership_id=? AND source_table=? LIMIT 2`,[context.tenant.id,context.membership.id,sourceTable]);
  if(links.length!==1)fail('BUSINESS_LINK_INVALID');
  let actor;
  if(sourceTable==='agents'){
    const [rows]=await db.query('SELECT id,uid,owner_uid,email,password,role,is_active FROM agents WHERE id=? LIMIT 2',[Number(links[0].sourceId)]);
    if(rows.length!==1)fail('BUSINESS_LINK_INVALID');
    actor=await pipelineActors.resolveAgent(pool,rows[0]);
  }else{
    const [rows]=await db.query('SELECT id,uid,email,password,role FROM user WHERE id=? LIMIT 2',[Number(links[0].sourceId)]);
    if(rows.length!==1)fail('BUSINESS_LINK_INVALID');
    actor=await pipelineActors.resolve(pool,rows[0]);
  }
  if(!actor||actor.denied)fail(actor?.code||'BUSINESS_LINK_INVALID');
  if(actor.categoryKey!=='salemax_sales'||actor.tenantId!==context.tenant.id||actor.membershipId!==context.membership.id
    ||actor.identityId!==context.identity.id||actor.role!==role)fail('BUSINESS_LINK_INVALID');
  return actor;
}

function createTelephonyCallOutcomes(pool,{pipelineService=pipeline,scopeCall=callCoaching.authorizeCall,resolveActor=actorForMembership}={}){
  return {async log(db,context,callId,input){
    const callAccess=decision(context,{capability:'telephony.call-center',permission:'calls.read'});
    if(!callAccess.allowed)fail(callAccess.code);
    const leadAccess=decision(context,{capability:'crm.leads',permission:'leads.manage'});
    if(!leadAccess.allowed)fail(leadAccess.code);
    await scopeCall(db,context,callId,'calls.coaching.read');
    const [[call]]=await db.query(`SELECT lead_id AS leadId,status FROM sx_telephony_calls WHERE tenant_id=? AND id=? LIMIT 1`,[context.tenant.id,callId]);
    if(!call)fail('CALL_NOT_FOUND');
    if(!call.leadId)fail('CALL_LEAD_NOT_LINKED');
    if(!['ended','failed'].includes(call.status))fail('CALL_NOT_FINISHED');
    const actor=await resolveActor(db,pool,context);
    const data=normalizeInput(input,{categoryKey:actor.categoryKey});
    await pipelineService.updateLead({uid:actor.uid,id:call.leadId,input:data,actorType:actor.actorType,
      actorId:actor.actorId,role:actor.role,agentId:actor.agentId,scopeAgentIds:actor.scopeAgentIds,categoryKey:actor.categoryKey},pool);
    return {callId,leadId:call.leadId,outcome:data.outcome,followUpRequired:data.followUpRequired===true};
  }};
}

module.exports={createTelephonyCallOutcomes,normalizeInput};
