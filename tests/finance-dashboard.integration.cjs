'use strict';
const mysql=require('mysql2/promise'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {report,todayQatar}= {...require('../modules/platform/training-finance-dashboard'),...require('../modules/platform/training-receivables-report')};
async function main(){
  if(process.env.LOCAL_ONLY_MODE!=='true')throw Error('Disposable local mode required');
  const port=Number(process.env.INVOICE_TEST_PORT);if(!Number.isInteger(port)||port<3307)throw Error('Explicit isolated test port required');
  const admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'}),name='finance_dashboard_test_'+crypto.randomBytes(6).toString('hex');let db;
  try{
    await admin.query('CREATE DATABASE '+name);db=await mysql.createConnection({host:'127.0.0.1',port,user:'root',database:name});
    const tables={
      sx_training_invoices:'id VARCHAR(36),tenant_id VARCHAR(36),invoice_number VARCHAR(64),issued_at DATETIME,currency CHAR(3),total_minor BIGINT,enrollment_id VARCHAR(36),status VARCHAR(20)',
      sx_training_enrollments:'id VARCHAR(36),tenant_id VARCHAR(36),learner_name VARCHAR(100),payer_name VARCHAR(100),lead_id VARCHAR(36),sale_review_id VARCHAR(36)',
      sx_training_sale_reviews:'id VARCHAR(36),tenant_id VARCHAR(36),application_submission_id VARCHAR(36)',
      sx_training_payments:'id VARCHAR(36),tenant_id VARCHAR(36),status VARCHAR(30)',
      sx_training_payment_allocations:'id VARCHAR(36),tenant_id VARCHAR(36),payment_id VARCHAR(36),invoice_id VARCHAR(36),installment_id VARCHAR(36),amount_minor BIGINT',
      sx_training_payment_allocation_reversals:'tenant_id VARCHAR(36),allocation_id VARCHAR(36),amount_minor BIGINT',
      sx_training_credit_notes:'id VARCHAR(36),tenant_id VARCHAR(36),invoice_id VARCHAR(36),status VARCHAR(20),amount_minor BIGINT',
      sx_training_credit_allocations:'tenant_id VARCHAR(36),credit_note_id VARCHAR(36),installment_id VARCHAR(36),amount_minor BIGINT',
      sx_training_installments:'id VARCHAR(36),tenant_id VARCHAR(36),invoice_id VARCHAR(36),due_date DATE,amount_minor BIGINT,status VARCHAR(20)',
      sx_invoice_generator_documents:'id VARCHAR(36),tenant_id VARCHAR(36),invoice_number VARCHAR(64),created_at DATETIME,amount_minor BIGINT,customer_name VARCHAR(100),customer_type VARCHAR(20),customer_id VARCHAR(36),snapshot JSON',
      sx_training_generated_invoice_links:'tenant_id VARCHAR(36),generated_document_id VARCHAR(36),invoice_id VARCHAR(36)',
      sx_invoice_generator_document_state:'tenant_id VARCHAR(36),document_id VARCHAR(36),deleted_at DATETIME',
      sx_invoice_generator_replacements:'tenant_id VARCHAR(36),prior_invoice_id VARCHAR(36)',
      sx_training_receipts:'id VARCHAR(36),tenant_id VARCHAR(36),receipt_number VARCHAR(64),payment_id VARCHAR(36),invoice_id VARCHAR(36),amount_minor BIGINT,currency CHAR(3),received_at DATETIME,method_snapshot VARCHAR(30)'
    };
    for(const [table,columns] of Object.entries(tables))await db.query(`CREATE TABLE ${table}(${columns})`);
    const day=todayQatar(),past=new Date(day+'T12:00:00Z');past.setUTCDate(past.getUTCDate()-40);const due=past.toISOString().slice(0,10);
    await db.query("INSERT INTO sx_training_enrollments VALUES ('en','tenant','Synthetic Student','Synthetic Payer','lead','sale')");
    await db.query("INSERT INTO sx_training_sale_reviews VALUES ('sale','tenant','application')");
    await db.query("INSERT INTO sx_training_invoices VALUES ('formal','tenant','INV-FORMAL',?,'QAR',10000,'en','issued')",[day+' 10:00:00']);
    await db.query("INSERT INTO sx_training_installments VALUES ('term','tenant','formal',?,10000,'partial')",[due]);
    await db.query("INSERT INTO sx_training_payments VALUES ('pay','tenant','posted'),('pending','tenant','pending_verification')");
    await db.query("INSERT INTO sx_training_payment_allocations VALUES ('alloc','tenant','pay','formal','term',4000),('pending-alloc','tenant','pending','formal','term',2000)");
    await db.query("INSERT INTO sx_training_payment_allocation_reversals VALUES ('tenant','alloc',1000)");
    await db.query("INSERT INTO sx_training_credit_notes VALUES ('credit','tenant','formal','posted',1000)");
    await db.query("INSERT INTO sx_training_credit_allocations VALUES ('tenant','credit','term',1000)");
    await db.query("INSERT INTO sx_training_receipts VALUES ('receipt','tenant','REC-1','pay','formal',4000,'QAR',?,'cash')",[day+' 10:00:00']);
    for(const id of ['generated','linked','archived','replaced'])await db.query("INSERT INTO sx_invoice_generator_documents VALUES (?,'tenant',?, ?,5000,'Synthetic Customer','lead','lead',?)",[id,'INV-'+id,day+' 10:00:00',JSON.stringify({installments:[{dueDate:due,amountMinor:2000},{dueDate:'2099-01-01',amountMinor:3000}]})]);
    await db.query("INSERT INTO sx_training_generated_invoice_links VALUES ('tenant','linked','formal')");
    await db.query("INSERT INTO sx_invoice_generator_document_state VALUES ('tenant','archived',NOW())");await db.query("INSERT INTO sx_invoice_generator_replacements VALUES ('tenant','replaced')");
    const ctx=role=>({audience:'tenant',identity:{id:'identity'},tenant:{id:'tenant',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{tenantId:'tenant',status:'active',role},category:{key:'training_center',version:1,capabilities:['tenant.settings','finance.invoices']},subscription:{status:'active',capabilities:['tenant.settings','finance.invoices']}});
    const result=await report(db,ctx('owner'),{from:day,to:day});
    assert.equal(result.summary.invoice_count,2);assert.equal(result.summary.sales_minor,15000);assert.equal(result.summary.received_minor,4000);assert.equal(result.summary.receivable_minor,11000);assert.equal(result.summary.collected_minor,3000);assert.equal(result.summary.overdue_minor,8000);assert.equal(result.summary.credited_minor,1000);
    assert.equal(result.aging.find(x=>x.bucket==='31-60').amount_minor,8000);assert.equal(result.aging.find(x=>x.bucket==='current').amount_minor,3000);
    assert.equal(result.trend[0].sales_minor,15000);assert.equal(result.trend[0].received_minor,4000);
    const receipts=await report(db,ctx('owner'),{from:day,to:day,view:'receipts'});assert.equal(receipts.items[0].receipt_id,'receipt');assert.equal(receipts.items[0].application_submission_id,'application');
    assert.equal((await report(db,ctx('manager'),{view:'receivable',bucket:'current'})).total,1);
    const second=await report(db,ctx('owner'),{page:2,limit:1});assert.equal(second.items.length,1);assert.equal(second.pages,2);
    assert.equal((await report(db,{...ctx('manager'),tenant:{...ctx('manager').tenant,id:'other'},membership:{...ctx('manager').membership,tenantId:'other'}})).summary.sales_minor,0);
    // UTC 21:00 belongs to the next date in Qatar.
    await db.query("UPDATE sx_training_invoices SET issued_at=DATE_SUB(?,INTERVAL 3 HOUR) WHERE id='formal'",[day+' 00:00:00']);
    assert.equal((await report(db,ctx('owner'),{from:day,to:day})).summary.sales_minor,15000);
    await assert.rejects(report(db,ctx('agent')));
    console.log(JSON.stringify({passed:true,checks:['generated/formal deduplication','archived/replaced exclusion','partial payments','reversals','credits','pending exclusion','aging due amounts','receipt/application links','trend totals','manager read','tenant isolation','pagination','Qatar midnight']}));
  }finally{if(db)await db.end();await admin.query('DROP DATABASE IF EXISTS '+name);await admin.end();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
