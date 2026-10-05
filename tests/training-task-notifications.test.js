'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const runner=require('../modules/platform/task-notification-runner');
const runtime=require('../modules/platform/task-notification-worker-runtime');

test('task email worker requires explicit opt-in and complete SMTP configuration',()=>{
  assert.throws(()=>runner.config({}),{code:'TASK_EMAIL_DISABLED'});
  const env={SALEMAX_TASK_EMAIL_ENABLED:'true',SALEMAX_SMTP_HOST:'smtp.example.test',SALEMAX_SMTP_PORT:'587',SALEMAX_SMTP_USER:'worker',SALEMAX_SMTP_PASS:'secret',SALEMAX_TASK_EMAIL_FROM:'tasks@example.test'};
  assert.equal(runner.config(env).port,587);
  assert.throws(()=>runner.config({...env,SALEMAX_SMTP_PASS:''}),{code:'TASK_SMTP_NOT_CONFIGURED'});
});


test('production task worker starts without providers so unavailable notices are recorded instead of left queued',()=>{
  let received;
  const marker={pid:456};
  const child=runtime.start({env:{LOCAL_ONLY_MODE:'false'},root:'/app',executable:'/usr/bin/node',spawnProcess:(...args)=>{received=args;return marker;}});
  assert.equal(child,marker);
  assert.equal(received[0],'/usr/bin/node');
  assert.equal(received[1][0],'/app/scripts/task-notification-worker.cjs');
});

test('local-only mode never starts task email or WhatsApp delivery even when configured',()=>{
  let spawned=0;const env={LOCAL_ONLY_MODE:'true',SALEMAX_TASK_EMAIL_ENABLED:'true',SALEMAX_SMTP_HOST:'smtp.example.test',SALEMAX_SMTP_PORT:'587',SALEMAX_SMTP_USER:'worker',SALEMAX_SMTP_PASS:'secret',SALEMAX_TASK_EMAIL_FROM:'tasks@example.test',SALEMAX_TASK_WHATSAPP_TEMPLATE:'salemax_task_update'};
  assert.equal(runtime.start({env,spawnProcess:()=>{spawned++;return {};}}),null);assert.equal(spawned,0);
});

test('task email content escapes task text and can link back to the business panel',()=>{
  const rendered=runner.message({from:'tasks@example.test',to:'agent@example.test',title:'<Call & follow up>',status:'in_progress',dueAt:'2026-10-06 10:00',taskId:'task id',baseUrl:'https://crm.example.test/'});
  assert.match(rendered.subject,/Call & follow up/);
  assert.match(rendered.html,/&lt;Call &amp; follow up&gt;/);
  assert.doesNotMatch(rendered.html,/<Call/);
  assert.match(rendered.html,/user\?page=tasks&amp;task=task%20id/);
});

test('task notification claim uses tenant-active training tasks and fenced leases',async()=>{
  const calls=[],item={id:9,tenant_id:'11111111-1111-4111-8111-111111111111',task_id:'22222222-2222-4222-8222-222222222222',task_revision:2,recipient_type:'agent',recipient_id:'7',channel:'email',attempt_count:0,notification_status:'queued',title:'Follow up',due_at:null,to_status:'in_progress'};
  const db={beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),query:async(sql,args)=>{calls.push([sql,args]);if(sql.includes('SELECT n.id'))return [[item],[]];return [{affectedRows:1,insertId:1},[]];}};
  const claimed=await runner.claim(db,{workerId:'tasks-worker-1',limit:5,leaseSeconds:60});
  assert.equal(claimed.length,1);assert.equal(claimed[0].attempt,1);assert.equal(claimed[0].workerId,'tasks-worker-1');
  const select=calls.find(entry=>Array.isArray(entry)&&entry[0].includes('SELECT n.id'))[0];
  assert.match(select, /SELECT e\.to_status[\s\S]*ORDER BY e\.id DESC LIMIT 1/);
  assert.doesNotMatch(select, /JOIN sx_task_events/);
  assert.ok(calls.some(entry=>Array.isArray(entry)&&entry[0].includes('FOR UPDATE SKIP LOCKED')));
  assert.ok(calls.some(entry=>Array.isArray(entry)&&entry[0].includes('INSERT INTO sx_task_notification_attempts')));
  assert.equal(calls.at(-1),'commit');
});

test('unconfigured task notification channels are marked suppressed instead of left queued',async()=>{
  const calls=[],item={id:9,tenant_id:'tenant',task_id:'task',channel:'email',workerId:'tasks-worker-1',attempt:1};
  const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},query:async(sql,args=[])=>{calls.push([sql,args]);if(sql.includes('SELECT status,lease_owner,attempt_count'))return [[{status:'processing',lease_owner:item.workerId,attempt_count:1}],[]];return [{affectedRows:1},[]];}};
  const result=await runner.dispatch(db,item,{});
  assert.equal(result.status,'suppressed');
  const update=calls.find(([sql])=>sql.startsWith('UPDATE sx_task_notifications SET status='));
  assert.equal(update[1][0],'suppressed');
  assert.equal(update[1][3],'TASK_EMAIL_NOT_CONFIGURED');
});

test('WhatsApp dispatch requires an approved template and posts only a template message',async()=>{
  assert.equal(runner.whatsappConfig({}),null);
  const wa=runner.whatsappConfig({SALEMAX_TASK_WHATSAPP_TEMPLATE:'salemax_task_update'});assert.deepEqual(wa,{template:'salemax_task_update',language:'en_US',version:'v24.0'});
  const calls=[];const db={query:async(sql,args)=>{calls.push([sql,args]);if(sql.includes('FROM sx_task_notification_preferences'))return [[{whatsappOptIn:1}],[]];if(sql.includes('FROM sx_memberships'))return [[{phone:'+97450000102',owner_uid:'owner'}],[]];if(sql.includes('FROM meta_api'))return [[{access_token:'private-test-token',business_phone_number_id:'123456789'}],[]];throw new Error('unexpected query')}};
  let sent;
  const result=await runner.sendWhatsapp(db,{recipient_type:'identity',recipient_id:'identity',tenant_id:'tenant',title:'Call learner',to_status:'in_progress',due_at:null},{config:wa,http:{post:async(...args)=>{sent=args;return {data:{messages:[{id:'wamid.test'}]}}}}});
  assert.deepEqual(result,{accepted:'wamid.test'});assert.match(sent[0],/123456789\/messages$/);assert.equal(sent[1].type,'template');assert.equal(sent[1].to,'97450000102');assert.equal(sent[1].template.name,'salemax_task_update');assert.equal(sent[1].template.components[0].parameters[0].text,'Call learner');assert.match(sent[2].headers.Authorization,/private-test-token/);
});

test('WhatsApp task delivery is suppressed until each recipient opts in',async()=>{
  const calls=[];let posted=false;const db={query:async(sql,args)=>{calls.push([sql,args]);if(sql.includes('sx_task_notification_preferences'))return [[{whatsappOptIn:0}],[]];throw new Error('must not resolve/send without opt-in')}};
  const wa=runner.whatsappConfig({SALEMAX_TASK_WHATSAPP_TEMPLATE:'salemax_task_update'});
  const result=await runner.sendWhatsapp(db,{tenant_id:'tenant',recipient_type:'agent',recipient_id:'7',title:'Check in',to_status:'open',due_at:null},{config:wa,http:{post:async()=>{posted=true}}});
  assert.deepEqual(result,{suppressed:'TASK_WHATSAPP_OPT_IN_REQUIRED'});assert.equal(posted,false);assert.equal(calls.length,1);
});
