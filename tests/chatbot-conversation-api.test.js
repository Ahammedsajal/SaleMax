'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const express=require('express');
const {createChatbotRouter}=require('../modules/platform/chatbot-router');
const {getCategory}=require('../modules/platform/categories');
test('chat controls resolve owned scope without assignment, reject wrong numbers and denied staff, and support both sessions',async()=>{
 let row=null, role='owner';
 const ctx=()=>({audience:'tenant',identity:{id:'synthetic-identity',status:'active'},tenant:{id:'synthetic-tenant',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'synthetic-membership',tenantId:'synthetic-tenant',role,status:'active',delegatedPermissions:[]},category:getCategory('training_center',1),subscription:{status:'active',capabilities:['automation.chatbot']},runtimeReady:{}});
 const db={release(){},beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},query:async(sql,args)=>{
  if(sql.includes('SELECT u.uid')) return [[{uid:'synthetic-owner',uidHash:require('node:crypto').createHash('sha256').update('synthetic-owner').digest('hex')}]];
  if(sql.includes('FROM beta_chats'))return [args[1]==='owned'?[{origin:'qr',origin_instance_unique_id:'number-1'}]:[]];
  if(sql.includes('FROM meta_api'))return [[]];
  if(sql.includes('FROM instance'))return [[{reference:'number-1',label:'97455000001'},{reference:'number-2',label:'97455000002'}]];
  if(sql.includes('SELECT c.mode'))return [row?[{...row,isActive:row.mode==='paused',revision:row.revision}]:[]];
  if(sql.includes('SELECT id,mode,revision'))return [row?[row]:[]];
  if(sql.includes('INSERT INTO sx_chatbot_conversation_controls')){row={id:'control-1',mode:args[5],revision:args[8]};return [{}];}
  if(sql.includes('INSERT INTO sx_audit_events'))return [{}];
  throw Error('unexpected query '+sql);
 }};
 const app=express();
 app.use('/api/workspace/chatbots',createChatbotRouter({pool:{getConnection:async()=>db},origin:'http://localhost',userGuard:(req,res,next)=>{req.decode={uid:'synthetic-owner'};req.featureSession={context:ctx()};next();},canonicalGuard:(req,res,next)=>{req.businessContext=ctx();next();}}));
 app.use((error,req,res,next)=>res.status(400).json({success:false,code:error.code||error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}/api/workspace/chatbots`;
 const get=async(path,bearer=true)=>{const res=await fetch(base+path,{signal:AbortSignal.timeout(5000),headers:bearer?{Authorization:'Bearer synthetic'}:{}});return res.json();};
 try{
  for(const bearer of [true,false])assert.deepEqual((await get('/conversations/owned/bot-scope',bearer)).data.scope,{channelKind:'whatsapp_qr',channelRef:'number-1'});
  assert.equal((await get('/conversations/foreign/bot-scope')).code,'CONVERSATION_NOT_FOUND');
  assert.equal((await get('/conversations/owned/bot-control?channelKind=whatsapp_qr&channelRef=number-2')).code,'INVALID_CONVERSATION_CHANNEL');
  assert.equal((await get('/conversations/owned/bot-control?channelKind=whatsapp_qr&channelRef=number-1')).data.mode,'inherit');
  const res=await fetch(base+'/conversations/owned/bot-control',{method:'PUT',signal:AbortSignal.timeout(5000),headers:{Authorization:'Bearer synthetic',Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({channelKind:'whatsapp_qr',channelRef:'number-1',mode:'paused',expectedRevision:0})});
  assert.equal((await res.json()).data.mode,'paused');
  role='accountant';assert.equal((await get('/conversations/owned/bot-scope')).success,false);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
