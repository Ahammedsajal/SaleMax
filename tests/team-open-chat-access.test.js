'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const express=require('express');
const {createTeamInvitationRouters}=require('../modules/platform/team-invitation-router');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
test('open-chat check follows persisted transfer and rejects invalid account scope',async()=>{
  let assigned='manager',active=true,chat={origin:'qr',origin_instance_unique_id:'unshared-instance'};
  const pool={query:async(sql,args)=>{
    if(sql.includes('WHERE o.source_table'))return [[{tenantId:'tenant',tenantStatus:'active',categoryKey:'base_crm',categoryVersion:1,identityId:'manager',role:'manager',membershipStatus:active?'active':'inactive',identityStatus:'active',uidHash:hash('staff'),delegatedPermissions:[]}]];
    if(sql.includes("m.role='owner'"))return [[{uid:'owner',uidHash:hash('owner')}]];
    if(sql.includes('FROM sx_qr_channel_shares'))return [[{instanceId:7,uniqueId:'shared-instance'}]];
    if(sql.includes('FROM beta_chats')){assert.deepEqual(args,['owner','chat']);return [[{...chat,assigned_agent:JSON.stringify([{kind:'identity',identityId:assigned}])}]];}
    throw new Error('Unexpected query');
  }};
  const app=express();app.use('/team',createTeamInvitationRouters({pool,origin:'http://localhost',userGuard:(req,res,next)=>{req.decode={uid:'staff',userData:{uid:'staff',id:2}};next();}}).owner);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url='http://127.0.0.1:'+server.address().port+'/team/conversation-access';
  try{
    let response=await fetch(url+'?chatId=chat');assert.deepEqual((await response.json()).data,{allowed:true,assignedOnly:true});
    assigned='other';response=await fetch(url+'?chatId=chat');assert.deepEqual((await response.json()).data,{allowed:false,assignedOnly:true});
    // A shared QR conversation stays open even if it is not assigned to this manager.
    chat={origin:'qr',origin_instance_unique_id:'shared-instance'};
    response=await fetch(url+'?chatId=chat');assert.deepEqual((await response.json()).data,{allowed:true,assignedOnly:true});
    chat={origin:'qr',origin_instance_unique_id:'unshared-instance'};
    response=await fetch(url+'?chatId=chat');assert.deepEqual((await response.json()).data,{allowed:false,assignedOnly:true});
    chat={origin:'meta',origin_instance_unique_id:'shared-instance'};
    response=await fetch(url+'?chatId=chat');assert.deepEqual((await response.json()).data,{allowed:false,assignedOnly:true});
    active=false;response=await fetch(url+'?chatId=chat');assert.equal(response.status,403);
    response=await fetch(url);assert.equal(response.status,400);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
