'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const tasks=require('../modules/platform/task-management');
const {createTaskContext}=require('../modules/platform/training-task-context');
const linkedRecords=require('../modules/platform/task-linked-records');
const {trainingCenter,restaurantFixture}=require('../modules/platform/categories');

const ctx={tenantId:'11111111-1111-4111-8111-111111111111',uidHash:'a'.repeat(64),uid:'owner-uid',role:'owner',actorType:'identity',actorId:'22222222-2222-4222-8222-222222222222'};

test('invoice follow-up source calculates the open balance with exact minor-unit arithmetic and tenant scope',async()=>{
  let call;const db={query:async(sql,args)=>{call={sql,args};return [[{id:'33333333-3333-4333-8333-333333333333',invoice_number:'INV-12',status:'issued',currency:'QAR',total_minor:'90071992547409931',collected_minor:'20',credited_minor:'11',next_due_date:new Date('2026-11-01T00:00:00Z'),lead_id:'44444444-4444-4444-8444-444444444444',learner_name:'Learner',payer_name:'Payer',payer_phone:'123'}],[]];}};
  const row=await linkedRecords.resolve(db,ctx.tenantId,'invoice','33333333-3333-4333-8333-333333333333');
  assert.equal(row.amountDueMinor,'90071992547409900');assert.equal(row.totalMinor,'90071992547409931');assert.equal(row.dueAt,'2026-11-01');assert.equal(row.leadId,'44444444-4444-4444-8444-444444444444');
  assert.deepEqual(call.args,[ctx.tenantId,'33333333-3333-4333-8333-333333333333']);assert.match(call.sql,/i\.tenant_id=\? AND i\.id=\?/);
});

test('installment task source subtracts posted collections, reversals and credits and rejects non-open records',async()=>{
  const invoiceRow={id:'33333333-3333-4333-8333-333333333333',invoice_number:'INV-12',status:'issued',currency:'QAR',total_minor:'50000',collected_minor:'0',credited_minor:'0',next_due_date:'2026-11-01',lead_id:null,learner_name:'Learner',payer_name:'Payer',payer_phone:'123'};
  const inst={id:'55555555-5555-4555-8555-555555555555',invoice_id:invoiceRow.id,sequence_number:2,due_date:'2026-12-01',amount_minor:'30000',status:'open',collected_minor:'12500',credited_minor:'2500'};
  const calls=[];const db={query:async(sql,args)=>{calls.push({sql,args});return sql.startsWith('SELECT x.id,x.invoice_id')?[[inst],[]]:[[invoiceRow],[]];}};
  const source=await linkedRecords.validate(db,ctx,'installment',inst.id);
  assert.equal(source.amountDueMinor,'15000');assert.deepEqual(source.installment,{id:inst.id,sequence:2,dueDate:'2026-12-01',amountMinor:'30000',collectedMinor:'12500',creditedMinor:'2500',status:'open'});assert.equal(source.dueAt,'2026-12-01');
  assert.ok(calls.every(c=>c.args[0]===ctx.tenantId));assert.match(calls[0].sql,/x\.tenant_id=\? AND x\.id=\?/);
  await assert.rejects(linkedRecords.validate(db,{...ctx,role:'agent'},'installment',inst.id),{code:'PERMISSION_DENIED'});
  inst.status='paid';
  await assert.rejects(linkedRecords.validate(db,ctx,'installment',inst.id),{code:'TASK_INSTALLMENT_NOT_OPEN'});
});
test('task participant input supports multiple assignees and observers but rejects duplicates and empty assignments',()=>{
  assert.deepEqual(tasks._private.participants([{actorType:'agent',actorId:'7',role:'assignee'},{actorType:'identity',actorId:'member-id',role:'observer'}]),[{actorType:'agent',actorId:'7',role:'assignee'},{actorType:'identity',actorId:'member-id',role:'observer'}]);
  assert.throws(()=>tasks._private.participants([]),{code:'INVALID_TASK_PARTICIPANTS'});
  assert.deepEqual(tasks._private.participants([{actorType:'agent',actorId:'7',role:'observer'}]),[{actorType:'agent',actorId:'7',role:'observer'}]);
  assert.throws(()=>tasks._private.participants([{actorType:'agent',actorId:'7',role:'assignee'},{actorType:'agent',actorId:'7',role:'observer'}]),{code:'DUPLICATE_TASK_PARTICIPANT'});
});

test('task titles reject control characters that could corrupt email headers',async()=>{
  const db={query:async()=>{throw Error('invalid title must be rejected before database access')}};
  for(const title of ['Follow up\r\nBcc: attacker@example.invalid','Follow\u0000up']){
    await assert.rejects(tasks.create(db,ctx,{title,participants:[{actorType:'identity',actorId:ctx.actorId,role:'assignee'}]}),{code:'INVALID_TASK_TITLE'});
  }
});

test('task assignment history records participants added, removed, and changed between assignee and observer',()=>{
  const before=[{actorType:'agent',actorId:'7',role:'assignee'},{actorType:'identity',actorId:'manager-1',role:'observer'}];
  const after=[{actorType:'agent',actorId:'7',role:'observer'},{actorType:'identity',actorId:'manager-2',role:'assignee'}];
  assert.deepEqual(tasks._private.assignmentDiff(before,after),{
    added:[after[1]],removed:[before[1]],roleChanged:[{actorType:'agent',actorId:'7',from:'assignee',to:'observer'}],
  });
});

test('task chat cursors preserve the full unsigned BIGINT range without JavaScript precision loss',()=>{
  assert.equal(tasks._private.messageCursor('9007199254740993'),'9007199254740993');
  assert.equal(tasks._private.messageCursor('18446744073709551615'),'18446744073709551615');
  assert.equal(tasks._private.messageCursor(12),'12');
  for(const value of [-1,1.5,Number.MAX_SAFE_INTEGER+1,'01','1e6','18446744073709551616'])assert.throws(()=>tasks._private.messageCursor(value),{code:'INVALID_MESSAGE_CURSOR'});
});

test('task chat read cursor advances only for a real message on an active task participant',async()=>{
  const calls=[],taskId='66666666-6666-4666-8666-666666666666',task={id:taskId,revision:1,status:'open'};
  const db={beginTransaction:async()=>calls.push(['BEGIN']),commit:async()=>calls.push(['COMMIT']),rollback:async()=>calls.push(['ROLLBACK']),query:async(sql,args=[])=>{calls.push([sql,args]);if(sql.includes('FROM sx_tasks'))return [[task],[]];if(sql.includes('FROM sx_task_participants')&&sql.includes('participant_role'))return [[{participant_role:'assignee'}],[]];if(sql.includes('FROM sx_task_messages'))return [[{id:'9007199254740993'}],[]];if(sql.startsWith('UPDATE sx_task_participants'))return [{affectedRows:1},[]];return [[],[]];}};
  const result=await tasks.markMessagesRead(db,{...ctx,actorType:'agent',actorId:'7',role:'agent',agentId:7},taskId,'9007199254740993');
  assert.deepEqual(result,{taskId,lastReadMessageId:'9007199254740993'});
  const update=calls.find(([sql])=>String(sql).startsWith('UPDATE sx_task_participants'));
  assert.deepEqual(update[1],['9007199254740993','9007199254740993',ctx.tenantId,taskId,'agent','7']);
  assert.equal(calls.at(-1)[0],'COMMIT');
});

test('task chat denies managers who are not active task participants',async()=>{
  const db={query:async(sql)=>sql.includes('FROM sx_tasks')?[[{id:'66666666-6666-4666-8666-666666666666'}],[]]:[[],[]]};
  await assert.rejects(tasks.messages(db,ctx,'66666666-6666-4666-8666-666666666666',{}),{code:'PERMISSION_DENIED',status:403});
});

test('WhatsApp task notification preference is per authenticated recipient and defaults off',async()=>{
  const calls=[];let optedIn=0;const db={query:async(sql,args=[])=>{calls.push([sql,args]);if(sql.startsWith('INSERT INTO sx_task_notification_preferences')){optedIn=args[3];return [{affectedRows:1},[]];}if(sql.includes('FROM sx_task_notification_preferences'))return optedIn?[[{whatsappOptIn:1,whatsappOptedInAt:'2026-10-05 10:00:00',whatsappOptedOutAt:null}],[]]:[[],[]];return [[],[]];}};
  assert.deepEqual(await tasks.getNotificationPreferences(db,ctx),{whatsappOptIn:false,whatsappOptedInAt:null,whatsappOptedOutAt:null});
  const saved=await tasks.setNotificationPreferences(db,{...ctx,actorType:'agent',actorId:'7',role:'agent',agentId:7},{whatsappOptIn:true});
  assert.equal(saved.whatsappOptIn,true);const insert=calls.find(([sql])=>sql.startsWith('INSERT INTO sx_task_notification_preferences'));assert.deepEqual(insert[1].slice(0,3),[ctx.tenantId,'agent','7']);
  await assert.rejects(tasks.setNotificationPreferences(db,ctx,{whatsappOptIn:1}),{code:'INVALID_TASK_NOTIFICATION_PREFERENCES'});
});

test('task list returns role capabilities and scopes unread counts to the current participant',async()=>{
  let query;
  const db={query:async(sql,args)=>{query={sql,args};return [[],[]];}};
  const owner=await tasks.list(db,ctx,{scope:'mine'});
  assert.deepEqual(owner.permissions,{canCreate:true,canManage:true,canViewTeam:true});
  assert.match(query.sql,/AS unread_count/);assert.deepEqual(query.args.slice(0,2),[ctx.actorType,String(ctx.actorId)]);
  const agent=await tasks.list(db,{...ctx,role:'agent',actorType:'agent',actorId:'7',agentId:7},{scope:'mine'});
  assert.deepEqual(agent.permissions,{canCreate:true,canManage:false,canViewTeam:false});
  await assert.rejects(tasks.list(db,{...ctx,role:'agent',actorType:'agent',actorId:'7',agentId:7},{scope:'team'}),{code:'PERMISSION_DENIED'});
});

test('task list reports whether another page exists and caps the page to the requested size',async()=>{
  const rows=[{id:'t1'},{id:'t2'},{id:'t3'}];let query;
  const db={query:async(sql,args)=>{query={sql,args};return [rows,[]];}};
  const result=await tasks.list(db,ctx,{scope:'mine',page:2,limit:2});
  assert.deepEqual(result.items,[{id:'t1'},{id:'t2'}]);assert.equal(result.hasMore,true);assert.equal(result.page,2);assert.equal(result.limit,2);
  assert.deepEqual(query.args.slice(-2),[3,2]);
});

test('task detail resolves participant names without exposing their email addresses',async()=>{
  const taskId='88888888-8888-4888-8888-888888888888',task={id:taskId,revision:1,status:'open',lead_id:null};
  const participant={actorType:'agent',actorId:'7',role:'assignee',label:'Amina',addedAt:'2026-10-05 10:00:00'};
  const db={query:async(sql)=>{if(sql.includes('FROM sx_tasks'))return [[task],[]];if(sql.includes('FROM sx_task_participants p'))return [[participant],[]];if(sql.includes('FROM sx_task_participants WHERE'))return [[{participant_role:'assignee'}],[]];if(sql.includes('FROM sx_task_events'))return [[],[]];if(sql.includes('FROM sx_task_notifications'))return [[],[]];return [[],[]];}};
  const detail=await tasks.detail(db,{...ctx,role:'agent',actorType:'agent',actorId:'7',agentId:7},taskId);
  assert.equal(detail.participants[0].label,'Amina');
  const peopleSql='SELECT p.actor_type AS actorType,p.actor_id AS actorId,p.participant_role AS role,p.added_at AS addedAt,COALESCE(NULLIF(a.name,\'\'),CONCAT(\'Agent \',a.id),NULLIF(i.display_name,\'\'),NULLIF(u.name,\'\'),\'Team member\') AS label';
  assert.doesNotMatch(peopleSql,/email/);
});

test('task history uses descending keyset cursors while returning chronological pages',async()=>{
  const calls=[],taskId='99999999-9999-4999-8999-999999999999',task={id:taskId,revision:1,status:'open'};
  const db={query:async(sql,args=[])=>{calls.push([sql,args]);if(sql.includes('FROM sx_tasks'))return [[task],[]];if(sql.includes('FROM sx_task_participants'))return [[{participant_role:'observer'}],[]];if(sql.includes('FROM sx_task_events'))return sql.includes('id<?')?[[{id:'3'},{id:'2'},{id:'1'}],[]]:[[{id:'5'},{id:'4'},{id:'3'}],[]];return [[],[]];}};
  const first=await tasks.eventHistory(db,{...ctx,actorType:'agent',actorId:'7',role:'agent',agentId:7},taskId,{limit:2});
  assert.deepEqual(first.items.map(event=>event.id),['4','5']);assert.equal(first.hasMore,true);assert.equal(first.nextCursor,'4');assert.match(calls.at(-1)[0],/ORDER BY e\.id DESC LIMIT/);assert.equal(calls.at(-1)[1].at(-1),3);
  const older=await tasks.eventHistory(db,{...ctx,actorType:'agent',actorId:'7',role:'agent',agentId:7},taskId,{before:first.nextCursor,limit:2});
  assert.deepEqual(older.items.map(event=>event.id),['2','3']);assert.equal(older.hasMore,true);assert.equal(older.nextCursor,'2');assert.equal(calls.at(-1)[1][2],'4');
});

test('task notification history exposes bounded chronological pages to active participants',async()=>{
  const calls=[],taskId='99999999-9999-4999-8999-999999999998',task={id:taskId,revision:1,status:'open'};
  const db={query:async(sql,args=[])=>{calls.push([sql,args]);if(sql.includes('FROM sx_tasks'))return [[task],[]];if(sql.includes('FROM sx_task_participants'))return [[{participant_role:'observer'}],[]];if(sql.includes('FROM sx_task_notifications'))return sql.includes('id<?')?[[{id:'3'},{id:'2'},{id:'1'}],[]]:[[{id:'5'},{id:'4'},{id:'3'}],[]];return [[],[]];}};
  const first=await tasks.notificationHistory(db,ctx,taskId,{limit:2});assert.deepEqual(first.items.map(row=>row.id),['4','5']);assert.equal(first.nextCursor,'4');assert.equal(first.hasMore,true);
  const older=await tasks.notificationHistory(db,ctx,taskId,{before:first.nextCursor,limit:2});assert.deepEqual(older.items.map(row=>row.id),['2','3']);assert.equal(older.nextCursor,'2');assert.equal(calls.at(-1)[1][2],'4');
});

test('task-linked lead context includes scoped activity, conversations and source attribution',async()=>{
  const calls=[],leadId='66666666-6666-4666-8666-666666666666';
  const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM pipeline_leads l'))return [[{id:leadId,title:'Lead',contact_email:'lead@example.test'}],[]];if(sql.includes('FROM pipeline_activity'))return [[{id:1,details:'{"outcome":"follow_up"}'}],[]];if(sql.includes('FROM pipeline_conversations'))return [[{chat_id:'chat-1',has_verified_ad_attribution:1}],[]];if(sql.includes('FROM pipeline_attributions'))return [[{source_type:'meta_ad',source_id:'ad-1'}],[]];return [[],[]];}};
  const detail=await tasks._private.taskLeadDetail(db,ctx,leadId);
  assert.equal(detail.activities[0].details.outcome,'follow_up');assert.equal(detail.conversations[0].chat_id,'chat-1');assert.equal(detail.attributions[0].source_id,'ad-1');
  assert.equal(calls.length,4);assert.ok(calls.every(c=>c.args[0]===ctx.uidHash));
});

test('task chat opens at the newest page and loads older messages with a precise before cursor',async()=>{
  const calls=[],taskId='77777777-7777-4777-8777-777777777777',task={id:taskId,revision:1,status:'open'};
  const db={query:async(sql,args=[])=>{calls.push([sql,args]);if(sql.includes('FROM sx_tasks'))return [[task],[]];if(sql.includes('FROM sx_task_participants'))return [[{participant_role:'assignee'}],[]];if(sql.includes('m.id<?'))return [[{id:'9007199254740992',senderName:'Amina'},{id:'9007199254740991',senderName:'Amina'}],[]];if(sql.includes('ORDER BY m.id DESC LIMIT'))return [[{id:'9007199254740994',senderName:'Amina'},{id:'9007199254740993',senderName:'Amina'}],[]];return [[],[]];}};
  const latest=await tasks.messages(db,{...ctx,actorType:'agent',actorId:'7',role:'agent',agentId:7},taskId,{latest:true,limit:2});
  assert.deepEqual(latest.items.map(m=>m.id),['9007199254740993','9007199254740994']);
  assert.equal(latest.items[0].senderName,'Amina');assert.match(calls.at(-1)[0],/AS senderName/);assert.deepEqual(calls.at(-1)[1].slice(0,4),[ctx.uid,ctx.uid,ctx.tenantId,taskId]);
  const before=await tasks.messages(db,{...ctx,actorType:'agent',actorId:'7',role:'agent',agentId:7},taskId,{before:'9007199254740993',limit:2});
  assert.match(calls.at(-1)[0],/m\.id<\? ORDER BY m\.id DESC LIMIT/);
  assert.equal(calls.at(-1)[1][4],'9007199254740993');
  assert.deepEqual(before.items.map(m=>m.id),['9007199254740991','9007199254740992']);
});

test('status changes are revision-checked and atomically record history plus email and WhatsApp intents',async()=>{
  const calls=[],task={id:'44444444-4444-4444-8444-444444444444',revision:3,status:'open'};
  const db={beginTransaction:async()=>calls.push(['BEGIN']),commit:async()=>calls.push(['COMMIT']),rollback:async()=>calls.push(['ROLLBACK']),query:async(sql,args=[])=>{calls.push([sql,args]);if(sql.includes('FROM sx_tasks'))return [[task],[]];if(sql.includes('FROM sx_task_participants')&&sql.includes('participant_role'))return [[{participant_role:'assignee'}],[]];if(sql.includes('FROM sx_task_participants'))return [[{actorType:'agent',actorId:'7',role:'assignee'}],[]];if(sql.startsWith('UPDATE sx_tasks'))return [{affectedRows:1},[]];if(sql.startsWith('INSERT IGNORE INTO sx_task_notifications'))return [{affectedRows:1},[]];return [{insertId:1,affectedRows:1},[]];}};
  const result=await tasks.updateStatus(db,{...ctx,actorType:'agent',actorId:'7',role:'agent',agentId:7},task.id,{status:'in_progress',expectedRevision:3});
  assert.deepEqual(result,{id:task.id,status:'in_progress',revision:4,notificationRecipients:1});
  const event=calls.find(([sql])=>String(sql).includes('INSERT INTO sx_task_events'));
  assert.equal(event[1][5],'status_changed');assert.equal(event[1][6],'open');assert.equal(event[1][7],'in_progress');
  assert.match(calls.find(([sql])=>String(sql).startsWith('SELECT * FROM sx_tasks'))[0],/FOR UPDATE$/);
  assert.equal(calls.filter(([sql])=>String(sql).startsWith('INSERT IGNORE INTO sx_task_notifications')).length,2);
  assert.equal(calls.at(-1)[0],'COMMIT');
});

test('a repeated task status is idempotent and does not fan out duplicate notifications',async()=>{
  const calls=[],task={id:'44444444-4444-4444-8444-444444444444',revision:3,status:'open'};
  const db={beginTransaction:async()=>calls.push(['BEGIN']),commit:async()=>calls.push(['COMMIT']),rollback:async()=>calls.push(['ROLLBACK']),query:async(sql,args=[])=>{calls.push([sql,args]);if(sql.includes('FROM sx_tasks'))return [[task],[]];if(sql.includes('FROM sx_task_participants'))return [[{participant_role:'assignee'}],[]];return [{affectedRows:1},[]];}};
  const result=await tasks.updateStatus(db,{...ctx,actorType:'agent',actorId:'7',role:'agent',agentId:7},task.id,{status:'open',expectedRevision:3});
  assert.equal(result.unchanged,true);assert.equal(result.revision,3);
  assert.equal(calls.some(([sql])=>String(sql).startsWith('UPDATE sx_tasks')),false);
  assert.equal(calls.some(([sql])=>String(sql).includes('sx_task_notifications')),false);
  assert.equal(calls.at(-1)[0],'COMMIT');
});

test('task deletion is soft, audited, and rejects a stale revision without commit',async()=>{
  const calls=[],task={id:'55555555-5555-4555-8555-555555555555',revision:6,status:'open'};
  const db={beginTransaction:async()=>calls.push(['BEGIN']),commit:async()=>calls.push(['COMMIT']),rollback:async()=>calls.push(['ROLLBACK']),query:async(sql,args=[])=>{calls.push([sql,args]);if(sql.includes('FROM sx_tasks'))return [[task],[]];if(sql.includes('FROM sx_task_participants'))return [[{participant_role:'assignee'}],[]];if(sql.startsWith('UPDATE sx_tasks'))return [{affectedRows:1},[]];return [{insertId:1,affectedRows:1},[]];}};
  const deleted=await tasks.remove(db,ctx,task.id,6);assert.equal(deleted.deleted,true);assert.equal(deleted.revision,7);
  assert.match(calls.find(([sql])=>String(sql).startsWith('UPDATE sx_tasks'))[0],/deleted_at=UTC_TIMESTAMP/);assert.ok(calls.some(([sql])=>String(sql).includes("status IN ('queued','processing')")));assert.ok(calls.some(([sql])=>String(sql).includes('TASK_DELETED_DURING_SEND')));
  assert.equal(calls.find(([sql])=>String(sql).includes('INSERT INTO sx_task_events'))[1][5],'deleted');
  assert.equal(calls.at(-1)[0],'COMMIT');
  calls.length=0;task.revision=7;
  await assert.rejects(tasks.remove(db,ctx,task.id,6),{code:'TASK_REVISION_CONFLICT'});
  assert.equal(calls.some(([sql])=>sql==='COMMIT'),false);assert.equal(calls.at(-1)[0],'ROLLBACK');
});

test('task creation keeps the lead, participants, history and channel notification intents in one transaction',async()=>{
  const calls=[];const lead={id:'33333333-3333-4333-8333-333333333333',title:'Course enquiry',contact_name:'Learner',owner_agent_id:null};
  const db={beginTransaction:async()=>calls.push(['BEGIN']),commit:async()=>calls.push(['COMMIT']),rollback:async()=>calls.push(['ROLLBACK']),query:async(sql,args=[])=>{calls.push([sql,args]);if(sql.includes('FROM pipeline_leads'))return [[lead],[]];if(sql.includes('FROM agents'))return [[{id:7}],[]];if(sql.includes('FROM sx_memberships'))return [[{id:'member'}],[]];if(sql.startsWith('INSERT'))return [{insertId:1,affectedRows:1},[]];return [[],[]];}};
  const result=await tasks.create(db,ctx,{title:'Call about course schedule',description:'Ask about evening classes',taskType:'lead_follow_up',dueAt:'2026-10-06T10:00:00.000Z',source:{type:'lead',id:lead.id},participants:[{actorType:'agent',actorId:'7',role:'assignee'},{actorType:'agent',actorId:'8',role:'assignee'},{actorType:'identity',actorId:'member-id',role:'observer'}]});
  assert.equal(result.lead.id,lead.id);assert.equal(result.participants.length,4);assert.ok(result.participants.some(p=>p.actorType===ctx.actorType&&p.actorId===ctx.actorId&&p.role==='observer'));assert.equal(result.status,'open');
  assert.equal(calls.filter(([sql])=>String(sql).startsWith('INSERT INTO sx_task_participants')).length,4);
  assert.equal(calls.filter(([sql])=>String(sql).startsWith('INSERT IGNORE INTO sx_task_notifications')).length,8);
  assert.equal(calls.at(-1)[0],'COMMIT');
  const activity=calls.find(([sql])=>String(sql).includes('INSERT INTO pipeline_activity'));assert.ok(activity);assert.deepEqual(activity[1].slice(0,2),[ctx.uidHash,lead.id]);
});

test('task lead lookup is constrained to the caller workspace and agent assignment',async()=>{
  const args=[];const db={query:async(sql,values)=>{args.push(values);return [[{id:'33333333-3333-4333-8333-333333333333',owner_agent_id:9}],[]];}};
  await assert.rejects(tasks._private.assertLead(db,{...ctx,role:'agent',agentId:4},'33333333-3333-4333-8333-333333333333'),{code:'PERMISSION_DENIED'});
  assert.deepEqual(args[0],[ctx.uidHash,'33333333-3333-4333-8333-333333333333']);
});

test('task capability is enforced by category, plan and role policy',()=>{
  const policyCtx={audience:'tenant',tenant:{id:ctx.tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'membership',tenantId:ctx.tenantId,role:'owner',status:'active'},category:trainingCenter,subscription:{status:'active',capabilities:['team.tasks']},...ctx};
  assert.equal(tasks.authorize(policyCtx,'tasks.read').allowed,true);
  assert.throws(()=>tasks.authorize({...policyCtx,category:restaurantFixture},'tasks.read'),{code:'CATEGORY_UNAVAILABLE'});
  assert.throws(()=>tasks.authorize({...policyCtx,subscription:{status:'active',capabilities:[]}},'tasks.read'),{code:'FEATURE_UNAVAILABLE'});
  assert.equal(tasks.authorize({...policyCtx,membership:{...policyCtx.membership,role:'accountant'}},'tasks.manage').scope,'assigned');
});

test('canonical business sessions map to the workspace owner data scope for Tasks',async()=>{
  const uid='owner-uid',uidHash=require('node:crypto').createHash('sha256').update(uid).digest('hex'),calls=[];
  const pool={getConnection:async()=>({query:async(sql,args)=>{calls.push({sql,args});return [[{uid,uidHash}],[]];},release(){}})};
  const context={audience:'tenant',tenant:{id:ctx.tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'membership',tenantId:ctx.tenantId,role:'owner',status:'active',delegatedPermissions:[]},identity:{id:ctx.actorId},category:trainingCenter,subscription:{status:'active',capabilities:['team.tasks']}};
  const result=await createTaskContext(pool,context,'tasks.read');
  assert.equal(result.tenantId,ctx.tenantId);assert.equal(result.uid,uid);assert.equal(result.uidHash,uidHash);assert.equal(result.actorType,'identity');assert.equal(result.actorId,ctx.actorId);assert.equal(calls.length,1);assert.match(calls[0].sql,/m\.role='owner'/);
});

test('Tasks stays in the existing business shell and supports legacy and canonical business sessions',()=>{
  const root=path.join(__dirname,'..');const sidebar=fs.readFileSync(path.join(root,'client/public/training-sidebar.js'),'utf8');const entry=fs.readFileSync(path.join(root,'client/public/pipeline-entry.js'),'utf8');const router=fs.readFileSync(path.join(root,'routes/pipeline.js'),'utf8');const taskRouter=fs.readFileSync(path.join(root,'modules/platform/task-router.js'),'utf8');const mount=fs.readFileSync(path.join(root,'modules/platform/mount-existing-upgrade.js'),'utf8');const session=fs.readFileSync(path.join(root,'client/public/tasks/tasks-session.js'),'utf8');const html=fs.readFileSync(path.join(root,'client/public/tasks/index.html'),'utf8');
  assert.match(sidebar,/\['Team & Tasks'.*'Tasks'/);assert.match(sidebar,/user\?page=tasks/);assert.match(entry,/salemax-tasks-workspace/);assert.match(entry,/drawerRect\?\.right\|\|0/);assert.match(router,/router\.use\('\/tasks',createTaskRouter/);for(const route of ['messages','events','notifications','read','status','preferences'])assert.ok(taskRouter.includes(route));assert.match(mount,/api\/user\/training\/tasks/);assert.match(mount,/businessBoundary\.guard,createTaskRouter/);assert.match(session,/api\/user\/business-auth\/me/);assert.match(session,/X-CSRF-Token/);assert.match(html,/whatsappOptIn/);assert.match(html,/previousPage/);assert.match(html,/nextPage/);assert.match(html,/tasks\.js/);
  for(const term of ['Title','Description','Priority','Due date and time','Assignees and observers','Save task'])assert.match(html,new RegExp(`data-en="${term}" data-ar="`));
  const taskUi=fs.readFileSync(path.join(root,'client/public/tasks/tasks.js'),'utf8');for(const kind of ['status','priority','type','role','event','notification'])assert.match(taskUi,new RegExp(`label\\('${kind}'`));assert.match(taskUi,/unread_count/);assert.match(taskUi,/lastReadMessageId/);assert.match(taskUi,/loadOlderMessages/);assert.match(taskUi,/loadOlderHistory/);assert.match(taskUi,/loadOlderNotifications/);assert.match(taskUi,/eventsHasMore/);assert.match(taskUi,/notificationsHasMore/);assert.match(taskUi,/latest=1/);assert.match(taskUi,/chatInitial=true;state\.chatHasOlder=false/);assert.match(taskUi,/Completed at/);assert.match(taskUi,/m\.senderName\|\|/);
});

test('task screen recognizes SaleMaX Arabic locale values including ar and ar-QA',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../client/public/tasks/tasks.js'),'utf8');
  const match=source.match(/ar=\(\)=>\{const language=\(localStorage\.getItem\('language'\)\|\|''\)\.toLowerCase\(\);return language==='ar'\|\|language\.startsWith\('ar-'\)\|\|language\.includes\('arab'\)\}/);
  assert.ok(match,'task page uses the supported Arabic locale forms');
  const expression=match[0].replace(/^ar=/,'');
  const isArabic=value=>new Function('localStorage',`return (${expression})()` )({getItem:()=>value});
  assert.equal(isArabic('ar'),true);
  assert.equal(isArabic('ar-QA'),true);
  assert.equal(isArabic('Arabic'),true);
  assert.equal(isArabic('en'),false);
});
