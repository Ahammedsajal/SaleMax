'use strict';
// Isolated disposable database and private synthetic media; no customer/provider access.
const mysql=require('mysql2/promise'),crypto=require('node:crypto'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
(async()=>{
 if(process.env.COURSE_REPLY_SYNTHETIC_ONLY!=='true')throw Error('SYNTHETIC_DATABASE_REQUIRED');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'course-replies-'));process.env.SALEMAX_COURSE_MEDIA_DIR=root;
 const s=require('../modules/platform/course-quick-replies'),{trainingCenter}=require('../modules/platform/categories');
 const dbname='salemax_course_reply_test_'+crypto.randomBytes(6).toString('hex'),connection={host:process.env.DBHOST,user:process.env.DBUSER,password:process.env.DBPASS};
 const admin=await mysql.createConnection(connection);let pool,server;
 const tenant=crypto.randomUUID(),course=crypto.randomUUID(),foreign=crypto.randomUUID(),image=crypto.randomUUID(),pdf=crypto.randomUUID();
 try{
 await admin.query('CREATE DATABASE `'+dbname+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');pool=mysql.createPool({...connection,database:dbname,connectionLimit:8});
 for(const sql of [
 'CREATE TABLE user(id INT PRIMARY KEY,uid VARCHAR(100),role VARCHAR(20),email VARCHAR(100),password VARCHAR(100))',
 'CREATE TABLE agents(id INT PRIMARY KEY,uid VARCHAR(100),owner_uid VARCHAR(100),role VARCHAR(20),is_active INT)',
 'CREATE TABLE sx_legacy_ownership(source_table VARCHAR(20),source_id VARCHAR(50),legacy_uid_hash CHAR(64),tenant_id CHAR(36),membership_id CHAR(36))',
 'CREATE TABLE sx_tenants(id CHAR(36),category_key VARCHAR(50),category_version INT,status VARCHAR(20))',
 'CREATE TABLE sx_memberships(id CHAR(36),tenant_id CHAR(36),identity_id CHAR(36),role VARCHAR(20),status VARCHAR(20),role_profile_id CHAR(36),delegated_permissions LONGTEXT)',
 'CREATE TABLE sx_identities(id CHAR(36),status VARCHAR(20))',
 'CREATE TABLE sx_team_roles(id CHAR(36),tenant_id CHAR(36),permissions LONGTEXT,seat_role VARCHAR(20),status VARCHAR(20))',
 'CREATE TABLE sx_plan_assignments(id CHAR(36),tenant_id CHAR(36),plan_version_id CHAR(36),status VARCHAR(20),role_limits LONGTEXT,current_tenant CHAR(36),effective_from DATETIME,expires_at DATETIME)',
 'CREATE TABLE sx_plan_versions(id CHAR(36),status VARCHAR(20),capabilities LONGTEXT,category_key VARCHAR(50),category_version INT)',
 'CREATE TABLE sx_training_courses(id CHAR(36),tenant_id CHAR(36),name_en TEXT,name_ar TEXT,description_en TEXT,description_ar TEXT,duration_value INT,duration_unit VARCHAR(10),delivery_mode VARCHAR(20),outcomes_en TEXT,outcomes_ar TEXT,prerequisites_en TEXT,prerequisites_ar TEXT,status VARCHAR(20),deleted_at DATETIME)',
 'CREATE TABLE sx_training_offers(tenant_id CHAR(36),course_id CHAR(36),currency VARCHAR(3),price_minor INT,registration_fee_minor INT,inclusions LONGTEXT,status VARCHAR(20),version INT,valid_from DATE,valid_until DATE)',
 'CREATE TABLE sx_training_course_media(id CHAR(36),tenant_id CHAR(36),course_id CHAR(36),media_kind VARCHAR(20),mime_type VARCHAR(50),original_name VARCHAR(100),storage_key VARCHAR(100),file_size_bytes INT,created_at DATETIME DEFAULT CURRENT_TIMESTAMP,deleted_at DATETIME)',
 'CREATE TABLE beta_chats(uid VARCHAR(100),chat_id VARCHAR(255),sender_mobile VARCHAR(50),origin VARCHAR(20),assigned_agent LONGTEXT,isGroup INT DEFAULT 0)'
 ])await pool.query(sql);
 await pool.query(await fs.readFile(path.join(__dirname,'../database/migrations/20261213_course_reply_jobs.sql'),'utf8'));
 await pool.query("INSERT INTO sx_training_courses(id,tenant_id,name_en,name_ar,description_en,description_ar,duration_value,duration_unit,delivery_mode,status) VALUES (?,?,'Synthetic Excel','إكسل تجريبي','Synthetic description','وصف تجريبي',8,'weeks','in_person','active'),(?,?,'Foreign','خارج','Foreign','خارج',4,'days','online','active')",[course,tenant,foreign,crypto.randomUUID()]);
 await pool.query("INSERT INTO sx_training_offers VALUES (?,?,'QAR',85000,0,'[\"Certificate\"]','active',1,NULL,NULL)",[tenant,course]);
 const directory=path.join(root,tenant,course);await fs.mkdir(directory,{recursive:true});
 for(const [id,kind,mime,name,bytes] of [[pdf,'document','application/pdf','synthetic.pdf',Buffer.from('%PDF-1.4 synthetic')],[image,'image','image/png','synthetic.png',Buffer.from([137,80,78,71,13,10,26,10])]]){
 const storage=crypto.randomUUID();await fs.writeFile(path.join(directory,storage),bytes);await pool.query('INSERT INTO sx_training_course_media(id,tenant_id,course_id,media_kind,mime_type,original_name,storage_key,file_size_bytes) VALUES (?,?,?,?,?,?,?,?)',[id,tenant,course,kind,mime,name,storage,bytes.length]);
 }
 await pool.query("INSERT INTO beta_chats(uid,chat_id,sender_mobile,origin,assigned_agent) VALUES ('owner','chat','97450000001','qr','[]'),('foreign','foreign-chat','97450000002','qr','[]')");
 const ctx={audience:'tenant',identity:{id:crypto.randomUUID()},tenant:{id:tenant,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:crypto.randomUUID(),tenantId:tenant,role:'owner',status:'active',delegatedPermissions:[]},category:trainingCenter,subscription:{status:'active',capabilities:['training.courses']},runtimeReady:{}};
 const c={ctx,scope:{uid:'owner',canonical:true,assignedOnly:false},actor:{uid:'owner'},query:async(sql,args)=>(await pool.query(sql,args))[0]};

 const ownerI=crypto.randomUUID(),ownerM=crypto.randomUUID(),agentI=crypto.randomUUID(),agentM=crypto.randomUUID(),version=crypto.randomUUID();
 await pool.query("INSERT INTO user VALUES (1,'owner','user','owner@example.invalid','fixture-only')");
 await pool.query("INSERT INTO agents VALUES (2,'agent','owner','agent',1)");
 await pool.query("INSERT INTO sx_tenants VALUES (?,'training_center',1,'active')",[tenant]);
 await pool.query("INSERT INTO sx_identities VALUES (?,'active'),(?,'active')",[ownerI,agentI]);
 await pool.query("INSERT INTO sx_memberships VALUES (?,?,?,'owner','active',NULL,'[]'),(?,?,?,'agent','active',NULL,'[]')",[ownerM,tenant,ownerI,agentM,tenant,agentI]);
 await pool.query("INSERT INTO sx_legacy_ownership VALUES ('user','1',?,?,?),('agents','2',?,?,?)",[s.hash('owner'),tenant,ownerM,s.hash('agent'),tenant,agentM]);
 await pool.query("INSERT INTO sx_plan_versions VALUES (?,'published','[\"training.courses\"]','training_center',1)",[version]);
 await pool.query("INSERT INTO sx_plan_assignments VALUES (?,?,?,'active',?, ?,UTC_TIMESTAMP()-INTERVAL 1 DAY,UTC_TIMESTAMP()+INTERVAL 1 DAY)",[crypto.randomUUID(),tenant,version,JSON.stringify({owner:1,accountant:1,manager:1,agent:3}),tenant]);
 const [[actor]]=await pool.query('SELECT * FROM user WHERE id=1'),[[agent]]=await pool.query('SELECT * FROM agents WHERE id=2');
 assert.equal((await s.context(pool,actor,false)).scope.uid,'owner');
 const agentContext=await s.context(pool,agent,true,actor);
 await assert.rejects(s.conversation(agentContext,'chat'),{code:'PERMISSION_DENIED'});
 await pool.query('UPDATE beta_chats SET assigned_agent=? WHERE uid=?',[JSON.stringify([{kind:'identity',identityId:agentI}]),'owner']);
 await assert.doesNotReject(s.conversation(agentContext,'chat'));
 const express=require('express'),app=express();
 process.env.SALEMAX_PLATFORM_ORIGIN='http://127.0.0.1';
 const auth=(isAgent)=>(req,res,next)=>{req.decode={userData:isAgent?agent:actor};req.owner=actor;next();};
 app.use('/api/inbox/course-replies',require('../modules/platform/course-quick-reply-router')({pool,authenticate:auth(false),send:async()=>{}} ));
 app.use('/api/agent/course-replies',require('../modules/platform/course-quick-reply-router')({agent:true,pool,authenticate:auth(true),send:async()=>{}} ));
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 for(const route of ['/api/inbox/course-replies','/api/agent/course-replies']){
 const response=await fetch(base+route+'?chatId=chat',{headers:{Authorization:'Bearer synthetic'}});const data=await response.json();assert.equal(data.success,true);assert.equal(data.data.courses.length,1);assert.match(response.headers.get('set-cookie'),/HttpOnly/);
 assert.equal((await fetch(base+route+'/preview/'+foreign+'?chatId=chat')).status,404);
 assert.equal((await fetch(base+route+'/send',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://foreign.invalid'},body:'{}'})).status,403);
 }

 for(const route of ['/api/inbox/course-replies','/api/agent/course-replies']){
 const id=crypto.randomUUID(),body={requestId:id,chatId:'chat',courseId:course,language:'en'};
 const response=await fetch(base+route+'/send',{method:'POST',headers:{'Content-Type':'application/json',Origin:process.env.SALEMAX_PLATFORM_ORIGIN},body:JSON.stringify(body)});const data=await response.json();assert.equal(data.success,true);assert.equal(data.data.state,'sent');assert.equal(data.data.sent,4);
 const again=await (await fetch(base+route+'/send',{method:'POST',headers:{'Content-Type':'application/json',Origin:process.env.SALEMAX_PLATFORM_ORIGIN},body:JSON.stringify(body)})).json();assert.equal(again.data.id,id);
 }
 const p=await s.plan(pool,c,course,'en');assert.deepEqual(p.parts.map(p=>p.kind),['image','document','text','text']);assert.match(p.parts[2].text,/Synthetic description/);
 await assert.rejects(s.plan(pool,c,foreign,'en'),{code:'COURSE_NOT_AVAILABLE'});
 await assert.rejects(s.execute(pool,c,{requestId:crypto.randomUUID(),chatId:'foreign-chat',courseId:course},async()=>assert.fail()),{code:'CONVERSATION_NOT_AVAILABLE'});
 const input={requestId:crypto.randomUUID(),chatId:'chat',courseId:course};const sends=[];
 const result=await s.execute(pool,c,input,async v=>{sends.push(v.part.kind);if(v.file)assert.ok((await fs.stat(v.file.path)).size>0);});assert.equal(result.state,'sent');assert.equal(result.sent,4);assert.deepEqual(sends,['image','document','text','text']);

 const cookie=Buffer.from(JSON.stringify({agent:false,token:'Bearer synthetic'})).toString('base64url');
 const fileResponse=await fetch(base+'/api/inbox/course-replies/files/'+input.requestId+'/0',{headers:{Cookie:'sx_course_reply='+cookie}});assert.equal(fileResponse.status,200);assert.equal(fileResponse.headers.get('content-type'),'image/png');assert.equal((await fileResponse.arrayBuffer()).byteLength,8);
 assert.equal((await fetch(base+'/api/inbox/course-replies/files/'+input.requestId+'/0')).status,401);
 assert.equal((await fetch(base+'/api/inbox/course-replies/files/'+input.requestId+'/99',{headers:{Cookie:'sx_course_reply='+cookie}})).status,404);
 assert.equal((await s.execute(pool,c,input,async()=>assert.fail('NO DUPLICATE'))).state,'sent');
 await assert.rejects(s.execute(pool,c,{...input,language:'ar'},async()=>assert.fail()),{code:'IDEMPOTENCY_CONFLICT'});
 const partialInput={...input,requestId:crypto.randomUUID()};let count=0;const stopped=await s.execute(pool,c,partialInput,async()=>{if(++count===2)throw Error('synthetic provider failure');});assert.equal(stopped.sent,1);assert.equal(stopped.state,'stopped');assert.equal(count,2);await s.execute(pool,c,partialInput,async()=>assert.fail('NO AMBIGUOUS RETRY'));
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);const raceInput={...input,requestId:crypto.randomUUID()};let raced=0;
 const first=s.execute(pool,c,raceInput,async()=>{raced++;if(raced===1){entered();await gate;}});await started;
 const retry=await s.execute(pool,c,raceInput,async()=>assert.fail());assert.equal(retry.state,'sending');
 await assert.rejects(s.execute(pool,c,{...input,requestId:crypto.randomUUID()},async()=>assert.fail()),{code:'CONVERSATION_SEND_BUSY'});release();await first;assert.equal(raced,4);
 await pool.query('UPDATE sx_training_course_media SET file_size_bytes=30000000 WHERE id=?',[pdf]);await assert.rejects(s.execute(pool,c,{...input,requestId:crypto.randomUUID()},async()=>assert.fail('PREFLIGHT BEFORE SEND')),{code:'COURSE_MEDIA_NOT_SENDABLE'});
 await pool.query('UPDATE sx_training_course_media SET file_size_bytes=17 WHERE id=?',[pdf]);
 const interrupted=crypto.randomUUID();await pool.query("INSERT INTO sx_course_reply_jobs(id,tenant_id,owner_hash,chat_id,course_id,language_code,parts_json,state) VALUES (?,?,?,?,?,'en',?,'sending')",[interrupted,tenant,s.hash('owner'),'chat',course,JSON.stringify(p.parts)]);assert.equal((await s.job(pool,c,interrupted)).state,'stopped');
 const scoped={...c,scope:{uid:'owner',canonical:true,assignedOnly:true,identityId:'assigned'}};
 await assert.rejects(s.job(pool,scoped,input.requestId),{code:'PERMISSION_DENIED'});
 console.log(JSON.stringify({passed:true,checks:['private media and text order','tenant isolation','recipient ownership','durable idempotency','ambiguous failure stop','concurrent retry','per-chat lock','oversize all-or-nothing preflight','revoked chat status denial','owner/agent HTTP catalogue and preview','Origin rejection','interrupted process detection','owner/agent HTTP ordered send and replay','private media HTTP and unauthenticated denial'],customerDataTouched:false,providerCalls:0}));
 }finally{if(server)await new Promise(r=>server.close(r));await pool?.end();await admin.query('DROP DATABASE IF EXISTS `'+dbname+'`');await admin.end();await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
