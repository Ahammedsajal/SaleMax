'use strict';
const mysql=require('mysql2/promise'),crypto=require('node:crypto'),assert=require('node:assert/strict'),path=require('node:path');
const settings=require('../modules/platform/invoice-communications-settings');
const {discover,applyMigrations}=require('../database/migration-runner');
async function main(){
  const port=Number(process.env.INVOICE_TEST_PORT);if(process.env.LOCAL_ONLY_MODE!=='true'||!Number.isInteger(port)||port<3307)throw Error('Disposable local database required');
  const admin=await mysql.createConnection({host:'127.0.0.1',port,user:'root'}),name='invoice_comms_test_'+crypto.randomBytes(6).toString('hex');let pool;
  try{await admin.query('CREATE DATABASE '+name);pool=mysql.createPool({host:'127.0.0.1',port,user:'root',database:name,connectionLimit:4});
    await pool.query('CREATE TABLE sx_tenants(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,status VARCHAR(20))');
    await pool.query('CREATE TABLE sx_identities(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY)');
    await pool.query('CREATE TABLE sx_audit_events(id VARCHAR(36),tenant_id VARCHAR(36),actor_identity_id VARCHAR(36),actor_kind VARCHAR(20),action VARCHAR(100),resource_type VARCHAR(100),resource_id VARCHAR(36),changes JSON,correlation_id VARCHAR(36))');
    // Empty tracking dependency; delivery integration applies and tests its full FK schema.
    await pool.query('CREATE TABLE sx_invoice_communication_documents(tenant_id CHAR(36),next_scan_at DATETIME(3))');
    const tenant=crypto.randomUUID(),identity=crypto.randomUUID();await pool.query("INSERT INTO sx_tenants VALUES(?,'active')",[tenant]);await pool.query('INSERT INTO sx_identities VALUES(?)',[identity]);
    const migration=discover(path.join(__dirname,'../database/migrations')).filter(x=>x.file==='20261205_invoice_customer_communications.sql');assert.equal(migration.length,1);let db=await pool.getConnection();try{await applyMigrations(db,migration);}finally{db.release();}
    const ctx={audience:'tenant',identity:{id:identity},tenant:{id:tenant,categoryKey:'training_center',categoryVersion:1,status:'active'},membership:{tenantId:tenant,role:'owner',status:'active'},category:{key:'training_center',version:1,capabilities:['finance.invoices']},subscription:{status:'active',capabilities:['finance.invoices']}};
    const first=await settings.get(pool,ctx),{revision,offsetsDays,canEdit,...fields}=first;assert.equal(canEdit,true);fields.templates.overdue.en.body='Hello {customer_name}, {amount_due} remains due on {invoice_number}.';
    db=await pool.getConnection();try{const saved=await settings.save(db,ctx,{...fields,expectedRevision:revision});assert.equal(saved.revision,1);await assert.rejects(settings.save(db,ctx,{...fields,expectedRevision:0}),{code:'STALE_INVOICE_COMMUNICATION_SETTINGS'});}finally{db.release();}
    const current=await settings.get(pool,ctx);assert.equal(current.templates.overdue.en.body,fields.templates.overdue.en.body);assert.equal(current.dailyOverdue,true);assert.deepEqual(current.offsetsDays,[-7,-3,-1,0]);
    const results=await Promise.allSettled([true,false].map(async dailyOverdue=>{const connection=await pool.getConnection();try{return await settings.save(connection,ctx,{...fields,dailyOverdue,expectedRevision:1});}finally{connection.release();}}));
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'STALE_INVOICE_COMMUNICATION_SETTINGS');assert.equal((await settings.get(pool,ctx)).revision,2);
    const other=crypto.randomUUID();assert.equal((await settings.get(pool,{...ctx,tenant:{...ctx.tenant,id:other},membership:{...ctx.membership,tenantId:other}})).revision,0);
    const [[audit]]=await pool.query('SELECT COUNT(*) AS n FROM sx_audit_events');assert.equal(Number(audit.n),2);
    console.log(JSON.stringify({passed:true,migration:1,checks:['defaults','bilingual template persistence','exact cadence','daily overdue option','stale revisions','concurrent owner edits','tenant isolation','audited settings writes'],externallySent:false}));
  }finally{if(pool)await pool.end();await admin.query('DROP DATABASE IF EXISTS '+name);await admin.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
