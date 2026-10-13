'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {getCategory}=require('../modules/platform/categories');
const {createTelephonyCallOutcomes,normalizeInput}=require('../modules/platform/telephony-call-outcomes');
const dateTime=require('../client/public/pipeline/timezone-datetime');

const context=()=>({audience:'tenant',identity:{id:'identity-agent'},tenant:{id:'tenant-sales',status:'active',categoryKey:'salemax_sales',categoryVersion:1},
  membership:{id:'agent-membership',tenantId:'tenant-sales',role:'agent',status:'active'},category:getCategory('salemax_sales',1),
  subscription:{status:'active',capabilities:['telephony.call-center','crm.leads']}});

test('call outcome save is tenant scoped and delegates lead scope to the Sales Pipeline service',async()=>{
  const writes=[];const db={async query(sql,args){assert.match(sql,/sx_telephony_calls/);assert.deepEqual(args,['tenant-sales','call-1']);return [[{leadId:'lead-1',status:'ended'}],[]];}};
  const service=createTelephonyCallOutcomes({}, {scopeCall:async(_db,ctx,id,permission)=>{assert.equal(ctx.membership.id,'agent-membership');assert.equal(id,'call-1');assert.equal(permission,'calls.coaching.read');},resolveActor:async()=>({uid:'owner-uid',role:'agent',actorType:'agent',actorId:'agent-row-id',agentId:12,scopeAgentIds:[12]}),pipelineService:{async updateLead(...args){writes.push(args);}}});
  const result=await service.log(db,context(),'call-1',{outcome:'follow_up_scheduled',followUpRequired:true,nextFollowUpAt:'2026-10-15T04:30:00.000Z',note:'Send proposal'});
  assert.deepEqual(result,{callId:'call-1',leadId:'lead-1',outcome:'follow_up_scheduled',followUpRequired:true});
  assert.equal(writes.length,1);assert.equal(writes[0][0].uid,'owner-uid');assert.equal(writes[0][0].id,'lead-1');
  assert.equal(writes[0][0].input.nextFollowUpAt,'2026-10-15T04:30:00.000Z');assert.deepEqual(writes[0][0].scopeAgentIds,[12]);
});

test('call outcomes cannot be saved for an unlinked or unfinished call',async()=>{
  for(const row of [{leadId:null,status:'ended'},{leadId:'lead-1',status:'connected'}]){
    const db={async query(){return [[row],[]];}};
    const service=createTelephonyCallOutcomes({}, {scopeCall:async()=>{},resolveActor:async()=>{throw new Error('must not resolve')},pipelineService:{async updateLead(){throw new Error('must not update');}}});
    await assert.rejects(service.log(db,context(),'call-1',{outcome:'connected',followUpRequired:false}),error=>error.code===(row.leadId?'CALL_NOT_FINISHED':'CALL_LEAD_NOT_LINKED'));
  }
});

test('call outcome form is in Call Center and uses the existing scoped outcome API and timezone helper',()=>{
  const root=path.join(__dirname,'..');const ui=fs.readFileSync(path.join(root,'client/public/call-center/call-center.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'client/public/call-center/index.html'),'utf8');const api=fs.readFileSync(path.join(root,'modules/platform/call-center-router.js'),'utf8');
  assert.match(ui,/Log call outcome/);assert.match(ui,/\/calls\/\$\{encodeURIComponent\(call\.callId\)\}\/lead-outcome/);
  assert.match(ui,/SaleMaXDateTime\.fromInput\(due\.value,tenantTimezone\)/);assert.match(ui,/updateLeadFromCall|lead-outcome/);
  assert.match(html,/sales-design-tokens\.css[\s\S]*call-center\.css/);assert.match(html,/timezone-datetime\.js[\s\S]*call-center\.js/);
  assert.match(api,/calls\/:callId\/lead-outcome/);assert.match(api,/SELECT timezone FROM sx_tenants/);
});

test('Sales follow-up entry treats typed time as Asia/Kolkata local time',()=>{
  const instant=dateTime.fromInput('2026-10-15T10:00','Asia/Kolkata');
  assert.equal(instant,'2026-10-15T04:30:00.000Z');
  assert.equal(dateTime.toInput(instant,'Asia/Kolkata'),'2026-10-15T10:00');
});

test('outcome input rejects unsupported dispositions, invalid follow-up types and oversized notes',()=>{
  assert.throws(()=>normalizeInput({outcome:'forged',followUpRequired:false}),{code:'INVALID_CALL_OUTCOME'});
  assert.throws(()=>normalizeInput({outcome:'connected',followUpRequired:'false'}),{code:'INVALID_CALL_OUTCOME'});
  assert.throws(()=>normalizeInput({outcome:'connected',followUpRequired:false,note:'x'.repeat(2001)}),{code:'INVALID_CALL_OUTCOME'});
});

test('logging an outcome without scheduling a follow-up preserves the existing reminder',()=>{
  assert.deepEqual(normalizeInput({outcome:'connected',note:'Reached the lead'}),{outcome:'connected',note:'Reached the lead'});
  assert.deepEqual(normalizeInput({outcome:'connected',followUpRequired:true,nextFollowUpAt:'2026-10-15T04:30:00.000Z'}),
    {outcome:'connected',note:'',followUpRequired:true,nextFollowUpAt:'2026-10-15T04:30:00.000Z'});
});
