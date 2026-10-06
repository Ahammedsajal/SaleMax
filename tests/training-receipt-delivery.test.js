'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const delivery=require('../modules/platform/training-receipt-delivery');

test('receipt email stays off until its dedicated opt-in and complete SMTP configuration are supplied',()=>{
  assert.throws(()=>delivery.config({}),{code:'RECEIPT_DELIVERY_DISABLED'});
  const env={SALEMAX_RECEIPT_EMAIL_ENABLED:'true',LOCAL_ONLY_MODE:'true',SALEMAX_SMTP_HOST:'smtp.example.invalid',SALEMAX_SMTP_PORT:'587',SALEMAX_SMTP_USER:'mailer@example.invalid',SALEMAX_SMTP_PASS:'synthetic-secret',SALEMAX_RECEIPT_FROM:'receipts@example.invalid'};
  assert.throws(()=>delivery.config({...env,SALEMAX_SMTP_PASS:''}),{code:'RECEIPT_SMTP_NOT_CONFIGURED'});
  const result=delivery.config(env);assert.equal(result.host,'smtp.example.invalid');assert.equal(result.secure,false);assert.equal(result.from,'receipts@example.invalid');
});

test('receipt delivery status is tenant-scoped and reports disabled, sent, queued and partial states',async()=>{
  const ids=['receipt-disabled','receipt-sent','receipt-queued','receipt-partial'],queries=[];
  const db={async query(sql,params){queries.push({sql,params});return [[
    {receipt_id:'receipt-sent',status:'sent',count:2},
    {receipt_id:'receipt-queued',status:'ready',count:1},
    {receipt_id:'receipt-partial',status:'sent',count:1},
    {receipt_id:'receipt-partial',status:'dead',count:1}
  ]];}};
  const result=await delivery.statuses(db,'tenant-a',ids,{env:{}});
  assert.equal(result.get('receipt-disabled').state,'disabled');
  assert.equal(result.get('receipt-sent').state,'sent');
  assert.equal(result.get('receipt-queued').state,'paused');
  assert.equal(result.get('receipt-partial').state,'partial');
  assert.equal(result.get('receipt-partial').failed,1);
  assert.equal(queries.length,1);assert.equal(queries[0].params[0],'tenant-a');assert.deepEqual(queries[0].params.slice(1),ids);
  assert.match(queries[0].sql,/tenant_id=\?/);
});

test('receipt recipients are validated, deduplicated and limited to customer, owner and accountant',()=>{
  const result=delivery.recipients({customerEmail:' Learner@example.invalid ',staff:[{role:'owner',email:'admin@example.invalid'},{role:'accountant',email:'books@example.invalid'},{role:'manager',email:'manager@example.invalid'},{role:'accountant',email:'BOOKS@example.invalid'}]});
  assert.deepEqual(result.map(item=>[item.email,item.type]),[['learner@example.invalid','customer'],['admin@example.invalid','admin'],['books@example.invalid','accountant']]);
  assert.equal(delivery.recipients({customerEmail:'bad',staff:[]}).length,0);
});

test('receipt email is bilingual, escapes receipt data and targets one recipient per message',()=>{
  const receipt={from:'receipts@example.invalid',receiptNumber:'R-2026-000001',invoiceNumber:'TC-2026-000001',payerName:'<script>alert(1)</script>',courseNameEn:'Safety <Basics>',currency:'QAR',amountMinor:50000,receivedAt:'2026-10-03T10:00:00.000Z',businessProfile:{nameEn:'Center English',nameAr:'مركز عربي',logoUrl:'https://example.invalid/logo.png'}};
  const rendered=delivery.message(receipt,'learner@example.invalid');assert.equal(rendered.to,'learner@example.invalid');assert.match(rendered.subject,/إيصال دفع/);assert.match(rendered.text,/Center English \/ مركز عربي/);assert.match(rendered.html,/https:\/\/example\.invalid\/logo\.png/);assert.match(rendered.html,/&lt;script&gt;/);assert.doesNotMatch(rendered.html,/<script>/);assert.match(rendered.html,/QAR/);
});

test('SMTP acceptance must name the intended recipient and otherwise remains retryable',()=>{
  assert.doesNotThrow(()=>delivery.accepted({accepted:['Learner@example.invalid']},'learner@example.invalid'));
  assert.throws(()=>delivery.accepted({accepted:[]},'learner@example.invalid'),{code:'SMTP_RECIPIENT_NOT_ACCEPTED'});
});

test('outbox worker can claim only receipt events without consuming unrelated notification events',async()=>{
  const tenantId='00000000-0000-4000-8000-000000000002',queries=[];
  const db={async beginTransaction(){},async commit(){},async rollback(){},async query(sql,params){queries.push({sql,params});return [[]];}};
  const ctx={audience:'tenant',tenant:{id:tenantId,status:'active'},membership:{tenantId,role:'owner',status:'active'},subscription:{capabilities:['finance.invoices']}};
  const result=await require('../modules/platform/training-outbox').claim(db,ctx,{workerId:'receipt-test-worker',limit:4,leaseSeconds:60,eventTypes:['finance.receipt.issued']});
  assert.deepEqual(result.items,[]);assert.equal(result.externalDispatch,false);assert.match(queries[0].sql,/event_type IN \(\?\)/);assert.deepEqual(queries[0].params,[tenantId,['finance.receipt.issued'],4]);
  await assert.rejects(require('../modules/platform/training-outbox').claim(db,ctx,{workerId:'receipt-test-worker',limit:4,leaseSeconds:60,eventTypes:['*']}),{code:'INVALID_OUTBOX_WORKER'});
});

test('app starts only the explicitly opted-in receipt worker while other providers stay local-only',()=>{
  const runtime=require('../modules/platform/training-receipt-worker-runtime'),calls=[],spawnProcess=(...args)=>{calls.push(args);return {pid:123};};
  assert.equal(runtime.start({env:{SALEMAX_RECEIPT_EMAIL_ENABLED:'false'},spawnProcess}),null);
  const env={SALEMAX_RECEIPT_EMAIL_ENABLED:'true',LOCAL_ONLY_MODE:'true',SALEMAX_SMTP_HOST:'smtp.example.invalid',SALEMAX_SMTP_PORT:'587',SALEMAX_SMTP_USER:'mailer@example.invalid',SALEMAX_SMTP_PASS:'synthetic-only',SALEMAX_RECEIPT_FROM:'receipts@example.invalid'};
  assert.equal(runtime.start({env:{...env,SALEMAX_SMTP_PASS:''},spawnProcess}),null);
  assert.equal(runtime.start({env,spawnProcess,root:'C:\\salemax'}).pid,123);assert.equal(calls.length,1);assert.equal(calls[0][1][0],path.join('C:\\salemax','scripts','training-receipt-worker.cjs'));assert.equal(calls[0][2].env,env);assert.equal(calls[0][2].stdio,'inherit');
});
