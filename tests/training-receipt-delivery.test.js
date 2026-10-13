'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const delivery=require('../modules/platform/training-receipt-delivery');
const documentDelivery=require('../modules/platform/training-document-delivery');

test('document delivery requires an approved WhatsApp template and only renders customer document links',()=>{
  assert.throws(()=>documentDelivery.whatsappConfig({}),{code:'RECEIPT_WHATSAPP_NOT_CONFIGURED'});
  const config=documentDelivery.whatsappConfig({SALEMAX_RECEIPT_WHATSAPP_ENABLED:'true',SALEMAX_RECEIPT_WHATSAPP_TEMPLATE:'customer_invoice_link',SALEMAX_RECEIPT_WHATSAPP_LANGUAGE:'en_US',SALEMAX_META_GRAPH_VERSION:'v24.0'});
  assert.equal(config.template,'customer_invoice_link');assert.equal(config.language,'en_US');
  assert.throws(()=>documentDelivery.whatsappConfig({SALEMAX_RECEIPT_WHATSAPP_ENABLED:'true',SALEMAX_RECEIPT_WHATSAPP_TEMPLATE:'bad-name'}),{code:'RECEIPT_WHATSAPP_NOT_CONFIGURED'});
  const rendered=documentDelivery.content({type:'invoice',number:'INV<&',url:'https://crm.example.invalid/customer-document#opaque',from:'billing@example.invalid',to:'customer@example.invalid'});
  assert.equal(rendered.to,'customer@example.invalid');assert.match(rendered.html,/INV&lt;&amp;/);assert.match(rendered.text,/customer-document#opaque/);
});

test('document sending records tenant-scoped idempotency and provider acceptance before returning',async()=>{
  const uuid='019c6e27-e55b-43d1-87d8-4e01f1f75043',queries=[],sent=[];
  const db={async query(sql,params){queries.push({sql,params});if(sql.startsWith('SELECT id,document_type'))return [[]];if(sql.startsWith('SELECT COUNT(*)'))return [[{sends:0}]];return [{affectedRows:1}];}};
  const env={SALEMAX_RECEIPT_EMAIL_ENABLED:'true',SALEMAX_SMTP_HOST:'smtp.example.invalid',SALEMAX_SMTP_PORT:'587',SALEMAX_SMTP_USER:'mailer@example.invalid',SALEMAX_SMTP_PASS:'synthetic-secret',SALEMAX_RECEIPT_FROM:'receipts@example.invalid'};
  const ctx={tenant:{id:'tenant-1'},identity:{id:'identity-1'}};
  const result=await documentDelivery.deliver(db,ctx,{type:'receipt',id:uuid,channel:'email',requestKey:uuid,origin:'https://crm.example.invalid',env,sendMail:async message=>{sent.push(message);return {accepted:[message.to],messageId:'smtp-id'};}},{issueGrant:async(_db,_ctx,_type,_id,options)=>{assert.equal(options.preserveExisting,true);return {recipientEmail:'customer@example.invalid',recipientPhone:'+97455555555',url:'https://crm.example.invalid/customer-document#opaque',documentNumber:'RCT-100'};}});
  assert.equal(result.status,'accepted');assert.equal(result.providerMessageId,'smtp-id');assert.equal(sent.length,1);assert.match(sent[0].text,/customer-document#opaque/);assert.match(queries[2].sql,/INSERT INTO sx_training_document_deliveries/);assert.match(queries[3].sql,/SET status=\?/);assert.equal(queries[4].params[3],'training.document-email-accepted');
});

test('WhatsApp document delivery sends the approved template to the document phone',async()=>{
  const uuid='019c6e27-e55b-43d1-87d8-4e01f1f75043',requests=[];
  const db={async query(sql){if(sql.startsWith('SELECT id,document_type'))return [[]];if(sql.startsWith('SELECT COUNT(*)'))return [[{sends:0}]];return [{affectedRows:1}];}};
  const env={SALEMAX_RECEIPT_WHATSAPP_ENABLED:'true',SALEMAX_RECEIPT_WHATSAPP_TEMPLATE:'customer_invoice_link',SALEMAX_RECEIPT_WHATSAPP_LANGUAGE:'en_US',SALEMAX_META_GRAPH_VERSION:'v24.0'};
  const result=await documentDelivery.deliver(db,{tenant:{id:'tenant-1'},identity:{id:'identity-1'}},{type:'invoice',id:uuid,channel:'whatsapp',requestKey:uuid,origin:'https://crm.example.invalid',env,http:{async post(url,body,options){requests.push({url,body,options});return {data:{messages:[{id:'wamid.test'}]}};}}},{issueGrant:async()=>({recipientEmail:'customer@example.invalid',recipientPhone:'+97455555555',url:'https://crm.example.invalid/customer-document#opaque',documentNumber:'INV-100'}),tenantMetaCredentials:async(_db,tenantId)=>{assert.equal(tenantId,'tenant-1');return {token:'mock-token',phoneId:'1234567890'};}});
  assert.equal(result.status,'accepted');assert.equal(result.providerMessageId,'wamid.test');assert.equal(requests.length,1);assert.equal(requests[0].body.to,'97455555555');assert.deepEqual(requests[0].body.template.components[0].parameters.map(item=>item.text),['INV-100','https://crm.example.invalid/customer-document#opaque']);assert.equal(requests[0].options.headers.Authorization,'Bearer mock-token');
});

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
