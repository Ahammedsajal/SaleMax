'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createTaskRouter}=require('../modules/platform/task-router');

test('task router parses JSON before dispatching its Inbox follow-up POST',async t=>{
  const tenantId='11111111-1111-4111-8111-111111111111';
  const context={tenantId,uidHash:'a'.repeat(64),uid:'owner-uid',role:'owner',actorType:'identity',actorId:'owner-identity'};
  const db={beginTransaction:async()=>{},rollback:async()=>{},release(){},query:async sql=>{
    if(sql.includes('SELECT chat_id,sender_name,sender_mobile,origin,origin_instance_unique_id,assigned_agent'))return [[],[]];
    throw new Error('Unexpected database query after expected not-found result');
  }};
  const app=express();
  app.use('/api/workspace/tasks',createTaskRouter({pool:{getConnection:async()=>db},contextFor:async()=>context}));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/workspace/tasks/inbox-follow-up`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chatId:'synthetic-chat',dueAt:'2026-10-23T10:00:00.000Z'})
  });
  assert.equal(response.status,404);
  assert.deepEqual(await response.json(),{success:false,code:'CHAT_NOT_FOUND'});
});
