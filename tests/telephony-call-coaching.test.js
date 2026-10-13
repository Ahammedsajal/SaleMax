'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const http=require('node:http');
const coaching=require('../modules/platform/telephony-call-coaching');
const policy=require('../modules/platform/policy');
const {getCategory}=require('../modules/platform/categories');
const {createCallCenterRouter}=require('../modules/platform/call-center-router');

const tenantId='11111111-1111-4111-8111-111111111111';
const callId='22222222-2222-4222-8222-222222222222';
const agentId='33333333-3333-4333-8333-333333333333';
function context(role='owner',options={}){
  const membershipId=options.membershipId||'44444444-4444-4444-8444-444444444444';
  return {audience:'tenant',identity:{id:'55555555-5555-4555-8555-555555555555'},tenant:{id:tenantId,status:'active',categoryKey:options.category||'salemax_sales',categoryVersion:1},
    membership:{id:membershipId,tenantId,role,status:'active',...(options.customPermissions?{customPermissions:options.customPermissions}:{})},
    category:getCategory(options.category||'salemax_sales',1),subscription:{status:'active',capabilities:['telephony.call-center']}};
}

test('call coaching permissions are scoped to sales leads and prevent accountants and agents from writing',()=>{
  assert.equal(policy.decision(context('owner'),{capability:'telephony.call-center',permission:'calls.coaching.write'}).scope,'tenant');
  assert.equal(policy.decision(context('manager'),{capability:'telephony.call-center',permission:'calls.coaching.write'}).scope,'sales');
  assert.equal(policy.decision(context('team_leader'),{capability:'telephony.call-center',permission:'calls.coaching.write'}).scope,'team');
  assert.equal(policy.decision(context('agent'),{capability:'telephony.call-center',permission:'calls.coaching.write'}).allowed,false);
  assert.equal(policy.decision(context('accountant'),{capability:'telephony.call-center',permission:'calls.coaching.read'}).allowed,false);
  assert.equal(policy.decision(context('team_leader',{customPermissions:[]}),{capability:'telephony.call-center',permission:'calls.coaching.write'}).allowed,false);
});

test('coaching notes require a call participant in current team scope and audit metadata without note contents',async()=>{
  const queries=[];let transaction=false,committed=false,rolledBack=false;
  const db={async query(sql,args){queries.push({sql,args});
    if(sql.includes('FROM sx_telephony_calls WHERE'))return [[{id:callId,startedByMembershipId:agentId,answeredByMembershipId:agentId}],[]];
    if(sql.includes('FROM sx_telephony_call_legs'))return [[],[]];
    if(sql.includes('FROM sx_sales_org_history h'))return [[{membershipId:agentId}],[]];
    if(sql.includes('SELECT id AS membershipId'))return [[{membershipId:agentId}],[]];
    if(sql.includes("role='agent' AND status='active'"))return [[{id:agentId}],[]];
    if(sql.includes('INSERT INTO sx_telephony_call_coaching'))return [{affectedRows:1},[]];
    if(sql.includes('INSERT INTO sx_audit_events'))return [{affectedRows:1},[]];
    throw new Error(`Unexpected query: ${sql}`);
  },async beginTransaction(){transaction=true;},async commit(){committed=true;},async rollback(){rolledBack=true;}};
  const manager=context('team_leader');
  const result=await coaching.create(db,manager,callId,{agentMembershipId:agentId,quality:'needs_improvement',feedback:'Confirm the customer need before presenting the package.',nextAction:'Practice the discovery checklist.',visibleToAgent:true});
  assert.ok(transaction&&committed&&!rolledBack);assert.equal(result.callId,callId);assert.equal(result.visibleToAgent,true);
  const audit=queries.find(row=>row.sql.includes('INSERT INTO sx_audit_events'));
  assert.ok(audit);assert.equal(audit.args[4].includes('Confirm the customer need'),false);assert.equal(audit.args[4].includes('feedbackLength'),true);
});

test('coaching rejects malformed note, unrelated call participant, and out-of-scope agent without writes',async()=>{
  const db={async query(sql){
    if(sql.includes('FROM sx_telephony_calls WHERE'))return [[{id:callId,startedByMembershipId:agentId,answeredByMembershipId:agentId}],[]];
    if(sql.includes('FROM sx_telephony_call_legs'))return [[],[]];
    if(sql.includes('FROM sx_sales_org_history h'))return [[{membershipId:agentId}],[]];
    if(sql.includes("role='agent' AND status='active'"))return [[{id:agentId}],[]];
    throw new Error(`Unexpected query: ${sql}`);
  }};
  await assert.rejects(coaching.create(db,context('manager'),callId,{agentMembershipId:agentId,quality:'bad',feedback:'This is long enough.'}),error=>error.code==='INVALID_COACHING_QUALITY');
  await assert.rejects(coaching.create(db,context('manager'),callId,{agentMembershipId:'66666666-6666-4666-8666-666666666666',quality:'effective',feedback:'This is long enough.'}),error=>error.code==='INVALID_COACHING_AGENT');
  await assert.rejects(coaching.create(db,context('agent'),callId,{agentMembershipId:agentId,quality:'effective',feedback:'This is long enough.'}),error=>error.code==='PERMISSION_DENIED');
});

test('coaching readers only see notes for agents in their current reporting scope',async()=>{
  const leader=context('team_leader'),queries=[];
  const db={async query(sql,args){queries.push({sql,args});
    if(sql.includes('FROM sx_telephony_calls WHERE'))return [[{id:callId,startedByMembershipId:agentId,answeredByMembershipId:agentId}],[]];
    if(sql.includes('FROM sx_telephony_call_legs'))return [[],[]];
    if(sql.includes('FROM sx_sales_org_history h'))return [[{membershipId:agentId}],[]];
    if(sql.includes('FROM sx_telephony_call_coaching c'))return [[],[]];
    if(sql.includes("m.role='agent'"))return [[],[]];
    throw new Error(`Unexpected query: ${sql}`);
  }};
  await coaching.list(db,leader,callId);
  const notes=queries.find(row=>row.sql.includes('FROM sx_telephony_call_coaching c'));
  assert.match(notes.sql,/c\.agent_membership_id IN \(\?\)/);assert.ok(notes.args[2].includes(agentId));assert.ok(notes.args[2].includes(leader.membership.id));
});

test('Call Center exposes the audited coaching API to owners and denies agent writes',async t=>{
  let writes=0;
  const db={release(){},async beginTransaction(){},async commit(){},async rollback(){},async query(sql){
    if(sql.includes('FROM sx_telephony_calls WHERE'))return [[{id:callId,startedByMembershipId:agentId,answeredByMembershipId:agentId}],[]];
    if(sql.includes('FROM sx_telephony_call_legs'))return [[],[]];
    if(sql.includes('SELECT id AS membershipId'))return [[{membershipId:agentId}],[]];
    if(sql.includes("role='agent' AND status='active'"))return [[{id:agentId}],[]];
    if(sql.includes('INSERT INTO sx_telephony_call_coaching')||sql.includes('INSERT INTO sx_audit_events')){writes++;return [{affectedRows:1},[]];}
    throw new Error(`Unexpected query: ${sql}`);
  }};
  const buildServer=ctx=>{
    const app=express();app.use('/call-center',createCallCenterRouter({pool:{async getConnection(){return db;}},userGuard(){throw new Error('unexpected legacy auth');},canonicalGuard(req,_res,next){req.businessContext=ctx;next();},origin:'http://127.0.0.1'}));
    const server=http.createServer(app);return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server));});
  };
  const ownerServer=await buildServer(context('owner'));t.after(()=>new Promise(resolve=>ownerServer.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${ownerServer.address().port}/call-center/calls/${callId}/coaching`,{method:'POST',headers:{Origin:'http://127.0.0.1','Content-Type':'application/json'},body:JSON.stringify({agentMembershipId:agentId,quality:'effective',feedback:'The agent listened and confirmed the requirement.'})});
  const result=await response.json();assert.equal(response.status,201,JSON.stringify(result));assert.equal(result.data.callId,callId);assert.equal(writes,2);
  const agentServer=await buildServer(context('agent'));t.after(()=>new Promise(resolve=>agentServer.close(resolve)));
  const denied=await fetch(`http://127.0.0.1:${agentServer.address().port}/call-center/calls/${callId}/coaching`,{method:'POST',headers:{Origin:'http://127.0.0.1','Content-Type':'application/json'},body:JSON.stringify({agentMembershipId:agentId,quality:'effective',feedback:'An agent must not self-author coaching.'})});
  assert.equal(denied.status,403);assert.equal((await denied.json()).code,'PERMISSION_DENIED');assert.equal(writes,2);
});
