'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const http=require('node:http');
const {createCallCenterRouter}=require('../modules/platform/call-center-router');
const {AsteriskCallControl}=require('../modules/platform/asterisk-call-control');
const {getCategory}=require('../modules/platform/categories');

test('SaleMaX Sales managers and team leaders receive only calls belonging to current reporting memberships',async t=>{
  for(const role of ['manager','team_leader']){
    const tenantId='11111111-1111-4111-8111-111111111111',selfId=`${role}-membership`,teamIds=[selfId,'agent-membership-1','agent-membership-2'];
    const calls=[];
    const db={release(){},async query(sql,args=[]){calls.push({sql,args});
      if(sql.includes('FROM sx_sales_org_history h'))return [[...teamIds.map(membershipId=>({membershipId}))],[]];
      if(sql.includes('SELECT c.id,c.direction,c.status'))return [[{id:'scoped-team-call',direction:'outbound',status:'connected',gatewayChannelNo:1,
        queueName:null,startedAt:'2026-10-13T09:00:00.000Z',answeredAt:'2026-10-13T09:00:05.000Z',endedAt:null,durationSeconds:12,
        answeredByMembershipId:'agent-membership-1',startedByMembershipId:'agent-membership-1',answeredByName:'Agent One',answeredByRole:'agent',
        startedByName:'Agent One',startedByRole:'agent',callOutcomeDetails:JSON.stringify({outcome:'interested',followUpRequired:true,nextFollowUpAt:'2026-10-16 10:00:00.000',note:'Asked for details'}),hasAssignedActiveLeg:0}],[]];
      throw new Error(`Unexpected Call Center query: ${sql}`);
    }};
    const context={audience:'tenant',identity:{id:`identity-${role}`},tenant:{id:tenantId,status:'active',categoryKey:'salemax_sales',categoryVersion:1},
      membership:{id:selfId,tenantId,role,status:'active'},category:getCategory('salemax_sales',1),subscription:{status:'active',capabilities:['telephony.call-center']}};
    const app=express();app.use('/call-center',createCallCenterRouter({pool:{async getConnection(){return db;}},userGuard(){throw new Error('legacy guard should not run')},canonicalGuard(req,_res,next){req.businessContext=context;next();},origin:'http://127.0.0.1'}));
    const server=http.createServer(app);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const response=await fetch(`http://127.0.0.1:${server.address().port}/call-center/calls?recordedOnly=1`),body=await response.json();
    assert.equal(response.status,200);assert.equal(body.data.items.length,1);assert.equal(body.data.items[0].canControl,true);
    assert.equal(body.data.items[0].answeredByName,'Agent One');assert.equal(body.data.items[0].answeredByRole,'agent');
    assert.equal(body.data.items[0].startedByName,'Agent One');assert.equal(body.data.items[0].startedByRole,'agent');
    assert.deepEqual(body.data.items[0].outcome,{outcome:'interested',followUpRequired:true,nextFollowUpAt:'2026-10-16 10:00:00.000',note:'Asked for details'});
    const scopeQuery=calls.find(item=>item.sql.includes('FROM sx_sales_org_history h'));
    assert.match(scopeQuery.sql,role==='manager'?/manager_membership_id/ : /team_leader_membership_id/);
    const listQuery=calls.find(item=>item.sql.includes('SELECT c.id,c.direction,c.status'));
    assert.match(listQuery.sql,/r\.state='ready' AND r\.expires_at>UTC_TIMESTAMP\(3\)/);
    assert.match(listQuery.sql,/c\.started_by_membership_id IN \(\?\)/);assert.match(listQuery.sql,/c\.answered_by_membership_id IN \(\?\)/);assert.match(listQuery.sql,/scoped_leg\.membership_id IN \(\?\)/);
    assert.match(listQuery.sql,/answered_member\.tenant_id=c\.tenant_id AND answered_member\.id=c\.answered_by_membership_id/);
    assert.match(listQuery.sql,/started_member\.tenant_id=c\.tenant_id AND started_member\.id=c\.started_by_membership_id/);
    assert.match(listQuery.sql,/pa\.uid_hash=c\.lead_uid_hash/);assert.match(listQuery.sql,/CASE WHEN JSON_VALID\(pa\.details\) THEN JSON_UNQUOTE\(JSON_EXTRACT\(pa\.details,'\$\.sourceCallId'\)\) ELSE NULL END/);
    assert.deepEqual(listQuery.args.slice(-3),[teamIds,teamIds,teamIds]);
    const invalidFilter=await fetch(`http://127.0.0.1:${server.address().port}/call-center/calls?recordedOnly=yes`),invalidBody=await invalidFilter.json();
    assert.equal(invalidFilter.status,400);assert.equal(invalidBody.code,'INVALID_CALL_FILTER');
  }
});

test('call review roster and per-agent history remain limited to current manager teams',async t=>{
  const tenantId='11111111-1111-4111-8111-111111111111',managerId='22222222-2222-4222-8222-222222222222',agentId='33333333-3333-4333-8333-333333333333',otherAgentId='44444444-4444-4444-8444-444444444444',queries=[];
  const db={release(){},async query(sql,args=[]){queries.push({sql,args});
    if(sql.includes('SELECT id AS membershipId FROM sx_memberships'))return [[{membershipId:managerId},{membershipId:agentId}],[]];
    if(sql.includes('SELECT m.id AS membershipId,i.display_name AS displayName'))return [[{membershipId:agentId,displayName:'Scoped Agent'}],[]];
    if(sql.includes('SELECT id FROM sx_memberships WHERE tenant_id=? AND id=? AND role=\'agent\''))return [[{id:agentId}],[]];
    if(sql.includes('SELECT c.id,c.direction,c.status'))return [[{id:'55555555-5555-4555-8555-555555555555',direction:'outbound',status:'ended',gatewayChannelNo:1,startedAt:'2026-10-14T09:00:00.000Z',answeredAt:null,endedAt:null,durationSeconds:20,startedByMembershipId:agentId,answeredByMembershipId:agentId,startedByName:'Scoped Agent',startedByRole:'agent',answeredByName:'Scoped Agent',answeredByRole:'agent',recordingState:'ready',recordingExpiresAt:new Date(Date.now()+86400000),hasAssignedActiveLeg:0}],[]];
    throw new Error(`Unexpected call review query: ${sql}`);
  }};
  const context={audience:'tenant',identity:{id:'identity-manager'},tenant:{id:tenantId,status:'active',categoryKey:'salemax_sales',categoryVersion:1},membership:{id:managerId,tenantId,role:'manager',status:'active'},category:getCategory('salemax_sales',1),subscription:{status:'active',capabilities:['telephony.call-center']}};
  const app=express();app.use('/call-center',createCallCenterRouter({pool:{async getConnection(){return db;}},userGuard(){throw new Error('legacy guard should not run')},canonicalGuard(req,_res,next){req.businessContext=context;next();},origin:'http://127.0.0.1'}));
  const server=http.createServer(app);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}/call-center`;
  const rosterResponse=await fetch(`${base}/calls/agents`),roster=await rosterResponse.json();assert.equal(rosterResponse.status,200);assert.deepEqual(roster.data.agents,[{membershipId:agentId,displayName:'Scoped Agent'}]);
  const rosterQuery=queries.find(item=>item.sql.includes('SELECT m.id AS membershipId,i.display_name AS displayName'));assert.match(rosterQuery.sql,/h\.manager_membership_id=\?/);assert.deepEqual(rosterQuery.args,[tenantId,managerId]);
  const filteredResponse=await fetch(`${base}/calls?agentMembershipId=${agentId}&recordedOnly=1`),filtered=await filteredResponse.json();assert.equal(filteredResponse.status,200);assert.equal(filtered.data.items.length,1);
  const historyQuery=queries.find(item=>item.sql.includes('SELECT c.id,c.direction,c.status'));assert.match(historyQuery.sql,/selected_leg\.membership_id=\?/);assert.deepEqual(historyQuery.args.slice(-3),[agentId,agentId,agentId]);
  const beforeDenied=queries.length,deniedResponse=await fetch(`${base}/calls?agentMembershipId=${otherAgentId}`),denied=await deniedResponse.json();assert.equal(deniedResponse.status,403);assert.equal(denied.code,'PERMISSION_DENIED');assert.equal(queries.length,beforeDenied+1,'out-of-team agent is denied before querying call records');
  const invalidFilter=await fetch(`${base}/calls?agentMembershipId=${agentId}&agentMembershipId=${otherAgentId}`),invalidFilterBody=await invalidFilter.json();assert.equal(invalidFilter.status,400);assert.equal(invalidFilterBody.code,'INVALID_CALL_FILTER');
});

test('Call Center identifies the assigned staff member beside each call and recording controls',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const root=path.join(__dirname,'..'),ui=fs.readFileSync(path.join(root,'client/public/call-center/call-center.js'),'utf8'),html=fs.readFileSync(path.join(root,'client/public/call-center/index.html'),'utf8');
  assert.match(ui,/call\.answeredByName\|\|call\.startedByName/);
  assert.match(ui,/Handled by/);
  assert.match(ui,/call\.answeredByRole\|\|call\.startedByRole/);
  assert.match(ui,/Load older calls/);
  assert.match(ui,/params\.set\('cursor',cursor\)/);
  assert.match(ui,/if\(callHistory\.recordingsOnly\)params\.set\('recordedOnly','1'\)/);
  assert.match(ui,/params\.set\('agentMembershipId',callHistory\.agentMembershipId\)/);
  assert.match(ui,/request\('\/calls\/agents'\)/);
  assert.match(html,/call-center\.js\?v=20261014-call-outcome-review1/);
  assert.match(html,/id="recordingsOnly"/);
  assert.match(html,/id="agentReviewFilter"/);
});

test('Call Center call history loads older pages with a stable tenant-scoped cursor',async t=>{
  const tenantId='11111111-1111-4111-8111-111111111111',memberId='22222222-2222-4222-8222-222222222222',queries=[];
  const makeRow=index=>({id:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,direction:'outbound',status:'ended',gatewayChannelNo:1,
    startedAt:new Date(Date.UTC(2026,9,14,1,0,100-index)),cursorStartedAt:`2026-10-14 01:00:${String(100-index).padStart(2,'0')}.000000`,
    answeredAt:null,endedAt:null,durationSeconds:null,answeredByMembershipId:memberId,startedByMembershipId:memberId,
    answeredByName:'Agent One',answeredByRole:'agent',startedByName:'Agent One',startedByRole:'agent',recordingState:'not_recorded',hasAssignedActiveLeg:0});
  const db={release(){},async query(sql,args=[]){
    queries.push({sql,args});
    if(!sql.includes('SELECT c.id,c.direction,c.status'))throw new Error(`Unexpected call history query: ${sql}`);
    if(sql.includes('c.started_at < ?'))return [[makeRow(101)],[]];
    return [[...Array.from({length:101},(_,index)=>makeRow(index+1))],[]];
  }};
  const context={audience:'tenant',identity:{id:'identity-owner'},tenant:{id:tenantId,status:'active',categoryKey:'salemax_sales',categoryVersion:1},
    membership:{id:memberId,tenantId,role:'owner',status:'active'},category:getCategory('salemax_sales',1),subscription:{status:'active',capabilities:['telephony.call-center']}};
  const app=express();app.use('/call-center',createCallCenterRouter({pool:{async getConnection(){return db;}},userGuard(){throw new Error('legacy guard should not run')},canonicalGuard(req,_res,next){req.businessContext=context;next();},origin:'http://127.0.0.1'}));
  const server=http.createServer(app);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const first=await fetch(`http://127.0.0.1:${server.address().port}/call-center/calls`),firstBody=await first.json();
  assert.equal(first.status,200);assert.equal(firstBody.data.items.length,100);assert.equal(firstBody.data.hasMore,true);assert.ok(firstBody.data.nextCursor);
  assert.doesNotMatch(JSON.stringify(firstBody.data),/cursorStartedAt/);
  const invalid=await fetch(`http://127.0.0.1:${server.address().port}/call-center/calls?cursor=not-a-cursor`);
  assert.equal(invalid.status,400);assert.equal(queries.length,1,'invalid cursors are rejected before a database query');
  const second=await fetch(`http://127.0.0.1:${server.address().port}/call-center/calls?cursor=${encodeURIComponent(firstBody.data.nextCursor)}`),secondBody=await second.json();
  assert.equal(second.status,200);assert.equal(secondBody.data.items.length,1);assert.equal(secondBody.data.hasMore,false);assert.equal(secondBody.data.nextCursor,null);
  assert.match(queries[1].sql,/c\.started_at < \? OR \(c\.started_at = \? AND c\.id < \?\)/);
  assert.deepEqual(queries[1].args.slice(6,9),['2026-10-14 01:00:00.000000','2026-10-14 01:00:00.000000',makeRow(100).id]);
});

test('Sales managers and team leaders cannot end a call outside their current organisation scope',async()=>{
  const tenantId='11111111-1111-4111-8111-111111111111',callId='22222222-2222-4222-8222-222222222222';
  for(const role of ['manager','team_leader']){
    const selfId=`${role}-membership`;let ariRequested=false;
    const db={release(){},async beginTransaction(){},async commit(){},async rollback(){},async query(sql){
      if(sql.includes('FROM sx_telephony_calls'))return [[{direction:'outbound',status:'connected',started_by_membership_id:'other-agent',
        answered_by_membership_id:'other-agent',inbound_channel_id:null,bridge_id:null}],[]];
      if(sql.includes('FROM sx_memberships WHERE tenant_id=? AND id=? AND status=\'active\''))return [[{membershipId:selfId}],[]];
      if(sql.includes('FROM sx_sales_org_history h'))return [[{membershipId:selfId}],[]];
      if(sql.includes('FROM sx_telephony_call_legs'))return [[],[]];
      throw new Error(`Unexpected call-control query: ${sql}`);
    }};
    const context={audience:'tenant',identity:{id:`identity-${role}`},tenant:{id:tenantId,status:'active',categoryKey:'salemax_sales',categoryVersion:1},
      membership:{id:selfId,tenantId,role,status:'active'},category:getCategory('salemax_sales',1),subscription:{status:'active',capabilities:['telephony.call-center']}};
    const control=new AsteriskCallControl({pool:{async getConnection(){return db;}},ariClientFactory(){ariRequested=true;return {};}});
    await assert.rejects(control.endCall(context,callId),error=>error.code==='PERMISSION_DENIED');
    assert.equal(ariRequested,false);
  }
});
