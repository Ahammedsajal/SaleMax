'use strict';
// Run only against a disposable database. The production deployment harness
// supplies an isolated MariaDB socket and never uses the application database.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
async function main(){
 if(!process.env.BUSINESS_TEST_DB_SOCKET)throw Error('DISPOSABLE_DATABASE_SOCKET_REQUIRED');
 const mysql=require('mysql2/promise'),schema=`business_notify_test_${crypto.randomBytes(5).toString('hex')}`;
 const root=await mysql.createConnection({socketPath:process.env.BUSINESS_TEST_DB_SOCKET,user:'root'});let pool;
 try{
  await root.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  pool=mysql.createPool({socketPath:process.env.BUSINESS_TEST_DB_SOCKET,user:'root',database:schema,connectionLimit:6});
  const ddl=[
   "CREATE TABLE sx_tenants(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,name VARCHAR(100),status VARCHAR(20),timezone VARCHAR(100))",
   "CREATE TABLE sx_identities(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,status VARCHAR(20))",
   "CREATE TABLE sx_memberships(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,role VARCHAR(20),status VARCHAR(20))",
   "CREATE TABLE sx_legacy_ownership(tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin,source_table VARCHAR(30),source_id VARCHAR(30))",
   "CREATE TABLE user(id INT PRIMARY KEY,mobile_with_country_code VARCHAR(30))",
   "CREATE TABLE agents(id INT PRIMARY KEY,mobile VARCHAR(30),is_active INT)",
   "CREATE TABLE sx_training_reminder_preferences(tenant_id CHAR(36),invoice_id CHAR(36),status VARCHAR(30))"
  ];for(const sql of ddl)await pool.query(sql);
  const {splitSql}=require('../database/migration-runner');for(const sql of splitSql(fs.readFileSync(path.join(__dirname,'../database/migrations/20261225_business_whatsapp_notifications.sql'),'utf8')))await pool.query(sql);
  const n=require('../modules/platform/business-notifications'),finance=require('../modules/platform/business-finance-context'),qr=require('../modules/platform/business-whatsapp');
  const tenant=crypto.randomUUID(),other=crypto.randomUUID(),owner=crypto.randomUUID(),manager=crypto.randomUUID();
  for(const t of [tenant,other]){await pool.query("INSERT INTO sx_tenants VALUES (?,?,'active','Asia/Qatar')",[t,'Synthetic test center']);await pool.query('INSERT INTO sx_business_notification_settings(tenant_id) VALUES (?)',[t]);}
  for(const [index,id,role] of [[1,owner,'owner'],[2,manager,'manager']]){const m=crypto.randomUUID();await pool.query("INSERT INTO sx_identities VALUES (?,'active')",[id]);await pool.query("INSERT INTO sx_memberships VALUES (?,?,?,?,'active')",[m,tenant,id,role]);await pool.query("INSERT INTO sx_legacy_ownership VALUES (?,?,'user',?)",[tenant,m,String(index)]);await pool.query('INSERT INTO user VALUES (?,?)',[index,`9745555000${index}`]);}
  const c=await pool.getConnection();const sourceId=crypto.randomUUID();await c.beginTransaction();await n.enqueue(c,tenant,{kind:'invoice_issued',sourceType:'generated',sourceId,key:'rolled-back'});await c.rollback();const [[rolled]]=await pool.query("SELECT COUNT(*) AS n FROM sx_business_notification_events WHERE event_key='rolled-back'");assert.equal(rolled.n,0);
  const key=`receipt:${sourceId}`;const concurrent=await Promise.all(Array.from({length:5},()=>n.enqueue(pool,tenant,{kind:'payment_received',sourceType:'training_receipt',sourceId,key})));assert.equal(concurrent.filter(x=>!x.repeated).length,1);
  const [[event]]=await pool.query('SELECT * FROM sx_business_notification_events WHERE tenant_id=? AND event_key=?',[tenant,key]);
  const oldLoad=finance.load;finance.load=async()=>({invoiceId:sourceId,number:'TEST-001',customer:'Synthetic customer',phone:'+97455550003',product:'Test course',currency:'QAR',total:10000,balance:5000,received:5000});
  try{
   await c.beginTransaction();await n.prepare(c,{...event,kind:'payment_received'},{id:tenant,name:'Synthetic test center',timezone:'Asia/Qatar'});await c.commit();
   const [[count]]=await pool.query('SELECT COUNT(*) AS n FROM sx_business_notification_deliveries WHERE event_id=?',[event.id]);assert.equal(count.n,3,'owner, manager and customer get independent deliveries');
   const otherConnection=await pool.getConnection();let first,second;try{[first,second]=await Promise.all([n.claim(c),n.claim(otherConnection)]);}finally{otherConnection.release();}
   // SKIP LOCKED may return no work while another claim locks a joined event.
   // Once that short transaction completes, the remaining work must drain.
   if(!first)first=await n.claim(c);if(!second)second=await n.claim(c);assert.ok(first);assert.ok(second);assert.notEqual(first.id,second.id,'concurrent claims never acquire the same delivery');
   const sent=[];const result=await n.dispatch(c,first,{authorize:async()=>true,send:async(db,payload)=>{sent.push(payload.to);return {status:'accepted',providerMessageId:'synthetic-provider-id'};}});assert.equal(result.status,'accepted');assert.equal(sent.length,1);await n.finish(c,first,result);
   await assert.rejects(()=>n.finish(c,{...second,token:'wrong-lease'},{status:'accepted'}),{code:'BUSINESS_NOTIFICATION_LEASE_LOST'});
   await pool.query('UPDATE sx_business_notification_deliveries SET lease_expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?',[second.id]);await n.claim(c);const [[expired]]=await pool.query('SELECT status FROM sx_business_notification_deliveries WHERE id=?',[second.id]);assert.equal(expired.status,'unknown','expired provider attempts are not resent');
   await assert.rejects(()=>pool.query('INSERT INTO sx_business_notification_deliveries(tenant_id,event_id,recipient_kind,recipient_id,destination_hash,part) VALUES (?,?,?,?,?,?)',[tenant,event.id,'identity',owner,qr.hash('97455550001'),'text']),{code:'ER_DUP_ENTRY'});
   const [[cross]]=await pool.query('SELECT COUNT(*) AS n FROM sx_business_notification_events WHERE tenant_id=?',[other]);assert.equal(cross.n,0);
   await assert.rejects(()=>pool.query('INSERT INTO sx_business_notification_deliveries(tenant_id,event_id,recipient_kind,recipient_id,destination_hash,part) VALUES (?,?,?,?,?,?)',[other,event.id,'identity',owner,qr.hash('97455559999'),'text']),{code:'ER_NO_REFERENCED_ROW_2'});
   const reportId=crypto.randomUUID(),snapshot={business:'Synthetic center',day:'2026-10-22',timezone:'Asia/Qatar',asOf:'6 PM',newChats:1,newLeads:1,invoices:0,payments:0,finance:[],pipeline:[]};
   await pool.query("INSERT INTO sx_business_notification_events(id,tenant_id,event_key,kind,source_type,source_id,payload_json,status) VALUES (?,?,'daily-test','daily_summary','tenant',?,?,'prepared')",[reportId,tenant,tenant,JSON.stringify({snapshot})]);
   for(const part of ['text','pdf'])await pool.query("INSERT INTO sx_business_notification_deliveries(tenant_id,event_id,recipient_kind,recipient_id,destination_hash,part) VALUES (?,?,'identity',?,?,?)",[tenant,reportId,owner,qr.hash(`missing:${owner}`),part]);
   const report=await n.claim(c);assert.equal(report.event_id,reportId);assert.equal(report.part,'text');
   const accepted=await n.dispatch(c,report,{authorize:async()=>true,send:async()=>({status:'accepted',providerMessageId:'sample-report-text'})});await n.finish(c,report,accepted);
   const [parts]=await pool.query('SELECT destination_hash FROM sx_business_notification_deliveries WHERE event_id=?',[reportId]);assert.ok(parts.every(p=>p.destination_hash===qr.hash('97455550001')),'fixing a missing phone updates both text and PDF destinations');
   const pdf=await n.claim(c);assert.equal(pdf.event_id,reportId);assert.equal(pdf.part,'pdf','PDF becomes deliverable after the text is acknowledged');
  }finally{finance.load=oldLoad;c.release();}
  console.log(JSON.stringify({status:'passed',assertions:'transaction rollback, concurrent event deduplication, recipient scope, lease fencing, unknown-send safety, unique recipient delivery, tenant isolation',database:(await pool.query('SELECT VERSION() AS version'))[0][0].version}));
 }finally{if(pool)await pool.end();await root.query(`DROP DATABASE IF EXISTS \`${schema}\``);await root.end();}
}
if(require.main===module)main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
module.exports={main};
