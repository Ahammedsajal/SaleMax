'use strict';
// Synthetic schema with real forward migrations/constraints and no provider access.
const mysql=require('mysql2/promise'),crypto=require('node:crypto'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const uuid=()=>crypto.randomUUID();
(async()=>{
 if(process.env.RECEIPT_SYNTHETIC_ONLY!=='true')throw Error('SYNTHETIC_DATABASE_REQUIRED');
 const connection={host:process.env.DBHOST,user:process.env.DBUSER,password:process.env.DBPASS},admin=await mysql.createConnection(connection),name='salemax_receipt_test_'+crypto.randomBytes(6).toString('hex');let pool,server;
 try{
 await admin.query('CREATE DATABASE `'+name+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');pool=mysql.createPool({...connection,database:name,connectionLimit:8});
 const inventory=require('../docs/LEGACY_SCHEMA_INVENTORY.json');
 for(const table of ['admin','plan','web_public','web_private','user','orders','contact_form','beta_chats','beta_conversation','agents','agent_task','instance','beta_flows','contact','phonebook']){
 const columns=inventory.columns.filter(c=>c.tableName===table&&!(table==='instance'&&c.columnName==='inactiveSince'));
 if(!columns.length)continue;
 await pool.query('CREATE TABLE `'+table+'` ('+columns.map(c=>'`'+c.columnName+'` '+c.columnType+' '+(c.nullable==='NO'?'NOT NULL':'')+' '+(c.columnKey==='PRI'?'PRIMARY KEY':'')+' '+(c.extra==='auto_increment'?'AUTO_INCREMENT':'')+' '+(c.columnName==='createdAt'?'DEFAULT CURRENT_TIMESTAMP':'')).join(',')+')');
 }
 const db=await pool.getConnection();try{await require('../database/migration-runner').applyMigrations(db,require('../database/migration-runner').discover(path.join(__dirname,'../database/migrations')));}finally{db.release();}
 const tenant=uuid(),owner=uuid(),manager=uuid(),accountant=uuid(),agent=uuid(),ownerM=uuid(),a=uuid(),b=uuid(),offerA=uuid(),offerB=uuid();
 for(const [id,label] of [[owner,'Owner'],[manager,'Manager'],[accountant,'Accountant'],[agent,'Agent']])await pool.query("INSERT INTO sx_identities(id,email_normalized,display_name,password_hash,status) VALUES (?,?,?,'synthetic','active')",[id,label.toLowerCase()+'@example.invalid',label]);
 await pool.query("INSERT INTO sx_tenants(id,name,slug,category_key,category_version,status) VALUES (?,'Synthetic Centre','synthetic-receipt','training_center',1,'active')",[tenant]);
 await pool.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES (?,?,?,'owner','active')",[ownerM,tenant,owner]);
 const [legacy]=await pool.query("INSERT INTO user(uid,name,role,email) VALUES ('synthetic-receipt-owner','Synthetic Centre','user','synthetic@example.invalid')");
 await pool.query("INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash,verified_at) VALUES ('user',?,?,?,?,UTC_TIMESTAMP())",[String(legacy.insertId),tenant,ownerM,crypto.createHash('sha256').update('synthetic-receipt-owner').digest('hex')]);
 for(const [id,code] of [[a,'SYN-A'],[b,'SYN-B']])await pool.query("INSERT INTO sx_training_courses(id,tenant_id,code,name_en,name_ar,description_en,description_ar,duration_value,duration_unit,delivery_mode,status,created_by_identity_id,updated_by_identity_id) VALUES (?,?,?,?,'تجريبي','','',8,'weeks','in_person','active',?,?)",[id,tenant,code,code,owner,owner]);
 for(const [id,course,price] of [[offerA,a,145000],[offerB,b,320000]])await pool.query("INSERT INTO sx_training_offers(id,tenant_id,course_id,version,currency,price_minor,registration_fee_minor,payment_term_count,payment_interval,inclusions,created_by_identity_id) VALUES (?,?,?,1,'QAR',?,0,1,'once','[]',?)",[id,tenant,course,price,owner]);
 const ctx=(role='manager',identity=manager,tenantId=tenant)=>({audience:'tenant',identity:{id:identity},tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{tenantId,role,status:'active'},category:require('../modules/platform/categories').trainingCenter,subscription:{status:'active',capabilities:['finance.invoices','finance.payments','finance.receipts','finance.installments','training.enrollments','tenant.settings']}});
 const make=async(total=425450)=>{
 const id=uuid(),snapshot={id,invoiceNumber:'INV-2026-'+String(Math.floor(Math.random()*100000)+1).padStart(6,'0'),issuedAt:'2026-10-17T09:00:00Z',currency:'QAR',legalName:'Synthetic Centre',invoicePrefix:'INV',customer:{name:'Synthetic Payer',email:'synthetic-payer@example.invalid',phone:'97450000001'},totalMinor:total,taxMinor:0,lines:[{courseId:a,offerVersion:1,descriptionEn:'Course A',descriptionAr:'دورة أ',quantity:1,unitAmountMinor:145000,discountMinor:14500,totalMinor:130500,taxMinor:0},{courseId:b,offerVersion:1,descriptionEn:'Course B',descriptionAr:'دورة ب',quantity:1,unitAmountMinor:320000,discountMinor:25050,totalMinor:294950,taxMinor:0}],installments:[{dueDate:'2026-10-17',amountMinor:125450},{dueDate:'2026-11-17',amountMinor:300000}]};
 await pool.query('INSERT INTO sx_invoice_generator_documents(id,tenant_id,invoice_number,request_key,payload_hash,customer_type,customer_name,course_id,course_name,amount_minor,snapshot,created_by_identity_id) VALUES (?,?,?,?,?,\'manual\',?,?,?,?,?,?)',[id,tenant,snapshot.invoiceNumber,uuid(),'f'.repeat(64),'Synthetic Payer',a,'Course A / Course B',total,JSON.stringify(snapshot),owner]);return {id,snapshot};
 };
 await pool.query("UPDATE sx_training_offers SET created_at='2026-10-01 00:00:00'");
 const posting=require('../modules/platform/generated-invoice-posting'),payments=require('../modules/platform/training-payments');const doc=await make();
 const post=async(context,id)=>{const db=await pool.getConnection();try{return await posting.post(db,context,{uid:'synthetic-receipt-owner',documentId:id});}finally{db.release();}};
 const result=await post(ctx(),doc.id);assert.equal(result.invoiceNumber,doc.snapshot.invoiceNumber);assert.equal((await post(ctx('accountant',accountant),doc.id)).invoiceId,result.invoiceId);
 const [[count]]=await pool.query('SELECT COUNT(*) AS n FROM sx_training_sale_reviews');assert.equal(Number(count.n),0);
 const [[invoice]]=await pool.query('SELECT * FROM sx_training_invoices WHERE id=?',[result.invoiceId]);assert.equal(Number(invoice.total_minor),425450);assert.equal(invoice.sale_review_id,null);assert.equal(invoice.finance_policy_id,null);
 const [lines]=await pool.query('SELECT total_minor FROM sx_training_invoice_lines WHERE invoice_id=? ORDER BY line_number',[result.invoiceId]);assert.deepEqual(lines.map(l=>Number(l.total_minor)),[130500,294950]);
 const record=async(context,input)=>{const db=await pool.getConnection();try{return await payments.recordAndPost(db,context,result.invoiceId,input);}finally{db.release();}};
 const input={requestKey:uuid(),amountMinor:100000,method:'cash',receivedAt:'2026-10-17T10:00:00+03:00',reference:'SYNTHETIC-1'};
 const paid=await record(ctx(),input);assert.equal(paid.status,'posted');assert.ok(paid.receipt.id);assert.equal(paid.recordedByIdentityId,manager);assert.equal(paid.verifiedByIdentityId,manager);
 const retries=await Promise.all([record(ctx(),input),record(ctx(),input)]);assert.ok(retries.every(r=>r.receipt.id===paid.receipt.id));
 const second=await record(ctx('accountant',accountant),{...input,requestKey:uuid(),amountMinor:325450,method:'fawran',reference:'SYNTHETIC-2'});assert.equal(second.status,'posted');assert.equal(second.receipt.method,'fawran');
 const [[balance]]=await pool.query('SELECT SUM(amount_minor) AS paid FROM sx_training_payment_allocations WHERE invoice_id=?',[result.invoiceId]);assert.equal(Number(balance.paid),425450);
 const [journals]=await pool.query('SELECT e.id,SUM(l.debit_minor) AS debit,SUM(l.credit_minor) AS credit FROM sx_training_journal_entries e JOIN sx_training_journal_lines l ON l.tenant_id=e.tenant_id AND l.entry_id=e.id GROUP BY e.id');assert.ok(journals.every(j=>Number(j.debit)===Number(j.credit)));assert.equal(journals.length,3);
 const [[receiptCount]]=await pool.query('SELECT COUNT(*) AS n FROM sx_training_receipts');assert.equal(Number(receiptCount.n),2);
 await assert.rejects(record(ctx('agent',agent),{...input,requestKey:uuid()}),{code:'PERMISSION_DENIED'});
 await assert.rejects(post(ctx('agent',agent),doc.id),{code:'PERMISSION_DENIED'});
 await assert.rejects(post(ctx('manager',manager,uuid()),doc.id),{code:'BUSINESS_INACTIVE'});
 // A posting failure rolls back payment capture and its audit, not only the receipt.
 const broken=await make(),brokenPosted=await post(ctx(),broken.id);await pool.query('DELETE FROM sx_training_installments WHERE invoice_id=?',[brokenPosted.invoiceId]);
 const db2=await pool.getConnection();try{await assert.rejects(payments.recordAndPost(db2,ctx(),brokenPosted.invoiceId,{...input,requestKey:uuid()}),{code:'INSTALLMENT_SCHEDULE_OUT_OF_SYNC'});}finally{db2.release();}
 const [[pending]]=await pool.query('SELECT COUNT(*) AS n FROM sx_training_payments WHERE invoice_id=?',[brokenPosted.invoiceId]);assert.equal(Number(pending.n),0);
 const race=await make();const concurrent=await Promise.all([post(ctx(),race.id),post(ctx('accountant',accountant),race.id)]);assert.equal(concurrent[0].invoiceId,concurrent[1].invoiceId);

 const express=require('express'),app=express();server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
 const guard=(req,res,next)=>{req.businessContext=ctx(req.get('X-Test-Role')||'manager',req.get('X-Test-Role')==='accountant'?accountant:req.get('X-Test-Role')==='agent'?agent:manager);next();};
 app.use('/finance',require('../modules/platform/training-finance-router').createTrainingFinanceRouter({pool,origin,userGuard:guard,canonicalGuard:guard}));
 const request=async(method,url,body,role='manager',foreign=false)=>{const r=await fetch(origin+'/finance/accountant'+url,{method,headers:{'Content-Type':'application/json',Origin:foreign?'https://foreign.invalid':origin,'X-Test-Role':role},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
 const httpDoc=await make(),preview=await request('GET','/generator/invoices/'+httpDoc.id+'/payment-context');assert.equal(preview.body.success,true);assert.equal(preview.body.data.generatedDocumentId,httpDoc.id);assert.equal(preview.body.data.amountDueMinor,425450);
 const [[unlinked]]=await pool.query('SELECT COUNT(*) AS n FROM sx_training_generated_invoice_links WHERE generated_document_id=?',[httpDoc.id]);assert.equal(Number(unlinked.n),0);
 const httpPayment=await request('POST','/generator/invoices/'+httpDoc.id+'/payments',{...input,requestKey:uuid(),method:'pos'});assert.equal(httpPayment.body.success,true);assert.equal(httpPayment.body.data.status,'posted');assert.ok(httpPayment.body.data.receipt.id);const invoiceId=httpPayment.body.data.invoiceId;
 const detail=await request('GET','/invoices/'+invoiceId);assert.equal(detail.body.success,true);assert.equal(detail.body.data.amountDueMinor,325450);
 const receipt=await request('GET','/receipts/'+httpPayment.body.data.receipt.id);assert.equal(receipt.body.success,true);assert.equal(receipt.body.data.businessIdentity.invoiceNumber,httpDoc.snapshot.invoiceNumber);
 const list=await request('GET','/receipts');assert.equal(list.body.success,true);assert.ok(list.body.data.items.some(r=>r.id===httpPayment.body.data.receipt.id));
 assert.equal((await request('POST','/generator/invoices/'+httpDoc.id+'/post',{},'agent')).status,403);
 assert.equal((await request('POST','/invoices/'+invoiceId+'/payments',{...input,requestKey:uuid()},'agent')).status,403);
 assert.equal((await request('POST','/invoices/'+invoiceId+'/payments',{...input,requestKey:uuid()},'manager',true)).status,403);


 const legacyDoc=await make();const legacySnapshot={...legacyDoc.snapshot,totalMinor:130500,lines:[{...legacyDoc.snapshot.lines[0]}],installments:[{dueDate:'2026-10-17',amountMinor:130500}]};delete legacySnapshot.lines[0].courseId;delete legacySnapshot.lines[0].offerVersion;
 await pool.query('UPDATE sx_invoice_generator_documents SET amount_minor=?,snapshot=? WHERE id=?',[130500,JSON.stringify(legacySnapshot),legacyDoc.id]);
 const legacyPreview=await request('GET','/generator/invoices/'+legacyDoc.id+'/payment-context');assert.equal(legacyPreview.body.success,true);assert.equal(legacyPreview.body.data.lines[0].courseId,a);assert.equal(legacyPreview.body.data.lines[0].offerVersion,1);
 const legacyPayment=await request('POST','/generator/invoices/'+legacyDoc.id+'/payments',{...input,requestKey:uuid(),amountMinor:50000});assert.equal(legacyPayment.body.success,true);assert.ok(legacyPayment.body.data.receipt.id);
 const failedDoc=await make();await pool.query("CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON sx_training_receipts FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_RECEIPT_FAILURE'");
 const failureDb=await pool.getConnection();try{await assert.rejects(posting.recordPayment(failureDb,ctx(),{uid:'synthetic-receipt-owner',documentId:failedDoc.id,input:{...input,requestKey:uuid()}}),{code:'ER_SIGNAL_EXCEPTION'});}finally{failureDb.release();await pool.query('DROP TRIGGER synthetic_receipt_failure');}
 const [[failedLink]]=await pool.query('SELECT COUNT(*) AS n FROM sx_training_generated_invoice_links WHERE generated_document_id=?',[failedDoc.id]);assert.equal(Number(failedLink.n),0);
 const [[failedInvoice]]=await pool.query('SELECT COUNT(*) AS n FROM sx_training_invoices WHERE conversion_key=?',[failedDoc.id]);assert.equal(Number(failedInvoice.n),0);
 const tmp=require('node:os').tmpdir(),fsp=require('node:fs/promises'),proofDir=await fsp.mkdtemp(path.join(tmp,'synthetic-receipt-proof-'));
 try{const proofPath=path.join(proofDir,'proof.png'),bytes=Buffer.from([137,80,78,71,13,10,26,10]);await fsp.writeFile(proofPath,bytes);const proofDb=await pool.getConnection();let proof;try{proof=await require('../modules/platform/training-payment-proofs').upload(proofDb,ctx(),httpPayment.body.data.id,{tempFilePath:proofPath,size:bytes.length,mimetype:'image/png'},{env:{SALEMAX_PAYMENT_PROOF_ROOT:path.join(proofDir,'store')},invoiceId});}finally{proofDb.release();}assert.equal(proof.uploaded,true);}finally{await fsp.rm(proofDir,{recursive:true,force:true});}
 console.log(JSON.stringify({passed:true,checks:['real migration and foreign keys','manager direct invoice posting','accountant posting retry','no fabricated sale approvals','original number and mixed discounts preserved','installment allocation','atomic verified receipt','same-key concurrent receipt replay','balanced invoice/payment journals','agent denial','tenant isolation','payment failure rollback','concurrent invoice posting','manager HTTP invoice payment receipt and register','agent and Origin HTTP denial','proof attachment after direct receipt','read-only picker preview','invoice and payment rollback on receipt failure','legacy single-course PDF without embedded offer references'],customerDataTouched:false,externalMessages:0}));
 }finally{if(server)await new Promise(r=>server.close(r));await pool?.end();await admin.query('DROP DATABASE IF EXISTS `'+name+'`');await admin.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
