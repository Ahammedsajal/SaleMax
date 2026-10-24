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
test('phone normalization requires a country context for local numbers',()=>{assert.equal(qr.phone('+974 5000 0001'),'97450000001');assert.equal(qr.phone('0097450000001'),'97450000001');assert.equal(qr.phone('50000001'),null);assert.equal(qr.phone('50000001',{countryCode:'974'}),'97450000001');assert.equal(qr.phone('abc'),null);});
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
test('summary contains daily and month-to-date business metrics without chat/pipeline totals',()=>{
 const text=reports.text({business:'Example Center',day:'2026-10-22',timezone:'Asia/Qatar',asOf:'6 PM',daily:{leads:5,convertedLeads:2,applications:3,invoices:2},monthToDate:{leads:20,convertedLeads:6,applications:12,invoices:8},finance:[{currency:'QAR',daily:{invoiced:10000,received:4000},month:{invoiced:85000,received:42000},receivable:43000,overdue:9000,aging:{days1to30:5000,days31to60:2000,days61to90:1000,daysOver90:1000}},{currency:'USD',daily:{invoiced:2000,received:0},month:{invoiced:2000,received:0},receivable:2000,overdue:0,aging:{days1to30:0,days31to60:0,days61to90:0,daysOver90:0}}]});assert.match(text,/Leads invoiced: 2/);assert.match(text,/month to date/i);assert.match(text,/Applications: 12/);assert.match(text,/QAR/);assert.match(text,/USD/);assert.match(text,/Total receivable/);assert.match(text,/Aging over 90 days/);assert.doesNotMatch(text,/chat|pipeline/i);
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
test('daily report dispatch suppresses verified non-owner recipients',async()=>{
 const staff=qr.staff;qr.staff=async()=>[{id:tenant,phone:'97450119041'}];
 const db={query:async()=>[[{destination:'+97450000002'}]]};
 try{const result=await notifications.dispatch(db,{tenant_id:tenant,kind:'daily_summary',recipient_kind:'report_recipient',recipient_id:id,destination_hash:qr.hash('97450000002'),payload_json:{snapshot:{business:'Center'}}},{authorize:async()=>true,send:()=>assert.fail('daily summary must not reach a non-owner')});assert.deepEqual(result,{status:'suppressed',errorCode:'DAILY_REPORT_OWNER_ONLY'});}finally{qr.staff=staff;}
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
test('PDF has a valid signature and an organized daily plus month-to-date layout',async()=>{
 const pdf=await require('../modules/platform/business-report-pdf').render({business:'Example Center',day:'2026-10-22',month:'2026-10',timezone:'Asia/Qatar',asOf:'6 PM',daily:{leads:7,convertedLeads:2,applications:3,invoices:2},monthToDate:{leads:40,convertedLeads:12,applications:24,invoices:18},finance:[{currency:'QAR',daily:{invoiced:100000,received:40000},month:{invoiced:500000,received:210000},receivable:290000,overdue:60000,aging:{days1to30:30000,days31to60:10000,days61to90:10000,daysOver90:10000}}]},{test:true});assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>2000);assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,2);
});
