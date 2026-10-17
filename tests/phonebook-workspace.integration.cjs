'use strict';
// Disposable synthetic schema only. Never imports production/customer records.
const mysql=require('mysql2/promise'),crypto=require('node:crypto'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const s=require('../modules/platform/phonebook-workspace');
(async()=>{
if(process.env.PHONEBOOK_SYNTHETIC_ONLY!=='true')throw Error('SYNTHETIC_DATABASE_REQUIRED');
const dbname='salemax_phonebook_test_'+crypto.randomBytes(6).toString('hex');const connection={host:process.env.DBHOST,user:process.env.DBUSER,password:process.env.DBPASS};const admin=await mysql.createConnection(connection);let pool,db,other,server;
try{await admin.query('CREATE DATABASE `'+dbname+'`');pool=mysql.createPool({...connection,database:dbname,connectionLimit:8});db=await pool.getConnection();other=await pool.getConnection();
for(const sql of [
'CREATE TABLE user(id INT PRIMARY KEY,uid VARCHAR(100),name VARCHAR(100),email VARCHAR(100),plan LONGTEXT,plan_expire VARCHAR(100))',
'CREATE TABLE agents(id INT PRIMARY KEY,uid VARCHAR(100),owner_uid VARCHAR(100),name VARCHAR(100),email VARCHAR(100),is_active INT)',
'CREATE TABLE phonebook(id INT PRIMARY KEY,uid VARCHAR(100),name VARCHAR(100))',
'CREATE TABLE contact(id INT AUTO_INCREMENT PRIMARY KEY,uid VARCHAR(999),phonebook_id VARCHAR(999),phonebook_name VARCHAR(100),name VARCHAR(999),mobile VARCHAR(100),var1 VARCHAR(999),var2 VARCHAR(999),var3 VARCHAR(999),var4 VARCHAR(999),var5 VARCHAR(999),var6 VARCHAR(999),createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP)',
'CREATE TABLE beta_conversation(id INT AUTO_INCREMENT PRIMARY KEY,uid VARCHAR(100),chat_id VARCHAR(100),route VARCHAR(20),metaChatId VARCHAR(100))',
'CREATE TABLE sx_legacy_ownership(source_table VARCHAR(20),source_id VARCHAR(50),legacy_uid_hash CHAR(64),tenant_id VARCHAR(50),membership_id VARCHAR(50))',
'CREATE TABLE sx_memberships(id VARCHAR(50),tenant_id VARCHAR(50),identity_id VARCHAR(50),role VARCHAR(50),status VARCHAR(20))',
'CREATE TABLE sx_tenants(id VARCHAR(50),category_key VARCHAR(50),status VARCHAR(20))',
'CREATE TABLE sx_identities(id VARCHAR(50),status VARCHAR(20))'
])await db.query(sql);
for(const sql of fs.readFileSync(path.join(__dirname,'../database/migrations/20261212_phonebook_workspace.sql'),'utf8').split(';').filter(x=>x.trim()))await db.query(sql);
await db.query('INSERT INTO user VALUES (1,?,?,?,?,?),(2,?,?,?,?,?),(3,?,?,?,?,?)',['owner','Owner','owner@example.invalid',JSON.stringify({contact_limit:50}),String(Date.now()+86400000),'foreign','Foreign','foreign@example.invalid','{}','0','staff','Staff','staff@example.invalid','{}','0']);
await db.query("INSERT INTO agents VALUES (1,'agent-a','owner','Agent A','agent@example.invalid',1),(2,'agent-b','foreign','Foreign Agent','foreign-agent@example.invalid',1),(3,'agent-c','owner','Inactive Agent','inactive@example.invalid',0)");
await db.query("INSERT INTO phonebook VALUES (1,'owner','Excel'),(2,'owner','General'),(3,'foreign','Foreign')");
await db.query("INSERT INTO contact(uid,phonebook_id,phonebook_name,name,mobile,var1,var2,var3,var4,var5,var6) VALUES ('owner','1','Excel','Synthetic A','97450000001','Excel','Qatar','F','TEST-ID','Notes','legacy-six'),('owner','1','Excel','Synthetic B','97450000002','Word','India','M','','',''),('foreign','3','Foreign','Other','97450000003','Excel','','','','','')");
let [[ownerUser]]=await db.query('SELECT * FROM user WHERE id=1');const ctx=await s.context(db,ownerUser);assert.equal(ctx.manage,true);
const config={labels:['Course','Nationality','Gender','QID','Notes'],rules:[{keyword:'excel course',bookId:1}],revision:0};
await s.saveSettings(db,ctx,config);await assert.rejects(s.saveSettings(db,ctx,config),{code:'SETTINGS_CHANGED'});
const revision=(await s.settings(db,ctx)).revision;const results=await Promise.allSettled([s.saveSettings(db,ctx,{...config,revision}),s.saveSettings(other,ctx,{...config,revision})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'SETTINGS_CHANGED');
assert.equal((await s.list(db,ctx,{filters:[{field:'var1',value:'Excel'}]})).total,1);assert.deepEqual((await s.unique(db,ctx,{field:'var1'})).values,['Excel','Word']);assert.equal((await s.list(db,ctx,{search:'%'})).total,0);
await assert.rejects(s.move(db,ctx,{ids:[1,3],bookId:2}),{code:'CONTACT_NOT_FOUND'});assert.equal((await s.list(db,ctx,{bookId:1})).total,2);
await assert.rejects(s.share(db,ctx,{resourceType:'book',ids:[1],recipientType:'agents',recipientId:2}),{code:'RECIPIENT_NOT_FOUND'});
await s.share(db,ctx,{resourceType:'book',ids:[1],recipientType:'agents',recipientId:1});
let [[agent]]=await db.query('SELECT * FROM agents WHERE id=1');const shared=await s.context(db,agent,'agents',ownerUser);assert.equal((await s.list(db,shared)).total,2);assert.equal((await s.list(db,shared,{bookId:3})).total,0);assert.equal((await s.books(db,shared)).length,1);
await assert.rejects(s.move(db,shared,{ids:[1],bookId:2}),{code:'READ_ONLY_SHARE'});
await s.move(db,ctx,{ids:[1],bookId:2});assert.equal((await s.list(db,shared)).total,1);const moved=(await s.list(db,ctx,{bookId:2})).rows[0];assert.equal(moved.var6,'legacy-six');assert.equal(moved.phonebook_name,'General');
await s.share(db,ctx,{resourceType:'contact',ids:[1],recipientType:'agents',recipientId:1});assert.equal((await s.list(db,shared)).total,2);
await s.share(db,ctx,{resourceType:'book',ids:[1],recipientType:'agents',recipientId:1,revoke:true});assert.equal((await s.list(db,shared)).total,1);
// First-message rules, existing history, retries and concurrent limit checks.
const message={route:'INCOMING',metaChatId:'message-1',senderMobile:'97450000009',senderName:'Synthetic Opening',msgContext:{text:{body:'Can I get more info on EXCEL course?'}}};
await db.query("INSERT INTO beta_conversation(uid,chat_id,route,metaChatId) VALUES ('owner','chat-1','INCOMING','message-1')");
const opening={uid:'owner',message,chatId:'chat-1',origin:'meta',sessionId:'test',pool};const routed=await Promise.all([s.routeOpening(opening),s.routeOpening(opening)]);assert.equal(routed.filter(x=>x.routed).length,1);assert.equal((await s.list(db,ctx,{search:'97450000009'})).total,1);
await db.query("INSERT INTO beta_conversation(uid,chat_id,route,metaChatId) VALUES ('owner','old','INCOMING','old-first'),('owner','old','INCOMING','old-second')");assert.equal((await s.routeOpening({...opening,chatId:'old',message:{...message,metaChatId:'old-second',senderMobile:'97450000010'}})).routed,false);
assert.equal((await s.routeOpening({...opening,chatId:'out',message:{...message,route:'OUTGOING'}})).routed,false);
await db.query('UPDATE user SET plan=? WHERE id=1',[JSON.stringify({contact_limit:3})]);assert.equal((await s.routeOpening({...opening,chatId:'limit',message:{...message,metaChatId:'limit-message',senderMobile:'97450000011'}})).reason,'CONTACT_LIMIT');
await db.query('UPDATE user SET plan=? WHERE id=1',[JSON.stringify({contact_limit:50})]);
// Canonical same-account users and inactive agent memberships.
await db.query("INSERT INTO sx_tenants VALUES ('tenant','training_center','active')");await db.query("INSERT INTO sx_identities VALUES ('owner-i','active'),('staff-i','active'),('agent-i','active')");await db.query("INSERT INTO sx_memberships VALUES ('owner-m','tenant','owner-i','owner','active'),('staff-m','tenant','staff-i','accountant','active'),('agent-m','tenant','agent-i','agent','inactive')");
for(const row of [['user','1','owner','owner-m'],['user','3','staff','staff-m'],['agents','1','agent-a','agent-m']])await db.query('INSERT INTO sx_legacy_ownership VALUES (?,?,?,?,?)',[row[0],row[1],s.hash(row[2]),'tenant',row[3]]);
await assert.rejects(s.context(db,agent,'agents',ownerUser),{code:'ACCESS_DENIED'});await db.query("UPDATE sx_memberships SET status='active' WHERE id='agent-m'");
await db.query("UPDATE sx_identities SET status='inactive' WHERE id='owner-i'");await assert.rejects(s.context(db,ownerUser),{code:'ACCESS_DENIED'});await db.query("UPDATE sx_identities SET status='active' WHERE id='owner-i'");
const canonical=await s.context(db,ownerUser);assert.equal(canonical.category,'training_center');await s.saveSettings(db,canonical,{...config,revision:0});await s.share(db,canonical,{resourceType:'book',ids:[2],recipientType:'user',recipientId:3});const [[staff]]=await db.query('SELECT * FROM user WHERE id=3');const staffCtx=await s.context(db,staff);assert.equal(staffCtx.manage,false);assert.equal((await s.list(db,staffCtx)).total,1);
const request={method:'GET',path:'/get_by_uid',decode:{userData:staff}},response={status(){return this;},json(){throw Error('UNEXPECTED_READ_DENIAL');}};let readAllowed=false;await require('../modules/platform/phonebook-owner-scope').middleware({pool,resolver:async()=>{throw Error('LEGACY_READ_RESOLVER_SHOULD_NOT_RUN');}})(request,response,()=>{readAllowed=true;});assert.equal(readAllowed,true);assert.equal(request.decode.uid,'owner');assert.equal(request.phonebookReadContext.manage,false);
// Actual router over HTTP, with explicit fixture authentication only.
const express=require('express'),app=express();app.use(express.json());app.use('/api/phonebook/workspace',require('../modules/platform/phonebook-workspace-router')({pool,authenticate:(req,res,next)=>{req.decode={userData:ownerUser};next();}}));app.use('/api/agent/phonebook',require('../modules/platform/phonebook-workspace-router')({agent:true,pool,authenticate:(req,res,next)=>{req.decode={userData:agent};req.owner=ownerUser;next();}}));server=app.listen(0,'0.0.0.0');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port+'/api/phonebook/workspace';assert.equal((await (await fetch(base+'/bootstrap')).json()).manage,true);assert.equal((await fetch(base+'/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[3],bookId:2})})).status,404);
const agentBase=base.replace('/api/phonebook/workspace','/api/agent/phonebook');assert.equal((await (await fetch(agentBase+'/contacts',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json()).total,1);assert.equal((await fetch(agentBase+'/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[1],bookId:2})})).status,403);
console.log(JSON.stringify({passed:true,checks:['configuration revision race','tenant isolation','unique filters','atomic bulk move','same-account share','read-only scope','revoke','move visibility','field preservation','first-message routing','retry race','history exclusion','plan limit','inactive membership denial','account user sharing','HTTP owner/agent routers','legacy shared-user bootstrap'],customerDataTouched:false}));
}finally{if(server)await new Promise(r=>server.close(r));db?.release();other?.release();await pool?.end();await admin.query('DROP DATABASE IF EXISTS `'+dbname+'`');await admin.end();}
})().catch(e=>{console.error(e.stack||e.code||e.message);process.exitCode=1;});
