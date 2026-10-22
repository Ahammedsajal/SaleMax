'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {resolveLeadLink,resolveOutboundRecipient}=require('../modules/platform/telephony-call-leads');
const {AsteriskCallControl}=require('../modules/platform/asterisk-call-control');
const {salemaxSales}=require('../modules/platform/categories');

const tenantId='11111111-1111-4111-8111-111111111111';
const leadId='22222222-2222-4222-8222-222222222222';
const ownerUid='owner-uid';
const uidHash=crypto.createHash('sha256').update(ownerUid).digest('hex');
function context(role='owner'){
  return {tenant:{id:tenantId,categoryKey:'7network_sales'},membership:{id:`${role}-membership`,role}};
}
function dbFor(role,{ownerCount=1,agentCount=1,leadOwnerAgentId=41,leadMobile='+919876543210',leadSuppressed=false}={}){
  return {async query(sql){
    if(sql.includes('SELECT u.uid,o.legacy_uid_hash'))return [[...Array(ownerCount)].map(()=>({uid:ownerUid,legacyUidHash:uidHash})),[]];
    if(sql.includes('SELECT a.id,a.uid,o.legacy_uid_hash'))return [[...Array(agentCount)].map((_,index)=>({id:41+index,uid:'agent-uid',legacyUidHash:crypto.createHash('sha256').update('agent-uid').digest('hex')})),[]];
    if(sql.includes('SELECT DISTINCT a.id,a.uid,o.legacy_uid_hash'))return [[{id:41,uid:'agent-uid',legacyUidHash:crypto.createHash('sha256').update('agent-uid').digest('hex')}],[]];
    if(sql.includes('SELECT id,owner_agent_id,mobile FROM pipeline_leads'))return [[{id:leadId,owner_agent_id:leadOwnerAgentId,mobile:leadMobile}],[]];
    if(sql.includes('FROM pipeline_activity'))return [[...(leadSuppressed?[{id:1}]:[])],[]];
    throw new Error(`Unexpected lead authorization query: ${sql}`);
  }};
}

test('owner can link a lead from the same business to a call',async()=>{
  const result=await resolveLeadLink(dbFor('owner'),context('owner'),leadId);
  assert.deepEqual(result,{leadId,leadUidHash:uidHash,destination:'+919876543210'});
});

test('agent can link only leads assigned to its active 7Network membership',async()=>{
  const result=await resolveLeadLink(dbFor('agent'),context('agent'),leadId);
  assert.deepEqual(result,{leadId,leadUidHash:uidHash,destination:'+919876543210'});
  await assert.rejects(resolveLeadLink(dbFor('agent',{leadOwnerAgentId:99}),context('agent'),leadId),{code:'CALL_LEAD_NOT_ACCESSIBLE'});
});

test('Sales outbound calls require an accessible lead and use its server-side phone',async()=>{
  let queried=false;const noLeadDb={async query(){queried=true;return [[],[]];}};
  await assert.rejects(resolveOutboundRecipient(noLeadDb,context('agent'),{destination:'+919999999999'}),{code:'OUTBOUND_LEAD_REQUIRED'});
  assert.equal(queried,false,'unlinked Sales calls are rejected before any call setup query');
  const recipient=await resolveOutboundRecipient(dbFor('agent'),context('agent'),{leadId,destination:'+919999999999'});
  assert.equal(recipient.destination,'+919876543210');
  assert.equal(recipient.leadLink.leadId,leadId);
});

test('Sales outbound calls are blocked after the lead has a recorded do-not-call outcome',async()=>{
  await assert.rejects(resolveOutboundRecipient(dbFor('agent',{leadSuppressed:true}),context('agent'),{leadId}),{code:'CALL_LEAD_DO_NOT_CALL'});
});

test('Asterisk call origination rejects an unlinked 7Network Sales call before database or PBX work',async()=>{
  let accessed=false;const control=new AsteriskCallControl({pool:{async getConnection(){accessed=true;throw new Error('unexpected database access');}}});
  const callContext={audience:'tenant',identity:{id:'agent-identity'},tenant:{id:tenantId,status:'active',categoryKey:'7network_sales',categoryVersion:1},
    membership:{id:'agent-membership',tenantId,role:'agent',status:'active'},category:salemaxSales,subscription:{status:'active',capabilities:['telephony.call-center']}};
  await assert.rejects(control.originateOutbound(callContext,{destination:'+919999999999',clientType:'mobile'}),{code:'OUTBOUND_LEAD_REQUIRED'});
  await assert.rejects(control.originateOutbound({...callContext,tenant:{...callContext.tenant,categoryKey:'salemax_sales'}},{destination:'+919999999999',clientType:'mobile'}),{code:'OUTBOUND_LEAD_REQUIRED'});
  assert.equal(accessed,false);
});

test('Sales lead calls reject missing or non-E.164 numbers',async()=>{
  await assert.rejects(resolveLeadLink(dbFor('agent',{leadMobile:''}),context('agent'),leadId),{code:'CALL_LEAD_PHONE_INVALID'});
  await assert.rejects(resolveLeadLink(dbFor('agent',{leadMobile:'00919876543210'}),context('agent'),leadId),{code:'CALL_LEAD_PHONE_INVALID'});
});

test('non-Sales categories retain manual outbound destinations',async()=>{
  const regular={...context('owner'),tenant:{id:tenantId,categoryKey:'training_center'}};
  const recipient=await resolveOutboundRecipient({async query(){throw new Error('manual call should not resolve a Sales lead');}},regular,{destination:'+97455551234'});
  assert.deepEqual(recipient,{leadLink:null,destination:'+97455551234'});
});

test('inaccessible and malformed lead identifiers fail closed before call creation',async()=>{
  let queried=false;const db={async query(){queried=true;return [[],[]];}};
  await assert.rejects(resolveLeadLink(db,context('owner'),'not-a-uuid'),{code:'INVALID_CALL_LEAD_ID'});
  assert.equal(queried,false);
  await assert.rejects(resolveLeadLink(db,{...context(),tenant:{id:tenantId,categoryKey:'training_center'}},leadId),{code:'CALL_LEAD_CATEGORY_UNAVAILABLE'});
});

test('manager and team leader lead links are checked against current organization scope',async()=>{
  for(const role of ['manager','team_leader']){
    const statements=[];const db=dbFor(role);const original=db.query;
    db.query=async(sql,...args)=>{statements.push(sql);return original(sql,...args);};
    const result=await resolveLeadLink(db,context(role),leadId);
    assert.equal(result.leadId,leadId);
    const scope=statements.find(sql=>sql.includes('FROM sx_sales_org_history'));
    assert.ok(scope);assert.match(scope,role==='manager'?/manager_membership_id/:/team_leader_membership_id/);
  }
});

test('the existing Pipeline opens Call Center with a lead, verifies it, and submits the authorized lead association',()=>{
  const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');
  const pipeline=fs.readFileSync(path.join(root,'client/public/pipeline/pipeline.js'),'utf8');
  const entry=fs.readFileSync(path.join(root,'client/public/pipeline-entry.js'),'utf8');
  const calls=fs.readFileSync(path.join(root,'client/public/call-center/call-center.js'),'utf8');
  const callControl=fs.readFileSync(path.join(root,'modules/platform/asterisk-call-control.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'client/public/call-center/index.html'),'utf8');
  assert.match(pipeline,/page=call-center&lead=\$\{encodeURIComponent\(id\)\}/);
  assert.match(entry,/expectedSource='\/call-center\/\?embed=1'\+\(leadId\?/);
  assert.match(calls,/api\/pipeline\/leads\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(calls,/\{destination,clientType,\.\.\.\(linkedLeadId\?\{leadId:linkedLeadId\}/);
  assert.match(callControl,/callLeads\.resolveOutboundRecipient\(db,context,input\)/);
  assert.match(callControl,/destination: recipient\.destination/);
  assert.match(calls,/OUTBOUND_LEAD_REQUIRED:text\('Open an accessible lead/);
  assert.match(html,/id="leadCallContext"/);
});
