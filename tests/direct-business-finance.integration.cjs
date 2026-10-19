'use strict';
// Disposable local database only. No customer data or provider calls.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),mysql=require('mysql2/promise');
const finance=require('../modules/platform/sales-finance'),{getCategory}=require('../modules/platform/categories');
const uuid=()=>crypto.randomUUID();
(async()=>{
 if(process.env.LOCAL_ONLY_MODE!=='true'||!['127.0.0.1','localhost'].includes(process.env.DBHOST))throw Error('LOCAL_DATABASE_ONLY');
 const config={host:process.env.DBHOST,port:Number(process.env.DBPORT),user:process.env.DBUSER,password:process.env.DBPASS||''};
 const admin=await mysql.createConnection(config),name='salemax_migration_test_direct_'+crypto.randomBytes(5).toString('hex');let pool,server;
 try{
  await admin.query('CREATE DATABASE `'+name+'`');pool=mysql.createPool({...config,database:name,connectionLimit:6});
  const inventory=require('../docs/LEGACY_SCHEMA_INVENTORY.json');
  for(const table of [...new Set(inventory.columns.map(c=>c.tableName).filter(Boolean))]){
   const columns=inventory.columns.filter(c=>c.tableName===table&&!(table==='instance'&&c.columnName==='inactiveSince'));if(!columns.length)continue;
   const primary=columns.filter(c=>c.columnKey==='PRI').map(c=>'`'+c.columnName+'`');await pool.query('CREATE TABLE `'+table+'` ('+[...columns.map(c=>'`'+c.columnName+'` '+c.columnType+' '+(c.nullable==='NO'?'NOT NULL':'')+' '+(c.extra==='auto_increment'?'AUTO_INCREMENT':'')+' '+(c.columnName==='createdAt'?'DEFAULT CURRENT_TIMESTAMP':'')),...(primary.length?['PRIMARY KEY ('+primary.join(',')+')']:[])].join(',')+')');
  }
  const runner=require('../database/migration-runner'),migrations=runner.discover(path.join(__dirname,'../database/migrations')),db=await pool.getConnection();try{await runner.applyMigrations(db,migrations);await runner.applyMigrations(db,migrations);}finally{db.release();}
  const identity=uuid(),tenant=uuid(),other=uuid(),training=uuid(),member=uuid();
  await pool.query("INSERT INTO sx_identities(id,email_normalized,display_name,password_hash,status) VALUES (?,'direct@example.invalid','Synthetic manager','synthetic','active')",[identity]);
  for(const [id,category] of [[tenant,'salemax_sales'],[other,'salemax_sales'],[training,'training_center']])await pool.query("INSERT INTO sx_tenants(id,name,slug,category_key,category_version,status) VALUES (?,'Synthetic Business',?,?,1,'active')",[id,'direct-'+id,category]);
  await pool.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES (?,?,?,'manager','active')",[member,tenant,identity]);
  const ctx=(role='manager',tenantId=tenant,categoryKey='salemax_sales',customPermissions=null)=>({audience:'tenant',identity:{id:identity},tenant:{id:tenantId,name:'Synthetic Business',status:'active',categoryKey,categoryVersion:1},membership:{id:member,tenantId,role,status:'active',customPermissions},category:getCategory(categoryKey,1),subscription:{status:'active',capabilities:[...getCategory(categoryKey,1).capabilities]}});
  const use=async(fn)=>{const connection=await pool.getConnection();try{return await fn(connection);}finally{connection.release();}};
  const data={idempotencyKey:uuid(),customerName:'Synthetic Customer',customerMobile:'+97450000000',description:'Website services',totalMinor:'250050',currency:'QAR',dueAt:'2026-12-31'};
  const attempts=await Promise.all([use(db=>finance.createInvoice(db,ctx(),data)),use(db=>finance.createInvoice(db,ctx(),data))]);assert.equal(attempts[0].id,attempts[1].id);assert.equal(attempts.filter(x=>!x.repeated).length,1);
  const invoice=attempts[0];assert.match(invoice.invoiceNumber,/^SMX-\d{4}-\d{6}$/);
  await assert.rejects(use(db=>finance.createInvoice(db,ctx(),{...data,totalMinor:'1'})),{code:'IDEMPOTENCY_CONFLICT'});
  const [[row]]=await pool.query('SELECT deal_id FROM sx_sales_invoices WHERE id=?',[invoice.id]);assert.equal(row.deal_id,null);
  const [[deals]]=await pool.query('SELECT COUNT(*) AS n FROM sx_sales_deals');assert.equal(Number(deals.n),0);
  const [[accountants]]=await pool.query("SELECT COUNT(*) AS n FROM sx_memberships WHERE role='accountant'");assert.equal(Number(accountants.n),0);
  const receiptInput={idempotencyKey:uuid(),payerName:'Synthetic Customer',amountMinor:'150000',currency:'QAR',paymentMethod:'cash',receivedAt:'2026-10-19T06:00:00Z',externalReference:'SYNTHETIC-1'};
  const receipts=await Promise.all([use(db=>finance.recordReceipt(db,ctx(),receiptInput)),use(db=>finance.recordReceipt(db,ctx(),receiptInput))]);assert.equal(receipts[0].id,receipts[1].id);assert.match(receipts[0].receiptNumber,/^RCP-\d{4}-\d{6}$/);
  await use(db=>finance.allocateReceipt(db,ctx(),{receiptId:receipts[0].id,invoiceId:invoice.id,idempotencyKey:uuid(),amountMinor:'150000'}));
  assert.equal(String((await use(db=>finance.listInvoices(db,ctx()))).items[0].outstandingMinor),'100050');
  for(const kind of ['invoice','receipt']){const id=kind==='invoice'?invoice.id:receipts[0].id,doc=await use(db=>finance.document(db,ctx(),kind,id));assert.equal(doc.businessName,'Synthetic Business');await assert.rejects(use(db=>finance.document(db,ctx('owner',other),kind,id)),{code:kind==='invoice'?'SALES_INVOICE_NOT_FOUND':'SALES_RECEIPT_NOT_FOUND'});}
  await assert.rejects(use(db=>finance.createInvoice(db,ctx('agent'),{...data,idempotencyKey:uuid()})),{code:'PERMISSION_DENIED'});
  const grants=['sales.finance.read','sales.invoice.issue','sales.receipt.record','sales.receipt.allocate'];
  const staff=ctx('agent',tenant,'salemax_sales',grants);assert.ok((await use(db=>finance.createInvoice(db,staff,{...data,idempotencyKey:uuid()}))).id);
  const restricted=ctx();restricted.membership.assignedNavigation=['leads'];await assert.rejects(use(db=>finance.createInvoice(db,restricted,{...data,idempotencyKey:uuid()})),{code:'PERMISSION_DENIED'});
  const inactive=ctx();inactive.membership.status='suspended';await assert.rejects(use(db=>finance.createInvoice(db,inactive,data)),{code:'ACCOUNT_INACTIVE'});
  // Shared direct-document capability also accepts the other real business category.
  const trainingInvoice=await use(db=>finance.createInvoice(db,ctx('owner',training,'training_center'),{...data,idempotencyKey:uuid()}));assert.ok(trainingInvoice.id);
  const trainingReceipt=await use(db=>finance.recordReceipt(db,ctx('owner',training,'training_center'),{...receiptInput,idempotencyKey:uuid()}));assert.ok(trainingReceipt.receiptNumber);
  // A failed audit must roll back the invoice and its sequence update.
  const failedKey=uuid();await use(async db=>{const query=db.query.bind(db);db.query=(sql,args)=>sql.includes('INSERT INTO sx_audit_events')?Promise.reject(Object.assign(Error('synthetic audit failure'),{code:'SYNTHETIC_FAILURE'})):query(sql,args);try{await assert.rejects(finance.createInvoice(db,ctx(),{...data,idempotencyKey:failedKey}),{code:'SYNTHETIC_FAILURE'});}finally{db.query=query;}});
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM sx_sales_invoices WHERE idempotency_key=?',[failedKey]))[0][0].n),0);
  const express=require('express'),app=express();server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const sessionGuard=(req,res,next)=>{req.featureSession={context:ctx(req.get('x-test-role')||'manager')};next();};
  app.use('/api/user/sales-finance',require('../modules/platform/sales-finance-router').createSalesFinanceRouter({pool,origin,canonicalGuard:()=>{throw Error('UNIFIED_SESSION_NOT_USED');},sessionGuard}));
  const headers={'Content-Type':'application/json',Origin:origin};
  let response=await fetch(origin+'/api/user/sales-finance/invoices',{method:'POST',headers,body:JSON.stringify({...data,idempotencyKey:uuid()})});assert.equal(response.status,201);const httpInvoice=(await response.json()).data;
  response=await fetch(origin+'/api/user/sales-finance/documents/invoice/'+httpInvoice.id);assert.equal(response.status,200);
  response=await fetch(origin+'/api/user/sales-finance/invoices',{method:'POST',headers:{...headers,'x-test-role':'agent'},body:JSON.stringify(data)});assert.equal(response.status,403);
  response=await fetch(origin+'/api/user/sales-finance/invoices',{method:'POST',headers:{...headers,Origin:'https://untrusted.example.invalid'},body:JSON.stringify(data)});assert.equal(response.status,403);assert.equal((await response.json()).code,'ORIGIN_DENIED');
  response=await fetch(origin+'/api/user/sales-finance/receipts',{method:'POST',headers,body:JSON.stringify({...receiptInput,idempotencyKey:uuid()})});assert.equal(response.status,201);assert.ok((await response.json()).data.receiptNumber);
  console.log(JSON.stringify({success:true,migrations:migrations.length,accountants:0,deals:0,categories:['salemax_sales','training_center'],checks:['direct manager invoice','direct numbered receipt','concurrent replay','conflicting retry','tenant isolation','explicit staff grant','ungranted staff denial','sidebar restriction','inactive member','transaction rollback','unified session HTTP','origin denial','print document data'],customerDataTouched:false,externalWrites:false}));
 }finally{if(server)await new Promise(r=>server.close(r));if(pool)await pool.end();await admin.query('DROP DATABASE IF EXISTS `'+name+'`');await admin.end();}
})().catch(error=>{console.error(error);process.exitCode=1;});
