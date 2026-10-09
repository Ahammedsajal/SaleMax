'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),express=require('express');
const {createTeamInvitationRouters}=require('../modules/platform/team-invitation-router');
const {transfer}=require('../modules/platform/agent-conversation-transfer');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function fixture(){
  let assigned='agent-one',commits=0,rollbacks=0;
  const query=async(sql,args)=>{
    if(sql.includes('WHERE o.source_table'))return [[{tenantId:'tenant',tenantStatus:'active',identityId:'agent-one',role:'agent',membershipStatus:'active',identityStatus:'active',uidHash:hash('one'),delegatedPermissions:[]}]];
    if(sql.includes("m.role='owner'") && !sql.includes('FROM sx_memberships m JOIN sx_identities'))return [[{uid:'owner',uidHash:hash('owner')}]];
    if(sql.includes('SELECT assigned_agent')||sql.includes('SELECT * FROM beta_chats'))return [[{assigned_agent:JSON.stringify([{kind:'identity',identityId:assigned}])}]];
    if(sql.includes('FROM sx_memberships m JOIN sx_identities'))return [[{identityId:'agent-two',name:'Agent Two',uid:'two',role:'agent',uidHash:hash('two')}]];
    if(sql.startsWith('UPDATE beta_chats')){assigned=JSON.parse(args[0])[0].identityId;return [{affectedRows:1}];}
    if(sql.startsWith('INSERT INTO sx_audit_events'))return [{affectedRows:1}];
    throw Error('Unexpected SQL');
  };
  const db={query,beginTransaction:async()=>{},commit:async()=>{commits++;},rollback:async()=>{rollbacks++;},release:()=>{}};
  return {pool:{query,getConnection:async()=>db},setAssigned:x=>{assigned=x;},state:()=>({assigned,commits,rollbacks})};
}
const user={id:1,uid:'one',owner_uid:'owner',isAgent:true,is_active:1};
test('actual Agent transfer service commits a singleton target, notifies both views and denies stale transfer',async()=>{
  const f=fixture(),events=[];
  const result=await transfer(f.pool,user,'chat','agent-two',(...args)=>events.push(args));
  assert.equal(result.assignee.name,'Agent Two');assert.deepEqual(f.state(),{assigned:'agent-two',commits:1,rollbacks:0});
  assert.deepEqual(events.map(e=>[e[0],e[2]]),[['owner','request_update_chat_list'],['owner','request_update_opened_chat']]);
  await assert.rejects(transfer(f.pool,user,'chat','agent-two',()=>assert.fail('unauthorized notification')),{code:'TEAM_INBOX_PERMISSION_DENIED'});
});
test('Agent staff endpoint exposes minimal staff choices only for currently assigned chat and transfer rejects foreign Origin',async()=>{
  const f=fixture(),app=express(),origin='https://crm.example.test';
  const guard=(req,res,next)=>{req.decode={uid:'one',userData:user};next();};
  app.use('/agent',createTeamInvitationRouters({pool:f.pool,origin,userGuard:guard,agentGuard:guard}).accept);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port+'/agent/';
  try{
    let response=await fetch(url+'conversation-staff?chatId=chat');assert.deepEqual((await response.json()).data,{staff:[{identityId:'agent-two',name:'Agent Two'}]});
    f.setAssigned('other');response=await fetch(url+'conversation-staff?chatId=chat');assert.equal(response.status,403);
    response=await fetch(url+'conversation-transfer',{method:'POST',headers:{Origin:'https://other.example.test','Content-Type':'application/json'},body:JSON.stringify({chatId:'chat',identityId:'agent-two'})});assert.equal(response.status,403);assert.equal(f.state().commits,0);
    response=await fetch(url+'conversation-staff');assert.equal(response.status,400);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
