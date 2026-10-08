'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const reminders=require('../modules/platform/training-installment-reminders');
const uuid=()=>crypto.randomUUID();
function ctx(){const tenantId=uuid();return {audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{tenantId,status:'active',role:'owner'},identity:{id:uuid()},category:{key:'training_center',version:1,capabilities:['finance.invoices']},subscription:{status:'active',capabilities:['finance.invoices']}};}

test('tenant offsets are bounded, unique, normalized and default scheduling is disabled',()=>{
  assert.deepEqual(reminders.DEFAULT_OFFSETS,[-3,0,3,7]);assert.deepEqual(reminders.shape(null),{enabled:false,offsetsDays:[-3,0,3,7],revision:0});assert.deepEqual(reminders.validateOffsets([7,-3,0]),[-3,0,7]);
  for(const value of [[],Array(9).fill(1),[1,1],[-31],[91],[1.5],null])assert.throws(()=>reminders.validateOffsets(value),{code:'INVALID_REMINDER_OFFSETS'});
  assert.equal(reminders.parseResourceOffset(reminders.resourceType(-3)),-3);assert.equal(reminders.parseResourceOffset(reminders.resourceType(0)),0);assert.equal(reminders.parseResourceOffset(reminders.resourceType(7)),7);
});

test('tenant settings require owner/accountant authority, expected revision and audited updates',async()=>{
  const actor=ctx(),queries=[];let old=null;
  const db={async beginTransaction(){},async commit(){},async rollback(){},async query(sql,params){queries.push({sql,params});if(sql.includes('SELECT enabled,offsets_json,revision')&&sql.includes('FOR UPDATE'))return [[old]];if(sql.startsWith('INSERT INTO sx_training_reminder_settings')){old={enabled:params[1],offsets_json:params[2],revision:params[3]};return [{affectedRows:1}];}return [{affectedRows:1}];}};
  const saved=await reminders.saveSettings(db,actor,{enabled:true,offsetsDays:[7,0,-3],expectedRevision:0});assert.deepEqual(saved,{enabled:true,offsetsDays:[-3,0,7],revision:1});assert.ok(queries.some(x=>x.sql.includes('training.installment-reminder-settings-updated')));
  await assert.rejects(reminders.saveSettings(db,actor,{enabled:false,offsetsDays:[0],expectedRevision:0}),{code:'STALE_REMINDER_SETTINGS'});
  await assert.rejects(reminders.saveSettings(db,{...actor,membership:{...actor.membership,role:'manager'}},{enabled:true,offsetsDays:[0],expectedRevision:1}),{code:'PERMISSION_DENIED'});
});

test('scheduler queues only opted-in, in-balance, undisputed installments on configured Qatar dates',async()=>{
  const actor=ctx(),invoiceId=uuid(),installmentId=uuid(),queries=[],events=[];
  const email='payer@example.qa',hash=crypto.createHash('sha256').update(email).digest('hex');
  const eligible={installment_id:installmentId,invoice_id:invoiceId,due_date:'2026-10-11',amount_minor:10000,installment_status:'pending',schedule_version:2,invoice_status:'issued',invoice_email:email,recipient_hash:hash,preference_status:'opted_in',enrollment_status:'confirmed',paid_minor:2000,credited_minor:0,dispute_open:0};
  const db={async query(sql,params){queries.push({sql,params});if(sql.includes('FROM sx_training_reminder_settings'))return [[{enabled:1,offsets_json:'[-3,0,3,7]',revision:1}]];if(sql.includes('FROM sx_training_installments x JOIN'))return [[eligible,{...eligible,installment_id:uuid(),dispute_open:1},{...eligible,installment_id:uuid(),preference_status:'opted_out'}]];if(sql.startsWith('INSERT INTO sx_training_outbox_events')){events.push(params);return [{affectedRows:1}];}throw Error(`Unexpected SQL: ${sql}`);}};
  const result=await reminders.scheduleDue(db,actor,{now:new Date('2026-10-08T08:00:00.000Z')});assert.deepEqual(result,{scheduled:1,eligible:1});assert.equal(events.length,1);assert.equal(events[0][2],`installment-reminder:${installmentId}:v2:d-3`);assert.equal(events[0][3],'finance.installment.reminder');assert.equal(JSON.parse(events[0][4]).resourceType,'installment-reminder-before-3');assert.deepEqual(Object.keys(JSON.parse(events[0][4])).sort(),['correlationId','resourceId','resourceType','revision']);
});

test('dispatch suppresses opt-out, stale schedule and fully paid balances before transport use',async()=>{
  const tenantId=uuid(),installmentId=uuid(),email='payer@example.qa',hash=crypto.createHash('sha256').update(email).digest('hex');let sendCount=0;
  const base={id:installmentId,invoice_id:uuid(),due_date:'2026-10-08',amount_minor:10000,installment_status:'pending',schedule_version:2,invoice_status:'issued',invoice_number:'TC-2026-001',currency:'QAR',invoice_email:email,preference_status:'opted_out',recipient_hash:hash,enabled:1,offsets_json:'[0]',enrollment_status:'confirmed',paid_minor:0,credited_minor:0,dispute_open:0};
  let row={...base};const db={async query(sql){if(sql.includes('FROM sx_training_installments x JOIN'))return [[row]];throw Error(`Unexpected SQL: ${sql}`);}};const transport={async sendMail(){sendCount++;return {accepted:[email]};}};
  assert.deepEqual(await reminders.dispatch(db,{tenantId,installmentId,scheduleVersion:2,offset:0,transport,from:'receipts@example.qa',now:new Date('2026-10-08T08:00:00.000Z')}),{status:'suppressed',reason:'CUSTOMER_OPTED_OUT'});assert.equal(sendCount,0);
  row={...base,preference_status:'opted_in',schedule_version:3};assert.deepEqual(await reminders.dispatch(db,{tenantId,installmentId,scheduleVersion:2,offset:0,transport,from:'receipts@example.qa',now:new Date('2026-10-08T08:00:00.000Z')}),{status:'suppressed',reason:'SCHEDULE_CHANGED'});assert.equal(sendCount,0);
  row={...base,preference_status:'opted_in',paid_minor:10000};assert.deepEqual(await reminders.dispatch(db,{tenantId,installmentId,scheduleVersion:2,offset:0,transport,from:'receipts@example.qa',now:new Date('2026-10-08T08:00:00.000Z')}),{status:'suppressed',reason:'BALANCE_CLOSED'});assert.equal(sendCount,0);
});

test('dispatch rereads consent, dispute, cancellation and the current open balance before sending',async()=>{
  const tenantId=uuid(),installmentId=uuid(),email='payer@example.qa',hash=crypto.createHash('sha256').update(email).digest('hex'),env={SALEMAX_PLATFORM_KEY_BASE64:Buffer.alloc(32,7).toString('base64'),SALEMAX_PUBLIC_BASE_URL:'https://crm.example.qa'},sealed=require('../modules/platform/training-reminder-preferences').encryptToken(Buffer.alloc(32,5).toString('base64url'),env);let row={id:installmentId,invoice_id:uuid(),due_date:'2026-10-08',amount_minor:10000,installment_status:'partial',schedule_version:2,invoice_status:'issued',invoice_number:'TC-2026-001',currency:'QAR',invoice_email:email,preference_status:'opted_in',recipient_hash:hash,token_hash:sealed.tokenHash,token_ciphertext:sealed.ciphertext,token_iv:sealed.iv,token_tag:sealed.tag,enabled:1,offsets_json:'[0]',enrollment_status:'confirmed',paid_minor:2500,credited_minor:1500,dispute_open:0};
  const db={async query(sql){if(sql.includes('FROM sx_training_installments x JOIN'))return [[row]];throw Error(`Unexpected SQL: ${sql}`);}};let sent;
  const transport={async sendMail(message){sent=message;return {accepted:[email]};}};
  const result=await reminders.dispatch(db,{tenantId,installmentId,scheduleVersion:2,offset:0,transport,from:'receipts@example.qa',env,now:new Date('2026-10-08T08:00:00.000Z')});assert.deepEqual(result,{status:'sent'});assert.equal(sent.to,email);assert.match(sent.subject,/TC-2026-001/);assert.match(sent.text,/QAR\s*60\.00/);assert.match(sent.html,/60\.00/);assert.match(sent.text,/https:\/\/crm\.example\.qa\/customer-reminders#/);
});

test('suppression is a terminal outbox outcome with a reason, distinct from delivered',async()=>{
  const ctxValue=ctx(),eventId=uuid(),queries=[];const db={async beginTransaction(){},async commit(){},async rollback(){},async query(sql,params){queries.push({sql,params});if(sql.startsWith('SELECT attempts,status'))return [[{attempts:1,status:'leased',lease_owner:'worker-test',lease_version:1,lease_valid:1}]];return [{affectedRows:1}];}};
  const result=await require('../modules/platform/training-outbox').finish(db,ctxValue,{eventId,workerId:'worker-test',leaseVersion:1,outcome:'suppressed',errorCode:'CUSTOMER_OPTED_OUT'});assert.equal(result.status,'suppressed');assert.ok(queries.some(x=>x.sql.includes('SET status=?')&&x.params[0]==='suppressed'));assert.ok(queries.some(x=>x.sql.includes('SET outcome=?')&&x.params[0]==='suppressed'));
});

test('reminder mail has an independent SMTP flag and is wired into the existing worker and Finance settings UI',()=>{
  const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8'),delivery=read('modules/platform/training-receipt-delivery.js'),runtime=read('modules/platform/training-receipt-worker-runtime.js'),worker=read('scripts/training-receipt-worker.cjs'),router=read('modules/platform/training-finance-router.js'),screen=read('client/public/training-finance.js'),migration=read('database/migrations/20261122_training_reminder_preferences.sql');
  const transport={SALEMAX_SMTP_HOST:'smtp.example.invalid',SALEMAX_SMTP_PORT:'587',SALEMAX_SMTP_USER:'mailer@example.invalid',SALEMAX_SMTP_PASS:'synthetic-secret',SALEMAX_RECEIPT_FROM:'receipts@example.invalid',SALEMAX_PLATFORM_KEY_BASE64:Buffer.alloc(32,1).toString('base64')};assert.equal(require('../modules/platform/training-receipt-delivery').reminderEmailEnabled({...transport,SALEMAX_INSTALLMENT_REMINDER_EMAIL_ENABLED:'true'}),true);assert.equal(require('../modules/platform/training-receipt-delivery').reminderEmailEnabled({...transport,SALEMAX_INSTALLMENT_REMINDER_EMAIL_ENABLED:'true',SALEMAX_PLATFORM_KEY_BASE64:''}),false);
  assert.match(delivery,/SALEMAX_INSTALLMENT_REMINDER_EMAIL_ENABLED/);assert.match(runtime,/reminderEmailEnabled/);assert.match(worker,/finance\.installment\.reminder/);assert.match(worker,/e\.event_type IN \(\?\)/);assert.match(worker,/enabledEventTypes\(\)/);assert.match(router,/reminders\/settings/);assert.match(screen,/Enable installment reminder scheduling/);assert.match(migration,/suppressed/);assert.match(migration,/offsets_json JSON/);
});
