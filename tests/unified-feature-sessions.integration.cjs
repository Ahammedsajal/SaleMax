'use strict';
// Disposable MariaDB schema, real authentication/authorization, synthetic records,
// and a fake WhatsApp transport. Never run against a customer schema.
const mysql=require('mysql2/promise'),crypto=require('node:crypto'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const uuid=()=>crypto.randomUUID(),sha=v=>crypto.createHash('sha256').update(v).digest('hex');
(async()=>{
 if(process.env.UNIFIED_SYNTHETIC_ONLY!=='true')throw Error('SYNTHETIC_DATABASE_REQUIRED');
 const connection={host:process.env.DBHOST,port:Number(process.env.DBPORT||3306),user:process.env.DBUSER,password:process.env.DBPASS},admin=await mysql.createConnection(connection),name='salemax_unified_test_'+crypto.randomBytes(6).toString('hex');let pool,server,legacyPool;
 try{
 await admin.query('CREATE DATABASE `'+name+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');pool=mysql.createPool({...connection,database:name,connectionLimit:12});
 const inventory=require('../docs/LEGACY_SCHEMA_INVENTORY.json');
 for(const table of ['admin','plan','web_public','web_private','user','orders','contact_form','broadcast','beta_campaign','beta_chats','beta_conversation','agents','agent_task','instance','meta_api','beta_flows','contact','phonebook']){
 const columns=inventory.columns.filter(c=>c.tableName===table&&!(table==='instance'&&c.columnName==='inactiveSince'));
 if(!columns.length)continue;
 await pool.query('CREATE TABLE `'+table+'` ('+columns.map(c=>'`'+c.columnName+'` '+c.columnType+' '+(c.nullable==='NO'?'NOT NULL':'')+' '+(c.columnKey==='PRI'?'PRIMARY KEY':'')+' '+(c.extra==='auto_increment'?'AUTO_INCREMENT':'')+' '+(c.columnName==='createdAt'?'DEFAULT CURRENT_TIMESTAMP':'')).join(',')+')');
 }
 const db=await pool.getConnection();try{await require('../database/migration-runner').applyMigrations(db,require('../database/migration-runner').discover(path.join(__dirname,'../database/migrations')));}catch(error){const [failed]=await db.query("SELECT migration_name,error_code,statements_completed FROM salemax_schema_migrations WHERE status<>'applied'");console.error(JSON.stringify({syntheticMigrationFailure:failed}));throw error;}finally{db.release();}

 process.env.DBNAME=name;process.env.JWTKEY='synthetic-unified-jwt-key';process.env.LOCAL_ONLY_MODE='true';
 const express=require('express'),app=express(),origin='http://127.0.0.1';
 const auth=require('../modules/platform/auth-router').createAuthRouter({pool,key:crypto.randomBytes(32),origin,insecureLoopback:true,allowedAudience:'tenant'});
 const key=uuid(),version=uuid(),tenant=uuid(),foreignTenant=uuid(),people={};
 for(const [id,slug]of [[tenant,'unified'],[foreignTenant,'foreign']])await pool.query("INSERT INTO sx_tenants(id,name,slug,category_key,category_version,status) VALUES (?,? ,?,'training_center',1,'active')",[id,slug,slug]);
 const category=require('../modules/platform/categories').trainingCenter,limits=JSON.stringify({owner:1,manager:3,accountant:3,agent:10});
 await pool.query("INSERT INTO sx_plans(id,name) VALUES (?,'Synthetic unified plan')",[key]);
 await pool.query("INSERT INTO sx_plan_versions(id,plan_id,version,category_key,category_version,status,capabilities,role_limits,published_at) VALUES (?,?,1,'training_center',1,'published',?,?,UTC_TIMESTAMP(3))",[version,key,JSON.stringify(category.capabilities),limits]);
 await pool.query("INSERT INTO sx_plan_assignments(id,tenant_id,plan_version_id,role_limits,status,effective_from,expires_at) VALUES (?,?,?,?,'active',DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 DAY))",[uuid(),tenant,version,limits]);
 for(const role of ['owner','manager','accountant','agent']){
  const identity=uuid(),membership=uuid(),uid='synthetic-unified-'+role,password='synthetic-'+role,email=role+'@example.invalid';
  await pool.query("INSERT INTO sx_identities(id,email_normalized,display_name,password_hash,status) VALUES (?,?,?,'synthetic','active')",[identity,email,role]);
  await pool.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status,assigned_navigation) VALUES (?,?,?,?,'active',?)",[membership,tenant,identity,role,JSON.stringify(role==='agent'?['inbox','contacts']:role==='owner'?['dashboard','inbox','invoices','contacts','courses','reports']:['inbox','invoices','contacts','courses','reports'])]);
  let result;if(role==='agent')([result]=await pool.query("INSERT INTO agents(uid,name,email,password,owner_uid,role,is_active) VALUES (?,?,?,?,?,'agent',1)",[uid,role,email,password,'synthetic-unified-owner']));
  else ([result]=await pool.query("INSERT INTO user(uid,name,email,password,role) VALUES (?,?,?,?,'user')",[uid,role,email,password]));
  const id=result.insertId;await pool.query("INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash,verified_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))",[role==='agent'?'agents':'user',String(id),tenant,membership,sha(uid)]);
  const token=crypto.randomBytes(32).toString('base64url');await pool.query("INSERT INTO sx_sessions(id,token_hash,identity_id,audience,tenant_id,membership_id,credential_version,authenticated_at,expires_at) VALUES (?,?,?,'tenant',?,?,1,UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR))",[uuid(),sha(token),identity,tenant,membership]);
  people[role]={id,uid,identity,membership,token,bearer:require('jsonwebtoken').sign({uid,email,password},process.env.JWTKEY,{expiresIn:'1h'})};
 }
 process.env.SALEMAX_PLATFORM_ORIGIN=origin;
 // Exercise the actual legacy shell/QR routers with a fake provider transport.
 let qrStarts=0;
 const functionPath=require.resolve('../functions/function.js');require.cache[functionPath]={id:functionPath,filename:functionPath,loaded:true,exports:{getNumberOfDaysFromTimestamp:value=>Math.ceil((Number(value)-Date.now())/86400000),checkWarmerPlan:()=>false}};
 const addonsPath=require.resolve('../utils/addons');require.cache[addonsPath]={id:addonsPath,filename:addonsPath,loaded:true,exports:{returnAddons:()=>['QR']}};
 const qrPath=require.resolve('../helper/addon/qr/index.js');
 require.cache[qrPath]={id:qrPath,filename:qrPath,loaded:true,exports:{createSession:async()=>{qrStarts++;},getSession:()=>null,sendMessage:async()=>{},deleteSession:()=>{},isExists:()=>false}};
 const webhookPath=require.resolve('../helper/inbox/outboundWebhook');
 require.cache[webhookPath]={id:webhookPath,filename:webhookPath,loaded:true,exports:{sendQrStatusToCrm:async()=>{}}};
 const agentIdentity=express.Router();agentIdentity.get('/me',(req,res,next)=>req.get('X-Salemax-Actor')==='agent'?require('../modules/platform/agent-workspace-access').createAgentWorkspaceGuard({pool,origin})(req,res,next):next());app.use('/api/user/business-auth',agentIdentity);
 const shell=express.Router();shell.get('/get_dashboard',require('../middlewares/user'),(_req,res)=>res.status(500).end());shell.get('/get_me',require('../middlewares/user'),(_req,res)=>res.status(500).end());shell.get('/optional-features',require('../middlewares/user'),(_req,res)=>res.status(500).end());app.use('/api/user',shell);
 const qr=require('../routes/qr');app.use(['/api/workspace/channels/qr','/api/qr'],express.json(),qr);
 const guard=require('../modules/platform/business-feature-session').createBusinessFeatureSession({pool,origin,userGuard:require('../middlewares/user'),agentGuard:require('../middlewares/agent'),canonicalGuard:auth.guard,resolveBusinessContext:auth.resolveContext});legacyPool=require('../database/config');
 app.use('/api/user/business-auth',auth.router);
 const sessionRouter=express.Router();sessionRouter.use(guard.guard);sessionRouter.get('/',(req,res,next)=>require('../modules/platform/feature-contract').describeWithNavigation(pool,req.featureSession).then(data=>res.json({success:true,data})).catch(next));app.use('/api/workspace/session',sessionRouter);
 const customization=require('../modules/platform/tenant-customization-router').createTenantCustomizationRouter({pool,origin,authenticate:guard.guard});app.use(['/api/workspace/customization','/api/crm/customization'],customization);
 const finance=require('../modules/platform/training-finance-router').createTrainingFinanceRouter({pool,origin,sessionGuard:guard.guard});app.use(['/api/workspace/finance','/api/user/training/finance-policies'],finance);
 const phonebook=require('../modules/platform/phonebook-workspace-router')({pool,authenticate:guard.guard});app.use(['/api/workspace/phonebook','/api/phonebook/workspace','/api/agent/phonebook'],phonebook);
 const catalogRouter=require('../modules/platform/training-course-router').createTrainingCourseRouter;
 app.use('/api/workspace/products-services',catalogRouter({pool,origin,sessionGuard:guard.guard,products:true}));
 app.use('/api/workspace/courses',catalogRouter({pool,origin,sessionGuard:guard.guard}));
 let sends=0,revokeDuringSend=false;const replies=require('../modules/platform/course-quick-reply-router')({pool,origin,authenticate:guard.guard,send:async()=>{sends++;if(revokeDuringSend)await pool.query('UPDATE sx_memberships SET assigned_navigation=JSON_ARRAY() WHERE id=?',[people.agent.membership]);}});app.use(['/api/workspace/inbox/course-replies','/api/inbox/course-replies','/api/agent/course-replies'],replies);
 app.use((error,req,res,next)=>{if(!res.headersSent)res.status(error.status||503).json({success:false,code:error.code||'UNAVAILABLE'});});
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=origin+':'+server.address().port;
 async function request(role,kind,url,method='GET',body,{csrf=true,foreign=false}={}){
  const person=people[role],headers={Origin:foreign?'https://foreign.invalid':origin,'Content-Type':'application/json'};
  if(kind==='bearer'){headers.Authorization='Bearer '+person.bearer;if(role==='agent')headers['X-Salemax-Actor']='agent';}
  else{headers.Cookie='salemax_dev_session='+person.token;if(csrf&&method!=='GET'){const me=await fetch(base+'/api/user/business-auth/me',{headers:{Cookie:headers.Cookie}});const session=await me.json();headers['X-CSRF-Token']=session.csrfToken;}}
  const response=await fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();return {status:response.status,...data};
 }
 for(const role of Object.keys(people))for(const kind of ['bearer','cookie']){
  const session=await request(role,kind,'/api/workspace/session');assert.equal(session.status,200,JSON.stringify(session));assert.equal(session.data.role,role);
  for(const url of ['/api/workspace/finance/generator/settings','/api/user/training/finance-policies/accountant/generator/settings','/api/workspace/finance/receipts']){const response=await request(role,kind,url);assert.equal(response.status,role==='agent'?403:200,JSON.stringify(response));}
 }
 // Exercise the new feature through the real shared bearer/cookie boundary.
 for(const kind of ['bearer','cookie']){
  const current=await request('owner',kind,'/api/workspace/customization');assert.equal(current.status,200,JSON.stringify(current));
  const document={schemaVersion:1,navigationLabels:{inbox:{en:'Synthetic desk '+kind,ar:'مكتب تجريبي'}}};
  assert.equal((await request('owner',kind,'/api/workspace/customization/preview','POST',{document})).status,200);
  assert.equal((await request('owner',kind,'/api/workspace/customization/draft','PUT',{expectedRevision:current.data.revision,document})).status,200);
  assert.equal((await request('owner',kind,'/api/crm/customization/publish','POST',{expectedRevision:current.data.revision+1})).status,200);
  for(const role of ['owner','manager','accountant','agent']){
   const visible=await request(role,kind,'/api/workspace/session');assert.equal(visible.status,200,JSON.stringify(visible));
   assert.equal(visible.data.navigationLabels.inbox?.en,role==='accountant'?undefined:document.navigationLabels.inbox.en);
   if(role!=='owner')assert.equal((await request(role,kind,'/api/workspace/customization')).status,403);
  }
 }
 const saved=await request('owner','cookie','/api/workspace/customization');
 assert.equal((await request('owner','cookie','/api/workspace/customization/draft','PUT',{expectedRevision:saved.data.revision,document:{schemaVersion:1,navigationLabels:{}}},{csrf:false})).status,403);
 assert.equal((await request('owner','bearer','/api/workspace/customization/preview','POST',{document:{schemaVersion:1,navigationLabels:{}}},{foreign:true})).status,403);
 const leadField={key:'cf_text_0123456789abcdef',type:'text',label:{en:'Account reference',ar:'مرجع الحساب'},required:true,active:true,version:1};
 const fieldState=await request('owner','cookie','/api/workspace/customization');
 assert.equal((await request('owner','cookie','/api/workspace/customization/draft','PUT',{expectedRevision:fieldState.data.revision,document:{schemaVersion:2,navigationLabels:{},leadFields:[leadField]}})).status,200);
 assert.equal((await request('owner','bearer','/api/workspace/customization/publish','POST',{expectedRevision:fieldState.data.revision+1})).status,200);
 process.env.SALEMAX_PLATFORM_ENABLED='true';
 const pipeline=require('../helper/pipeline/leadPipeline'),runtime=require('../modules/platform/lead-field-runtime'),fieldContract=await runtime.contractForOwner(pool,people.owner.uid);
 await assert.rejects(pipeline.createManualLead({uid:people.owner.uid,actorType:'user',actorId:people.owner.uid,role:'owner',pool,input:{title:'Missing required field',contactName:'Synthetic missing',mobile:'+12025550198'}}),{code:'REQUIRED_LEAD_FIELD'});
 const customLead=await pipeline.createManualLead({uid:people.owner.uid,actorType:'user',actorId:people.owner.uid,role:'owner',pool,input:{title:'Synthetic custom lead',contactName:'Synthetic custom',mobile:'+12025550199',customFields:{configurationRevision:fieldContract.revision,values:{[leadField.key]:'Reference A'}}}});
 let [[customRow]]=await pool.query('SELECT qualification_data FROM pipeline_leads WHERE id=?',[customLead.id]);let customSaved=typeof customRow.qualification_data==='string'?JSON.parse(customRow.qualification_data):customRow.qualification_data;assert.equal(customSaved.customFields[leadField.key].value,'Reference A');
 await pipeline.updateLead({uid:people.owner.uid,id:customLead.id,role:'owner',actorType:'user',actorId:people.owner.uid,pool,input:{qualificationData:{preferredContactMethod:'call'}}});
 [[customRow]]=await pool.query('SELECT qualification_data FROM pipeline_leads WHERE id=?',[customLead.id]);customSaved=typeof customRow.qualification_data==='string'?JSON.parse(customRow.qualification_data):customRow.qualification_data;assert.equal(customSaved.customFields[leadField.key].value,'Reference A');
 await assert.rejects(pipeline.updateLead({uid:people.owner.uid,id:customLead.id,role:'agent',agentId:people.agent.id,actorType:'agent',actorId:String(people.agent.id),pool,input:{customFields:{configurationRevision:fieldContract.revision,values:{[leadField.key]:'Not assigned'}}}}));
 await assert.rejects(pipeline.updateLead({uid:people.owner.uid,id:customLead.id,role:'owner',actorType:'user',actorId:people.owner.uid,pool,input:{customFields:{configurationRevision:fieldContract.revision-1,values:{[leadField.key]:'Stale'}}}}),{code:'STALE_LEAD_FIELD_CONFIGURATION'});
 // Reset only the disposable fixture's active pointer before unrelated category
 // reclassification tests below. Historical revisions remain tenant-scoped.
 await pool.query('UPDATE sx_tenant_customization_heads SET active_id=NULL,draft_id=NULL WHERE tenant_id=?',[tenant]);
 const [book]=await pool.query("INSERT INTO phonebook(uid,name) VALUES ('synthetic-unified-owner','Synthetic shared book')");
 for(const kind of ['bearer','cookie']){const result=await request('manager',kind,'/api/workspace/phonebook/bootstrap');assert.equal(result.books[0].id,book.insertId);assert.equal(result.manage,true);}
 const share=await request('owner','cookie','/api/workspace/phonebook/share','POST',{resourceType:'book',ids:[book.insertId],recipientType:'agents',recipientId:people.agent.id});assert.equal(share.success,true,JSON.stringify(share));
 for(const kind of ['bearer','cookie']){const result=await request('agent',kind,'/api/workspace/phonebook/bootstrap');assert.equal(result.books[0].id,book.insertId);assert.equal(result.manage,false);assert.equal((await request('agent',kind,'/api/workspace/phonebook/settings','PUT',{labels:['A','B','C','D','E'],rules:[],revision:0})).status,403);}
 const course=uuid(),foreignCourse=uuid();for(const [id,owner]of [[course,tenant],[foreignCourse,foreignTenant]])await pool.query("INSERT INTO sx_training_courses(id,tenant_id,code,name_en,name_ar,description_en,description_ar,duration_value,duration_unit,delivery_mode,status,created_by_identity_id,updated_by_identity_id) VALUES (?,?,'SYNTHETIC','Synthetic course','دورة تجريبية','Synthetic description','وصف تجريبي',8,'weeks','online','active',?,?)",[id,owner,people.owner.identity,people.owner.identity]);
 await pool.query("INSERT INTO beta_chats(uid,chat_id,origin,assigned_agent,sender_mobile,sender_name) VALUES ('synthetic-unified-owner','synthetic-chat','qr',?,'97450000001','Synthetic')",[JSON.stringify([{kind:'identity',identityId:people.agent.identity},{kind:'identity',identityId:people.manager.identity}])]);
 for(const role of ['owner','manager','agent'])for(const kind of ['bearer','cookie']){const result=await request(role,kind,'/api/workspace/inbox/course-replies?chatId=synthetic-chat');assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.data.courses.length,1);assert.equal((await request(role,kind,'/api/workspace/inbox/course-replies/preview/'+foreignCourse+'?chatId=synthetic-chat')).status,404);assert.equal((await request(role,kind,'/api/workspace/inbox/course-replies?chatId=foreign-chat')).status,403);}
 assert.equal((await request('agent','cookie','/api/workspace/inbox/course-replies/send','POST',{requestId:uuid(),chatId:'synthetic-chat',courseId:course},{csrf:false})).status,403);
 assert.equal((await request('manager','bearer','/api/workspace/inbox/course-replies/send','POST',{requestId:uuid(),chatId:'synthetic-chat',courseId:course},{foreign:true})).status,403);
 const complete=await request('agent','cookie','/api/workspace/inbox/course-replies/send','POST',{requestId:uuid(),chatId:'synthetic-chat',courseId:course,language:'ar'});assert.equal(complete.data.state,'sent',JSON.stringify(complete));assert.ok(sends>=1);
 revokeDuringSend=true;const stopped=await request('agent','cookie','/api/workspace/inbox/course-replies/send','POST',{requestId:uuid(),chatId:'synthetic-chat',courseId:course,language:'en'});assert.equal(stopped.data.state,'stopped',JSON.stringify(stopped));assert.equal(stopped.data.sent,1);
 // Grant additional business features through the same Manager role editor.
 await pool.query("UPDATE sx_memberships SET assigned_navigation=NULL WHERE id=?",[people.manager.membership]);
 await pool.query('UPDATE user SET plan=?,plan_expire=? WHERE id=?',[JSON.stringify({qr_account:5,contact_limit:1000}),String(Date.now()+30*86400000),people.owner.id]);
 const team=require('../modules/platform/team-invitations');
 const expanded=['tenant.read','conversations.read','conversations.reply','contacts.read','contacts.manage','courses.read','courses.manage','channels.configure','invoices.read','invoices.issue','receipts.read','payments.verify','forms.manage','forms.capture','tasks.read','tasks.manage'];
 const profile=await team.createRole(pool,people.manager.uid,{name:'Synthetic expanded Agent',seatRole:'agent',permissions:expanded});
 await team.updateMemberRole(pool,people.manager.uid,people.agent.membership,{roleProfileId:profile.id});
 await pool.query('UPDATE sx_memberships SET assigned_navigation=NULL WHERE id=?',[people.agent.membership]);
 await team.updateRole(pool,people.manager.uid,profile.id,{name:'Synthetic expanded Agent',permissions:expanded,sidebarNavigation:['courses','contacts','tasks']});
 const savedRole=(await team.list(pool,people.manager.uid)).roles.find(item=>item.id===profile.id);assert.deepEqual(savedRole.sidebarNavigation,['courses','contacts','tasks']);
 for(const kind of ['bearer','cookie']){const current=await request('agent',kind,'/api/workspace/session');assert.equal(current.status,200);assert.deepEqual([...current.data.roleNavigation].sort(),['contacts','courses','tasks']);}
 await assert.rejects(team.updateRole(pool,people.manager.uid,profile.id,{name:'Synthetic expanded Agent',permissions:expanded.filter(key=>key!=='invoices.read'),sidebarNavigation:['finance-reports']}),{code:'INVALID_ROLE_NAVIGATION'});
 await team.updateRole(pool,people.manager.uid,profile.id,{name:'Synthetic expanded Agent',permissions:expanded,sidebarNavigation:null});

 await pool.query('UPDATE sx_memberships SET assigned_navigation=NULL WHERE id=?',[people.agent.membership]);
 for(const kind of ['bearer','cookie']){
  const session=await request('agent',kind,'/api/workspace/session');assert.equal(session.status,200,JSON.stringify(session));
  for(const key of ['whatsapp-qr','courses','invoices','contacts','forms'])assert.ok(session.data.roleNavigation.includes(key),key);
  assert.equal((await request('agent',kind,'/api/workspace/courses','POST',{code:'AGENT-01-'+kind,nameEn:'Agent course',nameAr:'دورة الوكيل',durationValue:4,durationUnit:'weeks',deliveryMode:'online',offer:{priceMinor:1200}})).status,201);
  assert.equal((await request('agent',kind,'/api/workspace/finance/generator/settings')).status,200);
  assert.equal((await request('agent',kind,'/api/workspace/finance/receipts')).status,200);
  assert.equal((await request('agent',kind,'/api/workspace/phonebook/bootstrap')).manage,true);
 }
 const shellProfile=await request('agent','bearer','/api/user/get_me');assert.equal(shellProfile.status,200,JSON.stringify(shellProfile));assert.equal(shellProfile.data.uid,people.agent.uid);assert.equal(shellProfile.data.email,'agent@example.invalid');assert.equal(shellProfile.data.password,undefined);assert.equal(shellProfile.data.api_key,undefined);
 const identity=await request('agent','bearer','/api/user/business-auth/me');assert.equal(identity.context.membership.role,'agent');assert.equal(identity.context.identity.id,people.agent.identity);
 const dashboard=await request('agent','bearer','/api/user/get_dashboard');assert.equal(dashboard.data.user.uid,people.agent.uid);assert.equal(dashboard.data.user.password,undefined);
 const generation=await request('agent','bearer','/api/workspace/channels/qr/gen_qr','POST',{title:'Synthetic Agent channel'});assert.equal(generation.success,true,JSON.stringify(generation));assert.equal(qrStarts,1);
 const [[ownedChannel]]=await pool.query("SELECT id,uniqueId FROM instance WHERE title='Synthetic Agent channel'");
 const listChannels=await request('agent','bearer','/api/workspace/channels/qr/get_all');assert.equal(listChannels.success,true,JSON.stringify(listChannels));assert.equal(listChannels.data.length,1);assert.equal(listChannels.data[0].sharedAccess,false);
 const [foreignChannel]=await pool.query("INSERT INTO instance(uid,title,uniqueId,status) VALUES (?,'Owner channel','synthetic-owner-channel','INACTIVE')",[people.owner.uid]);
 assert.equal((await request('agent','bearer','/api/qr/del_instance','POST',{uniqueId:'synthetic-owner-channel'})).status,404);
 assert.equal((await request('agent','bearer','/api/qr/get_all')).data.length,1);
 const agentScope=await require('../modules/platform/team-inbox-scope').resolveInboxScope(async(sql,args)=>(await pool.query(sql,args))[0],{...(await pool.query('SELECT * FROM agents WHERE id=?',[people.agent.id]))[0][0],isAgent:true},'get_chat_list');assert.ok(agentScope.sharedQrInstances.some(row=>row.uniqueId===ownedChannel.uniqueId));
 await team.updateRole(pool,people.manager.uid,profile.id,{name:'Synthetic expanded Agent',permissions:expanded.filter(key=>key!=='channels.configure')});
 assert.equal((await request('agent','bearer','/api/qr/gen_qr','POST',{title:'Denied channel'})).status,403);assert.equal(qrStarts,1);
 await team.updateRole(pool,people.manager.uid,profile.id,{name:'Synthetic expanded Agent',permissions:expanded});
 await pool.query("UPDATE sx_memberships SET assigned_navigation=JSON_ARRAY('inbox') WHERE id=?",[people.agent.membership]);
 assert.equal((await request('agent','bearer','/api/workspace/courses')).status,403);
 await pool.query("UPDATE sx_memberships SET role_profile_id=NULL,assigned_navigation=JSON_ARRAY('inbox','contacts') WHERE id=?",[people.agent.membership]);
 await pool.query('DELETE FROM sx_qr_channel_shares WHERE instance_id=?',[ownedChannel.id]);await pool.query('DELETE FROM instance WHERE id IN (?,?)',[ownedChannel.id,foreignChannel.insertId]);
 await pool.query("UPDATE sx_memberships SET status='inactive' WHERE id=?",[people.manager.membership]);
 assert.equal((await request('manager','cookie','/api/workspace/session')).status,401);assert.equal((await request('manager','bearer','/api/workspace/session')).status,403);
 // Reclassify this disposable tenant to prove storage and endpoint isolation
 // even when a category change leaves historical training records behind.
 const salesCategory=require('../modules/platform/categories').salemaxSales;
 const salesLimits=JSON.stringify({owner:1,accountant:3,manager:3,team_leader:3,agent:10});
 await pool.query("UPDATE sx_tenants SET category_key='salemax_sales' WHERE id=?",[tenant]);
 await pool.query("UPDATE sx_plan_versions SET category_key='salemax_sales',capabilities=?,role_limits=? WHERE id=?",[JSON.stringify(salesCategory.capabilities),salesLimits,version]);
 await pool.query('UPDATE sx_plan_assignments SET role_limits=? WHERE tenant_id=?',[salesLimits,tenant]);
 await pool.query("UPDATE sx_memberships SET status='active',assigned_navigation=JSON_ARRAY('inbox','contacts','products-services') WHERE tenant_id=?",[tenant]);
 for(const kind of ['bearer','cookie'])for(const role of ['owner','manager','agent']){
  assert.equal((await request(role,kind,'/api/workspace/products-services')).status,200);
  assert.equal((await request(role,kind,'/api/workspace/courses')).status,403);
  const options=await request(role,kind,'/api/workspace/inbox/course-replies?chatId=synthetic-chat');assert.equal(options.data.catalogKind,'products');assert.equal(options.data.courses.length,0);
 }
 for(const kind of ['bearer','cookie'])assert.equal((await request('accountant',kind,'/api/workspace/products-services')).status,403);
 const product=await request('owner','cookie','/api/workspace/products-services','POST',{code:'SERVICE-01',nameEn:'Synthetic product',nameAr:'منتج تجريبي',offer:{priceMinor:9900}});assert.equal(product.status,201,JSON.stringify(product));
 const productId=product.data.id;
 assert.equal((await request('manager','bearer','/api/workspace/products-services/'+productId+'/publish','POST',{expectedRevision:1})).status,200);
 for(const kind of ['bearer','cookie']){
  const options=await request('agent',kind,'/api/workspace/inbox/course-replies?chatId=synthetic-chat');assert.equal(options.data.courses.length,1);assert.equal(options.data.courses[0].id,productId);
  assert.equal((await request('agent',kind,'/api/workspace/inbox/course-replies/preview/'+course+'?chatId=synthetic-chat')).status,404);
 }
 console.log(JSON.stringify({passed:true,migrations:require('../database/migration-runner').discover(path.join(__dirname,'../database/migrations')).length,checks:['typed lead fields persisted through actual create/update, required validation, assigned scope, stale config and historical preservation','tenant customization with real bearer and cookie auth, published session labels, owner-only writes, CSRF and Origin checks','owner manager accountant agent bearer and real cookie auth','one Finance route for all roles and compatibility aliases','Finance screen includes receipts','manager uses owner phonebooks','same-account sharing and agent read-only scope','Inbox-only published course replies','foreign course and conversation denial','real cookie CSRF and Origin denial','Arabic ordered send with fake transport','mid-send permission revocation stops subsequent messages','inactive member denied for both session kinds','Sales catalog with both auth kinds and category-specific APIs and quick replies','Sales owner creates and manager publishes; agent reads; accountant denied','historical training courses stay separate after category changes','Manager creates expanded Agent role and assigns it','Agent writes course and manages phonebook with bearer and cookie sessions','Agent Finance read after explicit grant','Agent safe shell profile and identity','actual QR generation/list router with fake provider and self channel grant','foreign QR deletion denied','grant and sidebar revocation take effect immediately'],customerDataTouched:false,externalMessages:0}));
 }finally{if(server)await new Promise(r=>server.close(r));if(legacyPool)await legacyPool.promise().end();await pool?.end();await admin.query('DROP DATABASE IF EXISTS `'+name+'`');await admin.end();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
