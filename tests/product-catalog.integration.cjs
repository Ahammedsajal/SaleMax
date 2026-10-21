'use strict';
// Disposable loopback database only. No live contacts or provider sends.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os');
const mysql=require('mysql2/promise'),express=require('express');
const {discover,applyMigrations}=require('../database/migration-runner');
(async()=>{
 if(process.env.LOCAL_ONLY_MODE!=='true'||process.env.DBHOST!=='127.0.0.1'||!/^salemax_migration_test_[a-z0-9_]+$/.test(process.env.DBNAME||''))throw Error('DISPOSABLE_DATABASE_REQUIRED');
 const mediaRoot=await fs.mkdtemp(path.join(os.tmpdir(),'salemax-product-test-'));process.env.SALEMAX_COURSE_MEDIA_DIR=mediaRoot;
 process.env.JWTKEY=crypto.randomBytes(32).toString('hex');
 const pool=mysql.createPool({host:process.env.DBHOST,port:Number(process.env.DBPORT),user:process.env.DBUSER,password:process.env.DBPASS||'',database:process.env.DBNAME,connectionLimit:6});
 const db=await pool.getConnection();let server;
 try{
  const inventory=require('../docs/LEGACY_SCHEMA_INVENTORY.json');
  for(const table of ['admin','plan','web_public','web_private','user','orders','contact_form','beta_chats','beta_conversation','agents','agent_task','instance','beta_flows','contact','phonebook','broadcast','beta_campaign']){
   const columns=inventory.columns.filter(c=>c.tableName===table&&!(table==='instance'&&c.columnName==='inactiveSince'));
   if(columns.length)await db.query('CREATE TABLE `'+table+'` ('+columns.map(c=>'`'+c.columnName+'` '+c.columnType+' '+(c.nullable==='NO'?'NOT NULL':'')+' '+(c.columnKey==='PRI'?'PRIMARY KEY':'')+' '+(c.extra==='auto_increment'?'AUTO_INCREMENT':'')+' '+(c.columnName==='createdAt'?'DEFAULT CURRENT_TIMESTAMP':'')).join(',')+')');
  }
  const result=await applyMigrations(db,discover(path.join(__dirname,'../database/migrations')));console.log('Migrations applied:',result.applied.length);
  const {getCategory}=require('../modules/platform/categories'),catalog=require('../modules/platform/product-catalog'),courses=require('../modules/platform/training-courses'),media=require('../modules/platform/training-course-media'),replies=require('../modules/platform/course-quick-replies');
  const contexts={};
  for(const categoryKey of ['training_center','7network_sales']){
   const tenantId=crypto.randomUUID(),identityId=crypto.randomUUID(),membershipId=crypto.randomUUID(),category=getCategory(categoryKey,1);
   await db.query("INSERT INTO sx_tenants(id,slug,name,category_key,category_version,status) VALUES(?,?,?,?,1,'active')",[tenantId,'catalog-test-'+tenantId,'Synthetic catalogue',categoryKey]);
   await db.query("INSERT INTO sx_identities(id,email_normalized,display_name,status) VALUES(?,?,'Synthetic owner','active')",[identityId,identityId+'@example.invalid']);
   await db.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES(?,?,?,'owner','active')",[membershipId,tenantId,identityId]);
   contexts[categoryKey]={audience:'tenant',identity:{id:identityId},tenant:{id:tenantId,status:'active',categoryKey,categoryVersion:1},membership:{id:membershipId,tenantId,role:'owner',status:'active'},category,subscription:{status:'active',capabilities:[...category.capabilities]}};
  }
  const app=express(),origin='http://127.0.0.1';
  const sessionGuard=(req,res,next)=>{const ctx=contexts[req.get('X-Test-Category')];if(!ctx)return res.sendStatus(401);req.featureSession={context:{...ctx,membership:{...ctx.membership,role:req.get('X-Test-Role')||'owner'}}};next();};
  const router=require('../modules/platform/training-course-router').createTrainingCourseRouter;
  app.use('/courses',router({pool,origin,sessionGuard}));app.use('/products',router({pool,origin,sessionGuard,products:true}));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const request=async(route,{category='7network_sales',role='owner',method='GET',body}={})=>{const response=await fetch(base+route,{method,headers:{Origin:origin,'X-Test-Category':category,'X-Test-Role':role,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});return {status:response.status,body:await response.json(),headers:response.headers};};
  assert.equal((await request('/courses')).status,403);
  assert.equal((await request('/products',{category:'training_center'})).status,403);
  assert.equal((await request('/products',{role:'accountant'})).status,403);
  const input={code:'SERVICE-01',nameEn:'Synthetic service',nameAr:'خدمة تجريبية',descriptionEn:'Service description',descriptionAr:'وصف الخدمة',outcomesEn:'Service specifications',outcomesAr:'مواصفات الخدمة',offer:{priceMinor:12500}};
  const created=await request('/products',{method:'POST',body:input});assert.equal(created.status,201);const id=created.body.data.id;
  assert.equal((await request('/products',{role:'agent',method:'POST',body:input})).status,403);
  const [[trainingCount]]=await db.query('SELECT COUNT(*) AS n FROM sx_training_courses');assert.equal(Number(trainingCount.n),0);
  const ctx=contexts['7network_sales'],productDb=catalog.database(db);
  const form=new FormData();form.append('file',new Blob([Buffer.from('%PDF-1.4\nSynthetic brochure\n%%EOF')],{type:'application/pdf'}),'brochure.pdf');
  const attached=await request('/products/'+id+'/media',{method:'POST',body:form});assert.equal(attached.status,201);
  const published=await request('/products/'+id+'/publish',{method:'POST',body:{expectedRevision:1}});assert.equal(published.status,200);
  const c={ctx,scope:{uid:'synthetic-owner'}};
  assert.equal((await replies.options(pool,c)).length,1);
  for(const lang of ['en','ar']){const preview=await replies.plan(pool,c,id,lang);assert.equal(preview.parts[0].kind,'document');assert.match(preview.parts[1].text,lang==='en'?/Service description/:/وصف الخدمة/);assert.match(preview.parts[2].text,lang==='en'?/Price: QAR 125.00/:/السعر: QAR 125.00/);assert.doesNotMatch(preview.parts.map(p=>p.text).join(''),/Course fee|Learning outcomes/);}
  await db.query("INSERT INTO beta_chats(uid,chat_id,origin,assigned_agent,sender_mobile,sender_name) VALUES ('synthetic-owner','synthetic-chat','qr','[]','97450000001','Synthetic')");
  const sendContext={...c,query:async(sql,args)=>(await pool.query(sql,args))[0]},sent=[];
  const inputSend={requestId:crypto.randomUUID(),chatId:'synthetic-chat',courseId:id,language:'en'};
  const transport=async({part})=>sent.push(part.kind);
  const sentJob=await replies.execute(pool,sendContext,inputSend,transport);assert.equal(sentJob.state,'sent');assert.deepEqual(sent,['document','text','text']);
  assert.equal((await replies.execute(pool,sendContext,inputSend,transport)).state,'sent');assert.equal(sent.length,3);
  const [[courseJobs]]=await db.query('SELECT COUNT(*) AS n FROM sx_course_reply_jobs');assert.equal(Number(courseJobs.n),0);
  await assert.rejects(replies.plan(pool,{ctx:contexts.training_center},id,'en'),{code:'COURSE_NOT_AVAILABLE'});
  const foreignCtx={...ctx,tenant:{...ctx.tenant,id:crypto.randomUUID()}};assert.equal((await replies.options(pool,{ctx:foreignCtx})).length,0);
  const mediaId=attached.body.data.id,access=await request('/products/'+id+'/media/'+mediaId+'/access');assert.equal(access.status,200);
  const productCookie=access.headers.get('set-cookie');assert.match(productCookie,new RegExp(`^sx_products_media_${mediaId.replace(/-/g,'')}=`));
  const productToken=productCookie.split(';',1)[0].split('=').slice(1).join('=');
  const courseRouteToken=await fetch(`${base}/courses/${id}/media/${mediaId}/stream`,{headers:{Cookie:`sx_courses_media_${mediaId.replace(/-/g,'')}=${productToken}`}});assert.equal(courseRouteToken.status,401,'a product grant cannot be replayed through the course stream route');
  const courseToken=media.accessToken(contexts.training_center,id,mediaId);
  const productRouteToken=await fetch(`${base}/products/${id}/media/${mediaId}/stream`,{headers:{Cookie:`sx_products_media_${mediaId.replace(/-/g,'')}=${courseToken}`}});assert.equal(productRouteToken.status,401,'a course grant cannot be replayed through the product stream route');
  const updated=await request('/products/'+id,{method:'PUT',body:{...input,expectedRevision:published.body.data.revision,nameEn:'Updated service'}});assert.equal(updated.status,200);
  assert.equal((await request('/products/'+id,{method:'PUT',body:{...input,expectedRevision:1}})).status,409);
  await courses.create(db,contexts.training_center,{...input,code:'COURSE-01'});assert.equal((await courses.list(db,contexts.training_center)).total,1);assert.equal((await courses.list(productDb,ctx)).total,1);
  assert.equal((await request('/products/'+id,{method:'DELETE'})).status,200);assert.equal((await replies.options(pool,c)).length,0);
  assert.equal((await courses.list(db,contexts.training_center)).total,1);
  const operator=require('../scripts/link-sales-catalog-owner.cjs');
  const custodian=idForTest();
  await db.query("INSERT INTO sx_identities(id,email_normalized,display_name,status) VALUES (?,?,'Synthetic platform owner','active')",[custodian,custodian+'@example.invalid']);
  await db.query("INSERT INTO sx_platform_memberships(identity_id,role,status) VALUES (?,'super_admin','active')",[custodian]);
  const legacyEditor=require('../modules/platform/legacy-plan-editor'),terms=legacyEditor.normalize({title:'Synthetic premium',short_description:'Synthetic plan',plan_duration_in_days:365,price:100,contact_limit:500,qr_account:1}).value;
  const [planRow]=await db.query('INSERT INTO plan ('+legacyEditor.columns.join(',')+') VALUES ('+legacyEditor.columns.map(()=>'?').join(',')+')',legacyEditor.columns.map(key=>terms[key]));
  const legacySnapshot=JSON.stringify({id:planRow.insertId,...terms}),expiry=Date.now()+86400000*30;
  const [account]=await db.query("INSERT INTO user(uid,name,email,password,role,plan,plan_expire,timezone) VALUES ('synthetic-sales-link-owner','Synthetic 7Network','admin@salemax.qa','synthetic-only','user',?,?,'Asia/Qatar')",[legacySnapshot,expiry]);
  assert.equal((await operator.link(db,{email:'admin@salemax.qa'})).preview,true);
  const linked=await operator.link(db,{email:'admin@salemax.qa',apply:true});assert.equal(linked.applied,true);
  assert.equal((await operator.link(db,{email:'admin@salemax.qa',apply:true})).alreadyLinked,true);
  const [[preserved]]=await db.query('SELECT plan,plan_expire FROM user WHERE id=?',[account.insertId]);assert.equal(preserved.plan,legacySnapshot);assert.equal(Number(preserved.plan_expire),expiry);
  const messagingOperator=require('../scripts/enable-sales-messaging.cjs');
  // Reproduce a historical Sales plan that predates messaging entitlement.
  const [[oldPlan]]=await db.query('SELECT p.id,p.capabilities,a.id AS assignmentId,a.role_limits,a.expires_at FROM sx_plan_versions p JOIN sx_plan_assignments a ON a.plan_version_id=p.id WHERE a.tenant_id=? AND a.current_tenant IS NOT NULL',[linked.tenantId]);
  const oldCaps=(typeof oldPlan.capabilities==='string'?JSON.parse(oldPlan.capabilities):oldPlan.capabilities).filter(c=>!messagingOperator.messaging.includes(c));
  await db.query('UPDATE sx_plan_versions SET capabilities=? WHERE id=?',[JSON.stringify(oldCaps),oldPlan.id]);
  await assert.rejects(messagingOperator.enable(db,{email:'foreign@example.test',apply:true}),{code:'DESIGNATED_OWNER_REQUIRED'});
  const preview=await messagingOperator.enable(db,{email:'admin@salemax.qa'});assert.equal(preview.preview,true);assert.equal(preview.missing.length,7);
  await assert.rejects(messagingOperator.enable(db,{email:'admin@salemax.qa',apply:true,expectedAssignmentId:idForTest()}),{code:'STALE_ASSIGNMENT'});
  let backup=null;const expanded=await messagingOperator.enable(db,{email:'admin@salemax.qa',apply:true,expectedAssignmentId:preview.assignmentId,saveBackup:data=>{backup=data;}});assert.equal(expanded.applied,true);assert.equal(backup.priorAssignment.id,oldPlan.assignmentId);
  const [[replacement]]=await db.query('SELECT a.*,v.capabilities FROM sx_plan_assignments a JOIN sx_plan_versions v ON v.id=a.plan_version_id WHERE a.id=?',[expanded.newAssignmentId]);
  assert.equal(JSON.stringify(replacement.role_limits),JSON.stringify(oldPlan.role_limits));assert.equal(new Date(replacement.expires_at).getTime(),new Date(oldPlan.expires_at).getTime());
  const caps=typeof replacement.capabilities==='string'?JSON.parse(replacement.capabilities):replacement.capabilities;for(const capability of messagingOperator.messaging)assert.ok(caps.includes(capability));
  const [[priorVersion]]=await db.query('SELECT capabilities FROM sx_plan_versions WHERE id=?',[oldPlan.id]);assert.deepEqual(typeof priorVersion.capabilities==='string'?JSON.parse(priorVersion.capabilities):priorVersion.capabilities,oldCaps);
  assert.equal((await messagingOperator.enable(db,{email:'admin@salemax.qa',apply:true,expectedAssignmentId:preview.assignmentId})).alreadyEnabled,true);
  const [[afterExpansion]]=await db.query('SELECT plan,plan_expire FROM user WHERE id=?',[account.insertId]);assert.equal(afterExpansion.plan,legacySnapshot);assert.equal(Number(afterExpansion.plan_expire),expiry);
  const [[audit]]=await db.query("SELECT COUNT(*) AS count FROM sx_audit_events WHERE tenant_id=? AND action='business.sales-messaging-enabled'",[linked.tenantId]);assert.equal(Number(audit.count),1);
  assert.equal((await courses.list(db,contexts.training_center)).total,1);
  console.log('PASS: category and tenant isolation, role denials, create/edit/publish, media/access, EN/AR ordered previews, stale revisions, removal and unchanged Training Center storage');
 }finally{db.release();if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await fs.rm(mediaRoot,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
function idForTest(){return crypto.randomUUID();}
