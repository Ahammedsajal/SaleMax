'use strict';
const mysql=require('mysql2/promise'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),express=require('express');
const {discover,applyMigrations}=require('../database/migration-runner');
const {createTrainingFinanceRouter}=require('../modules/platform/training-finance-router');
const uuid=()=>crypto.randomUUID();
async function main(){
  if(process.env.LOCAL_ONLY_MODE!=='true')throw Error('Disposable local mode required');
  const port=Number(process.env.INVOICE_TEST_PORT);if(!Number.isSafeInteger(port)||port<3307)throw Error('Explicit test port required');
  const name='salemax_invoice_edit_test_'+crypto.randomBytes(6).toString('hex');
  const admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'});let pool,server;
  try{
    await admin.query('CREATE DATABASE '+name+' CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database:name,connectionLimit:4});
    const tenant=uuid(),identity=uuid(),a=uuid(),b=uuid();
    const ddl=[
      "CREATE TABLE sx_tenants(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,name VARCHAR(200),status VARCHAR(20),category_key VARCHAR(50),category_version INT)",
      "CREATE TABLE sx_identities(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,status VARCHAR(20))",
      "CREATE TABLE sx_training_courses(tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,name_en VARCHAR(200),name_ar VARCHAR(200),code VARCHAR(20),status VARCHAR(20),deleted_at DATETIME NULL,PRIMARY KEY(tenant_id,id))",
      "CREATE TABLE sx_training_offers(tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,course_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,version INT,currency VARCHAR(3),price_minor BIGINT,registration_fee_minor BIGINT,status VARCHAR(20),valid_from DATE NULL,valid_until DATE NULL)",
      "CREATE TABLE sx_training_center_profiles(tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,display_name_en VARCHAR(200),display_name_ar VARCHAR(200),legal_name VARCHAR(200),cr_number VARCHAR(100),address_en VARCHAR(1000),address_ar VARCHAR(1000),invoice_prefix VARCHAR(16),invoice_footer VARCHAR(500),logo_url VARCHAR(1000))",
      "CREATE TABLE sx_training_generated_invoice_links(tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,generated_document_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,invoice_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,PRIMARY KEY(tenant_id,generated_document_id))",
      "CREATE TABLE sx_training_invoices(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,invoice_number VARCHAR(64))",
      "CREATE TABLE user(id INT PRIMARY KEY,uid VARCHAR(100))",
      "CREATE TABLE sx_legacy_ownership(source_table VARCHAR(20),source_id VARCHAR(20),tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,membership_id VARCHAR(36),legacy_uid_hash VARCHAR(64))"
    ,"CREATE TABLE sx_memberships(id VARCHAR(36),tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,role VARCHAR(20),status VARCHAR(20))"];for(const sql of ddl)await pool.query(sql);
    await pool.query("INSERT INTO sx_tenants VALUES(?,?,'active','training_center',1)",[tenant,'Synthetic Training Center']);await pool.query('INSERT INTO sx_identities(id,status) VALUES(?,?)',[identity,'active']);
    await pool.query("INSERT INTO sx_training_center_profiles VALUES(?,?,'مركز تجريبي',?,'TEST-CR','Doha','الدوحة','INV',NULL,NULL)",[tenant,'Synthetic Training Center','Synthetic Training Center']);
    await pool.query("INSERT INTO user VALUES(1,'synthetic-local-owner')");await pool.query("INSERT INTO sx_legacy_ownership VALUES('user','1',?,'owner-membership',?)",[tenant,crypto.createHash('sha256').update('synthetic-local-owner').digest('hex')]);await pool.query("INSERT INTO sx_memberships VALUES('owner-membership',?,?,'owner','active')",[tenant,identity]);
    for(const [id,label,amount] of [[a,'Course A',145000],[b,'Course B',320000]]){await pool.query("INSERT INTO sx_training_courses VALUES(?,?,?,'دورة','TEST','active',NULL)",[tenant,id,label]);await pool.query("INSERT INTO sx_training_offers VALUES(?,?,1,'QAR',?,0,'active',NULL,NULL)",[tenant,id,amount]);}
    const migrations=discover(path.join(__dirname,'../database/migrations')).filter(m=>['20261028_invoice_pdf_generator.sql','20261031_invoice_pdf_replacements.sql','20261203_generated_invoice_editing.sql'].includes(m.file));assert.equal(migrations.length,3);const migrationConnection=await pool.getConnection();try{await applyMigrations(migrationConnection,migrations);}finally{migrationConnection.release();}
    const settings={companyName:'Synthetic Training Center',crNumber:'TEST-CR',address:'Doha',footer:'',invoicePrefix:'INV',paymentPlans:[{id:'full',label:'Full payment',installments:1,intervalDays:0}]};
    const ctx=(role='owner',tenantId=tenant)=>({audience:'tenant',identity:{id:identity},tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{tenantId,role,status:'active'},category:{key:'training_center',version:1,capabilities:['finance.invoices']},subscription:{status:'active',capabilities:['finance.invoices']}});
    const connection=await pool.getConnection();try{await require('../modules/platform/invoice-generator').saveSettings(connection,ctx(),settings);}finally{connection.release();}
    const app=express();let origin;
    const guard=(req,res,next)=>{if(req.headers.authorization!=='synthetic-test')return res.status(401).json({code:'AUTH_REQUIRED'});if(!['GET','HEAD'].includes(req.method)&&req.headers['x-csrf-token']!=='synthetic-csrf')return res.status(403).json({code:'CSRF_REQUIRED'});req.businessContext=ctx(req.headers['x-test-role']||'owner',req.headers['x-test-tenant']||tenant);next();};
    server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});origin='http://127.0.0.1:'+server.address().port;
    app.use('/finance',createTrainingFinanceRouter({pool,origin,userGuard:guard,canonicalGuard:guard}));app.use((error,req,res,next)=>res.status(error.status||400).json({code:error.code||error.message}));
    const request=async(method,url,body,headers={})=>{const response=await fetch(origin+'/finance/accountant/generator'+url,{method,headers:{Authorization:'synthetic-test',Origin:origin,'Content-Type':'application/json','X-CSRF-Token':'synthetic-csrf',...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,...await response.json()};};
    const input={requestKey:uuid(),customerType:'manual',customerName:'Synthetic Learner',courseLines:[{courseId:a,discountType:'percent',discountValue:'10',expectedOfferVersion:1},{courseId:b,discountType:'fixed',discountValue:'250.50',expectedOfferVersion:1}],paymentPlan:{id:'full',installments:1,intervalDays:0}};
    const created=await request('POST','/invoices',input);assert.equal(created.status,201);assert.equal(created.data.totalMinor,425450);assert.equal(created.data.lines.length,2);assert.equal(created.data.installments[0].amountMinor,425450);
    const again=await request('POST','/invoices',input);assert.equal(again.status,200);assert.equal(again.data.id,created.data.id);
    const filtered=await request('GET','/invoices?courseId='+b);assert.equal(filtered.data.length,1);
    const id=created.data.id,edit={...input,requestKey:uuid(),expectedRevision:1,customerName:'Updated Synthetic Learner',courseLines:[{courseId:a,discountType:'percent',discountValue:'15',expectedOfferVersion:1},{courseId:b,discountType:'fixed',discountValue:'100',expectedOfferVersion:1}]};
    const updated=await request('PUT','/invoices/'+id,edit);assert.equal(updated.status,200);assert.equal(updated.data.totalMinor,433250);assert.equal(updated.data.invoiceNumber,created.data.invoiceNumber);assert.equal(updated.data.issuedAt,created.data.issuedAt);assert.equal(updated.data.revision,2);
    const retry=await request('PUT','/invoices/'+id,edit);assert.equal(retry.status,200);assert.equal(retry.data.repeated,true);
    assert.equal((await request('PUT','/invoices/'+id,{...edit,requestKey:uuid()})).code,'STALE_INVOICE_REVISION');
    assert.equal((await request('POST','/invoices',{...input,requestKey:uuid()},{'X-Test-Role':'manager'})).status,403);
    assert.equal((await request('GET','/invoices/'+id,null,{'X-Test-Tenant':uuid()})).status,404);
    assert.equal((await request('POST','/invoices',input,{Origin:'http://foreign.invalid'})).status,403);
    assert.equal((await request('GET','/invoices',null,{Authorization:'invalid'})).status,401);
    const concurrent=await Promise.all([request('PUT','/invoices/'+id,{...edit,requestKey:uuid(),expectedRevision:2}),request('PUT','/invoices/'+id,{...edit,requestKey:uuid(),expectedRevision:2})]);assert.deepEqual(concurrent.map(x=>x.status).sort(),[200,409]);
    const deletion={requestKey:uuid(),expectedRevision:3};assert.equal((await request('DELETE','/invoices/'+id,deletion)).status,200);assert.equal((await request('DELETE','/invoices/'+id,deletion)).data.repeated,true);assert.equal((await request('GET','/invoices/'+id)).status,404);assert.equal((await request('GET','/invoices')).data.length,0);assert.equal((await request('POST','/invoices',input)).code,'INVOICE_DELETED');
    const [[history]]=await pool.query('SELECT COUNT(*) AS n FROM sx_invoice_generator_document_history WHERE tenant_id=? AND document_id=?',[tenant,id]);assert.equal(Number(history.n),3);
    const other=await request('POST','/invoices',{...input,requestKey:uuid()});const formal=uuid();await pool.query('INSERT INTO sx_training_invoices VALUES(?,?,?)',[formal,tenant,'POSTED-TEST']);await pool.query('INSERT INTO sx_training_generated_invoice_links VALUES(?,?,?)',[tenant,other.data.id,formal]);
    assert.equal((await request('DELETE','/invoices/'+other.data.id,{requestKey:uuid(),expectedRevision:1})).code,'INVOICE_LINKED_READ_ONLY');assert.equal((await request('PUT','/invoices/'+other.data.id,{...edit,requestKey:uuid(),expectedRevision:1})).code,'INVOICE_LINKED_READ_ONLY');
    const [[preserved]]=await pool.query('SELECT COUNT(*) AS n FROM sx_invoice_generator_documents');assert.equal(Number(preserved.n),2);
    await pool.query("CREATE TABLE pipeline_leads(id CHAR(36),uid_hash CHAR(64),uid VARCHAR(100))");
    const savedLead=uuid();await pool.query('INSERT INTO pipeline_leads VALUES(?,?,?)',[savedLead,crypto.createHash('sha256').update('synthetic-local-owner').digest('hex'),'synthetic-local-owner']);
    const selectedInput={...input,requestKey:uuid(),customerType:'lead',customerId:savedLead,customerName:'Editable saved learner'};
    const createConnection=await pool.getConnection();try{const result=await require('../modules/platform/invoice-generator').create(createConnection,ctx('accountant'),{uid:'synthetic-staff-uid',input:selectedInput});assert.equal(result.customerId,savedLead);assert.equal(result.customer.name,'Editable saved learner');assert.equal(result.totalMinor,425450);await assert.rejects(require('../modules/platform/invoice-generator').create(createConnection,ctx('accountant'),{uid:'synthetic-staff-uid',input:{...selectedInput,requestKey:uuid(),customerId:uuid()}}),{code:'CUSTOMER_NOT_FOUND'});}finally{createConnection.release();}
    console.log(JSON.stringify({result:'passed',migrations:3,mixedDiscountTotalMinor:425450,editedTotalMinor:433250,idempotency:true,concurrentEdit:true,softDelete:true,historyRows:3,linkedInvoiceLocked:true,tenantIsolation:true,roleOriginAuthChecks:true,selectedLeadCreatedByAccountant:true,customerDataTouched:false,externalWrites:false}));
  }finally{if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.end();if(!/^salemax_invoice_edit_test_[a-f0-9]{12}$/.test(name))throw Error('Unsafe cleanup name');await admin.query('DROP DATABASE IF EXISTS '+name);await admin.end();}
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
