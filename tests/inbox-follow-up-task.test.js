'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const tasks=require('../modules/platform/task-management');
const notifications=require('../modules/platform/task-notification-runner');

const context={tenantId:'11111111-1111-4111-8111-111111111111',uidHash:'a'.repeat(64),uid:'owner-uid',role:'owner',actorType:'identity',actorId:'owner-identity',tenant:{categoryKey:'training_center',categoryVersion:1},subscription:{capabilities:['team.tasks','crm.leads']}};

test('Inbox follow-up uses assigned agent and adds manager and owner observers',async()=>{
  const calls=[],chat={chat_id:'synthetic-chat',sender_name:'Synthetic lead',sender_mobile:'+97450000002',origin:'qr',origin_instance_unique_id:'qr-main',assigned_agent:JSON.stringify({id:7})};
  const db={beginTransaction:async()=>calls.push(['BEGIN']),commit:async()=>calls.push(['COMMIT']),rollback:async()=>calls.push(['ROLLBACK']),query:async(sql,args=[])=>{calls.push([sql,args]);
    if(sql.includes('SELECT chat_id,sender_name,sender_mobile,origin,origin_instance_unique_id,assigned_agent'))return [[chat],[]];
    if(sql.includes('SELECT a.id,a.name,a.email,a.owner_uid'))return [[{id:7,name:'Synthetic agent',email:'agent@example.test',owner_uid:'owner-uid',membershipId:'agent-membership'}],[]];
    if(sql.includes("m.role='owner'"))return [[{actorId:'owner-identity'}],[]];
    if(sql.includes('FROM sx_sales_org_history'))return [[{actorId:'manager-identity'}],[]];
    if(sql.includes('SELECT id FROM agents WHERE'))return [[{id:7}],[]];
    if(sql.includes('SELECT id FROM sx_memberships WHERE'))return [[{id:'active-membership'}],[]];
    if(sql.includes('FROM pipeline_leads'))return [[],[]];
    if(sql.includes('SELECT chat_id,sender_name,sender_mobile,origin,origin_instance_unique_id FROM beta_chats'))return [[chat],[]];
    return [{affectedRows:1,insertId:1},[]];
  }};
  const result=await tasks.createInboxFollowUp(db,context,{chatId:chat.chat_id,dueAt:'2026-10-23T10:00:00.000Z',details:'Discuss the requested course'});
  assert.equal(result.taskType,'general');assert.equal(result.dueAt,'2026-10-23T10:00:00.000Z');
  assert.deepEqual(result.participants,[{actorType:'agent',actorId:'7',role:'assignee'},{actorType:'identity',actorId:'owner-identity',role:'observer'},{actorType:'identity',actorId:'manager-identity',role:'observer'}]);
  const inserted=calls.find(([sql])=>String(sql).startsWith('INSERT INTO sx_tasks'));
  assert.equal(inserted[1][6],'inbox_chat');assert.equal(inserted[1][7],chat.chat_id);
  assert.equal(calls.filter(([sql])=>String(sql).startsWith('INSERT IGNORE INTO sx_task_notifications')).length,6);
  assert.equal(calls.at(-1)[0],'COMMIT');
});

test('assigned agents cannot create a task for a different agent conversation',async()=>{
  const db={query:async(sql)=>sql.includes('SELECT chat_id,sender_name,sender_mobile,origin,origin_instance_unique_id,assigned_agent')?[[{chat_id:'synthetic-chat',assigned_agent:'{"id":7}'}],[]]:sql.includes('SELECT a.id,a.name,a.email,a.owner_uid')?[[{id:7,name:'Agent',owner_uid:'owner-uid',membershipId:'agent-membership'}],[]]:[[],[]]};
  await assert.rejects(tasks.createInboxFollowUp(db,{...context,role:'agent',actorType:'agent',actorId:'8',agentId:8},{chatId:'synthetic-chat',dueAt:'2026-10-23T10:00:00.000Z'}),{code:'PERMISSION_DENIED',status:403});
});

test('follow-up notices use the chat QR instance and include lead, assignee, and local due date',async()=>{
  const calls=[],db={query:async(sql)=>{calls.push(sql);if(sql.includes('FROM sx_legacy_ownership'))return [[{uid:'owner-uid',number:'+97440000000'}],[]];if(sql.includes('FROM agents WHERE'))return [[{phone:'+97450000001'}],[]];throw new Error('Unexpected query');}};
  let sent;const result=await notifications.sendInboxFollowUpQr(db,{tenant_id:'tenant',source_id:'synthetic-chat',recipient_type:'agent',recipient_id:'7',title:'Follow up: Synthetic lead',description:'Lead: Synthetic lead\nWhatsApp: +97450000002\nAssigned agent: Synthetic agent',due_at:new Date('2026-10-23T08:00:00.000Z'),timezone:'Asia/Qatar',to_status:'open'},{env:{CRM_INTERNAL_SECRET:'test-secret',PORT:'3010'},http:{post:async(url,body,options)=>{sent={url,body,options};return {data:{success:true,data:{messageId:'synthetic-qr-message'}}};}}});
  assert.deepEqual(result,{accepted:'synthetic-qr-message'});
  assert.match(sent.url,/\/api\/internal\/qr\/send-text$/);assert.equal(sent.body.uid,'owner-uid');assert.equal(sent.body.from,'+97440000000');assert.equal(sent.body.to,'97450000001');
  assert.match(sent.body.text,/Synthetic lead/);assert.match(sent.body.text,/Synthetic agent/);assert.match(sent.body.text,/Follow-up date:.*Oct/);
  assert.equal(sent.options.headers['x-internal-secret'],'test-secret');assert.match(calls[0],/origin_instance_unique_id/);assert.match(calls[0],/status='ACTIVE'/);
});

test('existing Inbox shell loads the maintained follow-up adapter',()=>{
  const fs=require('node:fs'),path=require('node:path'),html=fs.readFileSync(path.join(__dirname,'../client/public/index.html'),'utf8');
  assert.match(html,/inbox-follow-up\.js\?v=/);
});
