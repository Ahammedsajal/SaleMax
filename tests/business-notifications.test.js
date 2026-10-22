'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const finance=require('../modules/platform/business-finance-context');
const qr=require('../modules/platform/business-whatsapp');
const reports=require('../modules/platform/business-daily-report');
const notifications=require('../modules/platform/business-notifications');
const tenant='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const sample={number:'INV-2026-0123',customer:'Sample learner',phone:'+97455550000',product:'Excel training',currency:'QAR',total:100000,balance:60000,received:40000,dueDate:'2026-10-25',receivedAt:'2026-10-22'};
test('financial messages use understandable labels and correct monetary units',()=>{
 const text=finance.message('payment_received',sample,{business:'Example Center'});assert.match(text,/Customer \/ Lead: Sample learner/);assert.match(text,/Invoice: INV-2026-0123/);assert.match(text,/400\.00/);assert.match(text,/600\.00/);assert.doesNotMatch(text,/tenant_id|source_type|channel:|Conversation:/i);
 assert.match(finance.message('payment_due',{...sample,amountDue:20000}),/200\.00/);assert.match(finance.message('invoice_issued',sample,{test:true}),/TEST \/ SAMPLE/);
});
test('amount formatter rejects unsafe, negative and non-integral monetary values',()=>{for(const n of [-1,0.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>finance.money(n));});
test('receipt dates near UTC midnight use the Qatar business date',()=>{assert.equal(finance.date(new Date('2026-10-21T22:30:00Z')),'2026-10-22');assert.equal(finance.date('2026-10-25'),'2026-10-25');});
test('phone normalization requires a country context for local numbers',()=>{assert.equal(qr.phone('+974 5516 0323'),'97455160323');assert.equal(qr.phone('0097455160323'),'97455160323');assert.equal(qr.phone('55160323'),null);assert.equal(qr.phone('55160323',{countryCode:'974'}),'97455160323');assert.equal(qr.phone('abc'),null);});
test('QR origin cannot point to an external service or carry credentials',()=>{
 for(const origin of ['https://evil.test','http://127.0.0.1.evil.test','http://user:pass@localhost','http://localhost/path'])assert.throws(()=>qr.internalConfig({CRM_INTERNAL_SECRET:'test',SALEMAX_TASK_QR_INTERNAL_ORIGIN:origin}));
 assert.throws(()=>qr.internalConfig({CRM_INTERNAL_SECRET:'test',LOCAL_ONLY_MODE:'true'}));
});
test('default QR uses a sole owner connection; ambiguity does not silently pick a number',async()=>{
 const query=rows=>({query:async()=>[rows]});
 assert.equal((await qr.sender(query([{id:1,role:'owner'},{id:2,role:'manager'}]),tenant)).id,1);
 assert.equal(await qr.sender(query([{id:1,role:'owner'},{id:2,role:'owner'}]),tenant),null);
 assert.equal((await qr.sender(query([{id:1,role:'owner',qr_instance_id:2},{id:2,role:'manager',qr_instance_id:2}]),tenant)).id,2);
});
test('timeout is unknown and never presented as safe to retry',async()=>{
 const db={query:async()=>[[{id:1,uid:'test',number:'97450000000',role:'owner'}]]},env={CRM_INTERNAL_SECRET:'test'};
 const result=await qr.send(db,{tenantId:tenant,to:'97455550000',text:'sample',env,http:{post:async()=>{throw {code:'ETIMEDOUT'};}}});assert.equal(result.status,'unknown');
 const rejected=await qr.send(db,{tenantId:tenant,to:'97455550000',text:'sample',env,http:{post:async()=>{throw {response:{status:404}};}}});assert.equal(rejected.status,'blocked');
 const accepted=await qr.send(db,{tenantId:tenant,to:'97455550000',text:'sample',env,http:{post:async()=>({data:{success:true,data:{messageId:'sample-id'}}})}});assert.deepEqual(accepted,{status:'accepted',providerMessageId:'sample-id'});
});
test('summary keeps currencies separate and marks current balances',()=>{
 const text=reports.text({business:'Example Center',day:'2026-10-22',timezone:'Asia/Qatar',asOf:'6 PM',newChats:7,newLeads:5,invoices:2,payments:1,finance:[{currency:'QAR',invoiced:10000,received:4000,outstanding:6000,overdue:0},{currency:'USD',invoiced:2000,received:0,outstanding:2000,overdue:0}]});assert.match(text,/New incoming chats: 7/);assert.match(text,/Invoices created: 2/);assert.match(text,/QAR totals/);assert.match(text,/USD totals/);assert.match(text,/current/);
});
test('recipient preparation includes owners/managers and customer, deduplicating identical phone numbers',async()=>{
 const originalLoad=finance.load,originalStaff=qr.staff;const inserted=[];
 finance.load=async()=>({...sample,invoiceId:id});qr.staff=async()=>[{kind:'identity',id:tenant,phone:'97450000000'},{kind:'identity',id,phone:'97450000000'}];
 const db={query:async(sql,args)=>{if(sql.startsWith('SELECT status'))return [[]];if(sql.startsWith('INSERT INTO sx_business_notification_deliveries'))inserted.push(args);return [[]];}};
 try{await notifications.prepare(db,{id,tenant_id:tenant,kind:'payment_received',source_type:'training_receipt',source_id:id,payload_json:null},{name:'Example Center'});assert.equal(inserted.length,2);assert.equal(inserted[0][2],'identity');assert.equal(inserted[1][2],'customer');assert.equal(inserted[1][4],qr.hash('97455550000'));}finally{finance.load=originalLoad;qr.staff=originalStaff;}
});
test('invoice alerts target staff only, and event insertion is idempotent within the caller transaction',async()=>{
 const load=finance.load,staff=qr.staff;let customers=0;
 finance.load=async()=>({...sample,invoiceId:id});qr.staff=async()=>[{kind:'identity',id,phone:'97450000000'}];
 const db={query:async(sql,args)=>{if(sql.startsWith('INSERT INTO sx_business_notification_deliveries')&&args[2]==='customer')customers++;return [[]];}};
 try{await notifications.prepare(db,{id,tenant_id:tenant,kind:'invoice_issued',source_type:'generated',source_id:id},{name:'Center'});assert.equal(customers,0);}finally{finance.load=load;qr.staff=staff;}
 const duplicate={query:async()=>{throw {code:'ER_DUP_ENTRY'};}};assert.deepEqual(await notifications.enqueue(duplicate,tenant,{kind:'invoice_issued',sourceType:'generated',sourceId:id,key:`invoice:${id}`}),{repeated:true});
});
test('removed staff and changed phone numbers are rechecked before dispatch',async()=>{
 const load=finance.load,staff=qr.staff;finance.load=async()=>({...sample,invoiceId:id});qr.staff=async()=>[{id,phone:'97459999999'}];
 try{const result=await notifications.dispatch({}, {id,tenant_id:tenant,kind:'invoice_issued',source_type:'generated',source_id:id,recipient_kind:'identity',recipient_id:id,destination_hash:qr.hash('97450000000'),payload_json:{business:'Center'}} ,{authorize:async()=>true,send:()=>assert.fail('must not send')});assert.equal(result.errorCode,'RECIPIENT_NUMBER_CHANGED');qr.staff=async()=>[];assert.equal((await notifications.dispatch({}, {tenant_id:tenant,kind:'invoice_issued',recipient_kind:'identity',recipient_id:id},{authorize:async()=>true})).status,'blocked');}finally{finance.load=load;qr.staff=staff;}
});
test('paid/cancelled resources suppress queued notices',async()=>{
 const load=finance.load;finance.load=async()=>null;try{const result=await notifications.dispatch({}, {tenant_id:tenant,kind:'payment_due',source_type:'training_invoice',source_id:id},{authorize:async()=>true,send:()=>assert.fail('must not send')});assert.equal(result.status,'suppressed');}finally{finance.load=load;}
});
test('open payment disputes suppress generated-invoice due reminders',async()=>{
 const db={query:async(sql)=>{if(sql.includes('SELECT d.*'))return [[{id,invoice_number:'TEST',customer_name:'Sample',course_name:'Test course',amount_minor:10000,snapshot:{currency:'QAR',totalMinor:10000,customer:{name:'Sample',phone:'+97455550000'},installments:[{dueDate:'2026-10-22',amountMinor:10000}]}}]];if(sql.includes('sx_training_generated_invoice_links'))return [[]];if(sql.includes('sx_training_payment_disputes'))return [[{id:'open-dispute'}]];assert.fail('Unexpected query');}};
 assert.equal(await finance.load(db,{tenant_id:tenant,kind:'payment_due',source_type:'generated',source_id:id,payload_json:{dueDate:'2026-10-22'}}),null);
});
test('unknown send outcome is saved as unknown with a lease guard',async()=>{
 let args;const db={query:async(sql,values)=>{assert.match(sql,/lease_token=\?/);args=values;return [{affectedRows:1}];}};
 await notifications.finish(db,{id:1,tenant_id:tenant,token:'lease',attempts:1},{status:'unknown',errorCode:'TEST_TIMEOUT'});assert.equal(args[0],'unknown');
});
test('PDF has a valid signature and does not create a blank trailing page',async()=>{
 const pdf=await require('../modules/platform/business-report-pdf').render({business:'Example Center',day:'2026-10-22',timezone:'Asia/Qatar',asOf:'6 PM',newChats:7,newLeads:5,invoices:2,payments:1,pipeline:[{status:'open',total:5}],finance:[{currency:'QAR',invoiced:100000,received:40000,outstanding:60000,overdue:0}]},{test:true});assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>2000);assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,1);
});
