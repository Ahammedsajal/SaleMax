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
        answeredByMembershipId:'agent-membership-1',startedByMembershipId:'agent-membership-1',hasAssignedActiveLeg:0}],[]];
      throw new Error(`Unexpected Call Center query: ${sql}`);
    }};
    const context={audience:'tenant',identity:{id:`identity-${role}`},tenant:{id:tenantId,status:'active',categoryKey:'salemax_sales',categoryVersion:1},
      membership:{id:selfId,tenantId,role,status:'active'},category:getCategory('salemax_sales',1),subscription:{status:'active',capabilities:['telephony.call-center']}};
    const app=express();app.use('/call-center',createCallCenterRouter({pool:{async getConnection(){return db;}},userGuard(){throw new Error('legacy guard should not run')},canonicalGuard(req,_res,next){req.businessContext=context;next();},origin:'http://127.0.0.1'}));
    const server=http.createServer(app);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const response=await fetch(`http://127.0.0.1:${server.address().port}/call-center/calls`),body=await response.json();
    assert.equal(response.status,200);assert.equal(body.data.items.length,1);assert.equal(body.data.items[0].canControl,true);
    const scopeQuery=calls.find(item=>item.sql.includes('FROM sx_sales_org_history h'));
    assert.match(scopeQuery.sql,role==='manager'?/manager_membership_id/ : /team_leader_membership_id/);
    const listQuery=calls.find(item=>item.sql.includes('SELECT c.id,c.direction,c.status'));
    assert.match(listQuery.sql,/c\.started_by_membership_id IN \(\?\)/);assert.match(listQuery.sql,/c\.answered_by_membership_id IN \(\?\)/);assert.match(listQuery.sql,/scoped_leg\.membership_id IN \(\?\)/);
    assert.deepEqual(listQuery.args.slice(-3),[teamIds,teamIds,teamIds]);
  }
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
