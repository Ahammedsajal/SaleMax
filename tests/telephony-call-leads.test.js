'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {resolveLeadLink}=require('../modules/platform/telephony-call-leads');

const tenantId='11111111-1111-4111-8111-111111111111';
const leadId='22222222-2222-4222-8222-222222222222';
const ownerUid='owner-uid';
const uidHash=crypto.createHash('sha256').update(ownerUid).digest('hex');
function context(role='owner'){
  return {tenant:{id:tenantId,categoryKey:'salemax_sales'},membership:{id:`${role}-membership`,role}};
}
function dbFor(role,{ownerCount=1,agentCount=1,leadOwnerAgentId=41}={}){
  return {async query(sql){
    if(sql.includes('SELECT u.uid,o.legacy_uid_hash'))return [[...Array(ownerCount)].map(()=>({uid:ownerUid,legacyUidHash:uidHash})),[]];
    if(sql.includes('SELECT a.id,a.uid,o.legacy_uid_hash'))return [[...Array(agentCount)].map((_,index)=>({id:41+index,uid:'agent-uid',legacyUidHash:crypto.createHash('sha256').update('agent-uid').digest('hex')})),[]];
    if(sql.includes('SELECT DISTINCT a.id,a.uid,o.legacy_uid_hash'))return [[{id:41,uid:'agent-uid',legacyUidHash:crypto.createHash('sha256').update('agent-uid').digest('hex')}],[]];
    if(sql.includes('SELECT id,owner_agent_id FROM pipeline_leads'))return [[{id:leadId,owner_agent_id:leadOwnerAgentId}],[]];
    throw new Error(`Unexpected lead authorization query: ${sql}`);
  }};
}

test('owner can link a lead from the same business to a call',async()=>{
  const result=await resolveLeadLink(dbFor('owner'),context('owner'),leadId);
  assert.deepEqual(result,{leadId,leadUidHash:uidHash});
});

test('agent can link only leads assigned to its active SaleMaX membership',async()=>{
  const result=await resolveLeadLink(dbFor('agent'),context('agent'),leadId);
  assert.deepEqual(result,{leadId,leadUidHash:uidHash});
  await assert.rejects(resolveLeadLink(dbFor('agent',{leadOwnerAgentId:99}),context('agent'),leadId),{code:'CALL_LEAD_NOT_ACCESSIBLE'});
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
  const html=fs.readFileSync(path.join(root,'client/public/call-center/index.html'),'utf8');
  assert.match(pipeline,/page=call-center&lead=\$\{encodeURIComponent\(id\)\}/);
  assert.match(entry,/expectedSource='\/call-center\/\?embed=1'\+\(leadId\?/);
  assert.match(calls,/api\/pipeline\/leads\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(calls,/\{destination,clientType,\.\.\.\(linkedLeadId\?\{leadId:linkedLeadId\}/);
  assert.match(html,/id="leadCallContext"/);
});
