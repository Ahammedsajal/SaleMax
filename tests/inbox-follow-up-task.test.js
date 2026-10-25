'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const tasks=require('../modules/platform/task-management');
const notifications=require('../modules/platform/task-notification-runner');

const context={tenantId:'11111111-1111-4111-8111-111111111111',uidHash:'a'.repeat(64),uid:'owner-uid',role:'owner',actorType:'identity',actorId:'owner-identity',tenant:{categoryKey:'training_center',categoryVersion:1},subscription:{capabilities:['team.tasks','crm.leads']}};

test('Inbox follow-up assigns every current agent and observes manager and owner',async()=>{
  const calls=[],digest=uid=>require('node:crypto').createHash('sha256').update(uid).digest('hex');
  const staff=[7,8].map(id=>({identityId:`agent-${id}`,name:`Synthetic agent ${id}`,email:`agent${id}@example.test`,uid:`agent-uid-${id}`,legacyId:id,sourceTable:'agents',role:'agent',uidHash:digest(`agent-uid-${id}`),membershipId:`agent-membership-${id}`}));
  const chat={chat_id:'synthetic-chat',sender_name:'Synthetic lead',sender_mobile:'+97450000002',origin:'qr',origin_instance_unique_id:'qr-main',assigned_agent:JSON.stringify([{identityId:'agent-7',uid:'agent-uid-7',id:7},{identityId:'agent-8',uid:'agent-uid-8',id:8}])};
  const db={beginTransaction:async()=>calls.push(['BEGIN']),commit:async()=>calls.push(['COMMIT']),rollback:async()=>calls.push(['ROLLBACK']),query:async(sql,args=[])=>{calls.push([sql,args]);
    if(sql.includes('SELECT chat_id,sender_name,sender_mobile,origin,origin_instance_unique_id,assigned_agent')){
      if(sql.includes("origin='qr'"))return [[chat],[]];
      return args[1]===chat.chat_id?[[chat],[]]:[[],[]];
    }
    if(sql.includes('SELECT i.id AS identityId'))return [staff,[]];
    if(sql.includes("WHERE m.tenant_id=? AND m.role='owner'"))return [[{actorId:'owner-identity'}],[]];
    if(sql.includes('FROM sx_sales_org_history'))return [[{actorId:args[1]==='agent-membership-7'?'manager-identity':'manager-identity'}],[]];
    if(sql.includes('SELECT a.id,a.uid,o.legacy_uid_hash')){const id=Number(args[1]);return [[{id,uid:`agent-uid-${id}`,uidHash:digest(`agent-uid-${id}`)}],[]];}
    if(sql.includes('SELECT id FROM sx_memberships WHERE'))return [[{id:'active-membership'}],[]];
    if(sql.includes('FROM sx_tasks t WHERE t.tenant_id=? AND t.source_type=?'))return [[],[]];
    if(sql.includes('FROM pipeline_leads'))return [[],[]];
    if(sql.includes('SELECT chat_id,sender_name,sender_mobile,origin,origin_instance_unique_id FROM beta_chats'))return [[chat],[]];
    return [{affectedRows:1,insertId:1},[]];
  }};
  const result=await tasks.createInboxFollowUp(db,context,{chatId:'97450000002',dueAt:'2026-10-23T10:00:00.000Z',details:'Discuss the requested course'});
  assert.equal(result.taskType,'general');assert.equal(result.dueAt,'2026-10-23T10:00:00.000Z');
  assert.deepEqual(result.participants,[{actorType:'agent',actorId:'7',role:'assignee'},{actorType:'agent',actorId:'8',role:'assignee'},{actorType:'identity',actorId:'owner-identity',role:'observer'},{actorType:'identity',actorId:'manager-identity',role:'observer'}]);
  const inserted=calls.find(([sql])=>String(sql).startsWith('INSERT INTO sx_tasks'));
  assert.match(inserted?.[1]?.[4]||'',/Synthetic agent 7, Synthetic agent 8/);
  assert.equal(inserted[1][6],'inbox_chat');assert.equal(inserted[1][7],chat.chat_id);
  assert.equal(calls.filter(([sql])=>String(sql).startsWith('INSERT IGNORE INTO sx_task_notifications')).length,8);
  assert.equal(calls.at(-1)[0],'COMMIT');
  assert.ok(calls.some(([sql])=>sql.includes("origin='qr'")),'phone identifier should resolve through the tenant QR conversation');
});

test('repeated Inbox follow-up returns the nearest matching open task and does not queue duplicate notices',async()=>{
  const calls=[],hash=uid=>require('node:crypto').createHash('sha256').update(uid).digest('hex');
  const chat={chat_id:'synthetic-chat',sender_name:'Synthetic lead',sender_mobile:'+97450000002',origin:'qr',origin_instance_unique_id:'qr-main',assigned_agent:JSON.stringify([{identityId:'agent-7',uid:'agent-uid-7',id:7}])};
  const existing={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',revision:1,status:'open',title:'Follow up: Synthetic lead',taskType:'general',priority:'normal',dueAt:new Date('2026-10-23T10:00:00.000Z')};
  const db={beginTransaction:async()=>calls.push(['BEGIN']),commit:async()=>calls.push(['COMMIT']),rollback:async()=>calls.push(['ROLLBACK']),query:async(sql,args=[])=>{calls.push([sql,args]);
    if(sql.includes('SELECT chat_id,sender_name,sender_mobile,origin,origin_instance_unique_id,assigned_agent'))return [[chat],[]];
    if(sql.includes('SELECT i.id AS identityId'))return [[{identityId:'agent-7',name:'Synthetic agent 7',email:'agent7@example.test',uid:'agent-uid-7',legacyId:7,sourceTable:'agents',role:'agent',uidHash:hash('agent-uid-7'),membershipId:'agent-membership-7'}],[]];
    if(sql.includes("WHERE m.tenant_id=? AND m.role='owner'"))return [[{actorId:'owner-identity'}],[]];
    if(sql.includes('FROM sx_sales_org_history'))return [[{actorId:'manager-identity'}],[]];
    if(sql.includes('SELECT id FROM sx_memberships WHERE'))return [[{id:'active-membership'}],[]];
    if(sql.includes('FROM pipeline_leads'))return [[],[]];
    if(sql.includes('FROM sx_tasks t WHERE t.tenant_id=? AND t.source_type=?'))return [[existing],[]];
    return [{affectedRows:1,insertId:1},[]];
  }};
  const result=await tasks.createInboxFollowUp(db,context,{chatId:chat.chat_id,dueAt:'2026-10-23T10:05:00.000Z',details:'Discuss the requested course'});
  assert.equal(result.id,existing.id);assert.equal(result.duplicate,true);
  const dedupe=calls.find(([sql])=>String(sql).includes('FROM sx_tasks t WHERE t.tenant_id=? AND t.source_type=?'));
  assert.deepEqual(dedupe[1],[context.tenantId,'inbox_chat',chat.chat_id,'general','2026-10-23 10:05:00.000','2026-10-23 10:05:00.000','Follow-up details: Discuss the requested course','Assigned agents: Synthetic agent 7','2026-10-23 10:05:00.000']);
  assert.equal(calls.some(([sql])=>String(sql).startsWith('INSERT INTO sx_tasks')),false);
  assert.equal(calls.some(([sql])=>String(sql).startsWith('INSERT IGNORE INTO sx_task_notifications')),false);
  assert.equal(calls.at(-1)[0],'COMMIT');
});

test('phone fallback rejects ambiguous QR conversations instead of choosing one',async()=>{
  const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},query:async(sql)=>{
    if(sql.includes('SELECT chat_id,sender_name,sender_mobile,origin,origin_instance_unique_id,assigned_agent')){
      if(sql.includes("origin='qr'"))return [[{chat_id:'chat-1'},{chat_id:'chat-2'}],[]];
      return [[],[]];
    }
    return [[],[]];
  }};
  await assert.rejects(tasks.createInboxFollowUp(db,context,{chatId:'+974 5000 0002',dueAt:'2026-10-23T10:00:00.000Z'}),{code:'CHAT_ID_AMBIGUOUS',status:409});
});

test('assigned agents cannot create a task for a different agent conversation',async()=>{
  const hash=require('node:crypto').createHash('sha256').update('agent-uid-7').digest('hex');
  const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},query:async(sql)=>sql.includes('SELECT chat_id,sender_name,sender_mobile,origin,origin_instance_unique_id,assigned_agent')?[[{chat_id:'synthetic-chat',assigned_agent:'[{"id":7,"uid":"agent-uid-7"}]'}],[]]:sql.includes('SELECT i.id AS identityId')?[[{identityId:'agent-7',name:'Agent',email:'agent@example.test',uid:'agent-uid-7',legacyId:7,sourceTable:'agents',role:'agent',uidHash:hash}]]:[[],[]]};
  await assert.rejects(tasks.createInboxFollowUp(db,{...context,role:'agent',actorType:'agent',actorId:'8',agentId:8},{chatId:'synthetic-chat',dueAt:'2026-10-23T10:00:00.000Z'}),{code:'PERMISSION_DENIED',status:403});
});

test('follow-up notices use the chat QR instance and include lead, assignee, and local due date',async()=>{
  const calls=[],db={query:async(sql)=>{calls.push(sql);if(sql.includes('FROM sx_legacy_ownership'))return [[{uid:'owner-uid',number:'+97440000000'}],[]];if(sql.includes('SELECT a.mobile AS phone'))return [[{phone:'+97450000001'}],[]];throw new Error('Unexpected query');}};
  let sent;const result=await notifications.sendInboxFollowUpQr(db,{tenant_id:'tenant',source_type:'inbox_chat',source_id:'synthetic-chat',recipient_type:'agent',recipient_id:'7',title:'Follow up: Synthetic lead',description:'Lead: Synthetic lead\nWhatsApp: +97450000002\nAssigned agent: Synthetic agent',due_at:new Date('2026-10-23T08:00:00.000Z'),timezone:'Asia/Qatar',to_status:'open'},{env:{CRM_INTERNAL_SECRET:'test-secret',PORT:'3010'},http:{post:async(url,body,options)=>{sent={url,body,options};return {data:{success:true,data:{messageId:'synthetic-qr-message'}}};}}});
  assert.deepEqual(result,{accepted:'synthetic-qr-message'});
  assert.match(sent.url,/\/api\/internal\/qr\/send-text$/);assert.equal(sent.body.uid,'owner-uid');assert.equal(sent.body.from,'+97440000000');assert.equal(sent.body.to,'97450000001');
  assert.match(sent.body.text,/Synthetic lead/);assert.match(sent.body.text,/Synthetic agent/);assert.match(sent.body.text,/Follow-up date:.*Oct/);
  assert.equal(sent.options.headers['x-internal-secret'],'test-secret');assert.match(calls[0],/origin_instance_unique_id/);assert.match(calls[0],/status='ACTIVE'/);assert.ok(calls.some(sql=>sql.includes('sx_memberships')));
});

test('existing Inbox shell loads the maintained follow-up adapter',()=>{
  const fs=require('node:fs'),path=require('node:path'),html=fs.readFileSync(path.join(__dirname,'../client/public/index.html'),'utf8');
  assert.match(html,/inbox-follow-up\.js\?v=20261022-follow-up-dedupe1/);
  const adapter=fs.readFileSync(path.join(__dirname,'../client/public/inbox-follow-up.js'),'utf8');
  assert.match(adapter,/requestHeaders\.set\('Content-Type','application\/json'\)/);
  assert.match(adapter,/\/user\?page=tasks&task=\$\{encodeURIComponent\(task\.id\)\}/);
  assert.match(adapter,/A matching follow-up task already exists/);
  assert.doesNotMatch(adapter,/setTimeout\(\(\)=>d\.close\(\),900\)/);
  assert.doesNotMatch(adapter,/Object\.fromEntries\(new Headers\(headers\)\)/);
});

test('Inbox follow-up uses the selected conversation ID and validates the visible contact number',()=>{
  const {chatIdFromCurrentChat}=require('../client/public/inbox-follow-up-chat-id');
  assert.equal(chatIdFromCurrentChat({chat_id:'97450000002@s.whatsapp.net',sender_mobile:'+974 5000 0002'},'+97450000002'),'97450000002@s.whatsapp.net');
  assert.equal(chatIdFromCurrentChat({chat_id:'synthetic-chat',sender_mobile:'+97450000002'},'+97450000002'),'synthetic-chat');
  assert.equal(chatIdFromCurrentChat({chat_id:'other-chat',sender_mobile:'+97450000003'},'+97450000002'),null);
  assert.equal(chatIdFromCurrentChat(null,'+97450000002'),null);
});
