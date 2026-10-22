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
 for(const table of ['admin','plan','web_public','web_private','user','orders','contact_form','broadcast','beta_campaign','beta_chats','beta_conversation','agents','agent_task','instance','meta_api','beta_flows','contact','phonebook','flow_data']){
 const columns=inventory.columns.filter(c=>c.tableName===table&&!(table==='instance'&&c.columnName==='inactiveSince'));
 if(!columns.length)continue;
 await pool.query('CREATE TABLE `'+table+'` ('+columns.map(c=>'`'+c.columnName+'` '+c.columnType+' '+(c.nullable==='NO'?'NOT NULL':'')+' '+(c.columnKey==='PRI'?'PRIMARY KEY':'')+' '+(c.extra==='auto_increment'?'AUTO_INCREMENT':'')+' '+(c.columnName==='createdAt'?'DEFAULT CURRENT_TIMESTAMP':'')).join(',')+')');
 }
 const db=await pool.getConnection();try{await require('../database/migration-runner').applyMigrations(db,require('../database/migration-runner').discover(path.join(__dirname,'../database/migrations')));}catch(error){const [failed]=await db.query("SELECT migration_name,error_code,statements_completed FROM salemax_schema_migrations WHERE status<>'applied'");console.error(JSON.stringify({syntheticMigrationFailure:failed}));throw error;}finally{db.release();}

 const flowData=require('../modules/platform/legacy-flow-data'),flowKey='synthetic-shared-conversation-key',flowOwnerA='synthetic-flow-owner-a',flowOwnerB='synthetic-flow-owner-b',flowQuery=async(sql,args)=>{const [rows]=await pool.query(sql,args);return rows;};
 await pool.query('INSERT INTO flow_data(uid,uniqueId,inputs,other) VALUES (?,?,?,?)',[flowOwnerA,flowKey,'{"owner":"a"}',null]);
 await pool.query('INSERT INTO flow_data(uid,uniqueId,inputs,other) VALUES (?,?,?,?)',[flowOwnerB,flowKey,'{"owner":"b"}',null]);
 await assert.rejects(pool.query('INSERT INTO flow_data(uid,uniqueId,inputs,other) VALUES (?,?,?,?)',[flowOwnerA,flowKey,'{"owner":"duplicate"}',null]),{code:'ER_DUP_ENTRY'},'the same owner/key pair must be unique');
 await pool.query('INSERT INTO flow_data(uid,uniqueId,inputs,other) VALUES (?,?,?,?)',[flowOwnerA,'synthetic-second-key','{"owner":"second"}',null]);
 await assert.rejects(pool.query('UPDATE flow_data SET uniqueId=? WHERE uid=? AND uniqueId=?',[flowKey,flowOwnerA,'synthetic-second-key']),{code:'ER_DUP_ENTRY'},'rekeying must not create a same-owner duplicate');
 const concurrentFlowKey='synthetic-concurrent-flow-key';
 const concurrentFlowWrites=await Promise.allSettled([
  pool.query('INSERT INTO flow_data(uid,uniqueId,inputs,other) VALUES (?,?,?,?)',[flowOwnerA,concurrentFlowKey,'{"writer":"a"}',null]),
  pool.query('INSERT INTO flow_data(uid,uniqueId,inputs,other) VALUES (?,?,?,?)',[flowOwnerA,concurrentFlowKey,'{"writer":"b"}',null]),
 ]);
 assert.equal(concurrentFlowWrites.filter(result=>result.status==='fulfilled').length,1,'concurrent duplicate flow-state writes must have one winner');
 assert.equal(concurrentFlowWrites.filter(result=>result.status==='rejected'&&result.reason.code==='ER_DUP_ENTRY').length,1,'the database unique key must reject the racing duplicate');
 const [[flowHash]]=await pool.query('SELECT HEX(owner_key_hash) AS ownerKeyHash FROM flow_data WHERE uid=? AND uniqueId=?',[flowOwnerA,flowKey]);
 assert.equal(flowHash.ownerKeyHash,sha(Buffer.concat([Buffer.from(flowOwnerA),Buffer.from([0]),Buffer.from(flowKey)])).toUpperCase());
 const utf8FlowOwner='synthetic-flow-owner-é',utf8FlowKey='conversation-猫';
 await flowData.insertInputs(flowQuery,utf8FlowOwner,utf8FlowKey,'{"unicode":"ok"}',null);
 const [[utf8FlowHash]]=await pool.query('SELECT HEX(owner_key_hash) AS ownerKeyHash FROM flow_data WHERE uid=? AND uniqueId=?',[utf8FlowOwner,utf8FlowKey]);
 assert.equal(utf8FlowHash.ownerKeyHash,sha(Buffer.concat([Buffer.from(utf8FlowOwner),Buffer.from([0]),Buffer.from(utf8FlowKey)])).toUpperCase(),'generated SQL hash must match Node UTF-8 bytes');
 assert.equal((await flowData.find(flowQuery,flowOwnerA,flowKey)).inputs,'{"owner":"a"}');
 await flowData.setInputs(flowQuery,flowOwnerA,flowKey,'{"owner":"a-updated"}');
 const [flowRows]=await pool.query('SELECT uid,inputs FROM flow_data WHERE uniqueId=? ORDER BY uid',[flowKey]);
 assert.deepEqual(flowRows.map(row=>[row.uid,row.inputs]),[[flowOwnerA,'{"owner":"a-updated"}'],[flowOwnerB,'{"owner":"b"}']]);
 const [flowIndexes]=await pool.query("SELECT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='flow_data'");
 assert.ok(flowIndexes.some(row=>row.index_name==='idx_flow_data_owner_unique'));
 assert.ok(flowIndexes.some(row=>row.index_name==='uq_flow_data_owner_key_hash'));
 const [[flowUniqueIndex]]=await pool.query("SELECT non_unique AS nonUnique FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='flow_data' AND index_name='uq_flow_data_owner_key_hash'");
 assert.equal(Number(flowUniqueIndex.nonUnique),0);
 const profileFlowA=flowData.profileConversationKey(flowOwnerA,101,'97450000001','synthetic-chat');
 const profileFlowB=flowData.profileConversationKey(flowOwnerA,102,'97450000001','synthetic-chat');
 assert.notEqual(profileFlowA,profileFlowB);
 await flowData.insertInputs(flowQuery,flowOwnerA,profileFlowA,'{"profile":"a"}',null);
 await flowData.insertInputs(flowQuery,flowOwnerA,profileFlowB,'{"profile":"b"}',null);
 assert.equal((await flowData.find(flowQuery,flowOwnerA,profileFlowA)).inputs,'{"profile":"a"}');
 await flowData.setInputs(flowQuery,flowOwnerA,profileFlowA,'{"profile":"a-updated"}');
 const [profileRows]=await pool.query('SELECT uniqueId,inputs FROM flow_data WHERE uid=? AND uniqueId IN (?,?) ORDER BY uniqueId',[flowOwnerA,profileFlowA,profileFlowB]);
 assert.deepEqual(profileRows.map(row=>[row.uniqueId,row.inputs]),[[profileFlowA,'{"profile":"a-updated"}'],[profileFlowB,'{"profile":"b"}']]);

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
  await pool.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status,assigned_navigation) VALUES (?,?,?,?,'active',?)",[membership,tenant,identity,role,JSON.stringify(role==='agent'?['inbox','contacts']:role==='owner'?['dashboard','inbox','invoices','contacts','leads','courses','reports']:['inbox','invoices','contacts','courses','reports'])]);
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
 app.use('/api/pipeline',express.json({limit:'96kb'}),require('../routes/pipeline'));
 const formRouters=require('../modules/platform/training-form-router');app.use(['/api/workspace/forms','/api/user/training/forms'],formRouters.createTrainingFormRouter({pool,origin,sessionGuard:guard.guard}));app.use('/api/public/training/forms',formRouters.createPublicTrainingFormRouter({app,pool,origin,rateKey:crypto.randomBytes(32),turnstile:{enabled:false,publicConfig:null}}));
 app.use('/api/user/chatbots',require('../modules/platform/chatbot-router').createChatbotRouter({pool,origin,userGuard:guard.guard,canonicalGuard:guard.guard}));
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
 const leadWorkspace=require('../modules/platform/lead-workspace-contract');
 assert.deepEqual((await leadWorkspace.forOwner(pool,people.owner.uid)).workflows,{courses:true,forms:true,saleReviews:true});
 assert.equal((await leadWorkspace.forOwner(pool,'synthetic-unmapped-legacy')).profile,'shared');
 await assert.rejects(pipeline.createManualLead({uid:people.owner.uid,actorType:'user',actorId:people.owner.uid,role:'owner',pool,input:{title:'Missing required field',contactName:'Synthetic missing',mobile:'+12025550198'}}),{code:'REQUIRED_LEAD_FIELD'});
 const customLead=await pipeline.createManualLead({uid:people.owner.uid,actorType:'user',actorId:people.owner.uid,role:'owner',pool,input:{title:'Synthetic custom lead',contactName:'Synthetic custom',mobile:'+12025550199',customFields:{configurationRevision:fieldContract.revision,values:{[leadField.key]:'Reference A'}}}});
 let [[customRow]]=await pool.query('SELECT qualification_data FROM pipeline_leads WHERE id=?',[customLead.id]);let customSaved=typeof customRow.qualification_data==='string'?JSON.parse(customRow.qualification_data):customRow.qualification_data;assert.equal(customSaved.customFields[leadField.key].value,'Reference A');
 await pipeline.updateLead({uid:people.owner.uid,id:customLead.id,role:'owner',actorType:'user',actorId:people.owner.uid,pool,input:{qualificationData:{preferredContactMethod:'call'}}});
 [[customRow]]=await pool.query('SELECT qualification_data FROM pipeline_leads WHERE id=?',[customLead.id]);customSaved=typeof customRow.qualification_data==='string'?JSON.parse(customRow.qualification_data):customRow.qualification_data;assert.equal(customSaved.customFields[leadField.key].value,'Reference A');
 await assert.rejects(pipeline.updateLead({uid:people.owner.uid,id:customLead.id,role:'agent',agentId:people.agent.id,actorType:'agent',actorId:String(people.agent.id),pool,input:{customFields:{configurationRevision:fieldContract.revision,values:{[leadField.key]:'Not assigned'}}}}));
 await assert.rejects(pipeline.updateLead({uid:people.owner.uid,id:customLead.id,role:'owner',actorType:'user',actorId:people.owner.uid,pool,input:{customFields:{configurationRevision:fieldContract.revision-1,values:{[leadField.key]:'Stale'}}}}),{code:'STALE_LEAD_FIELD_CONFIGURATION'});
 const [[savedCapabilities]]=await pool.query('SELECT capabilities FROM sx_plan_versions WHERE id=?',[version]);
 try{
  await pool.query('UPDATE sx_plan_versions SET capabilities=? WHERE id=?',[JSON.stringify(category.capabilities.filter(capability=>capability!=='crm.leads')),version]);
  const customizationPreview=await request('owner','bearer','/api/workspace/customization/preview','POST',{document:{schemaVersion:2,navigationLabels:{},leadFields:[leadField]}});assert.equal(customizationPreview.status,409);assert.equal(customizationPreview.code,'FEATURE_UNAVAILABLE');
  const revokedSettings=await request('owner','cookie','/api/workspace/customization');assert.equal(revokedSettings.status,200);
  const revokedDraft=await request('owner','cookie','/api/workspace/customization/draft','PUT',{expectedRevision:revokedSettings.data.revision,document:{schemaVersion:2,navigationLabels:{},leadFields:[leadField]}});assert.equal(revokedDraft.status,409);assert.equal(revokedDraft.code,'FEATURE_UNAVAILABLE');
  const revokedContract=await require('../modules/platform/lead-field-runtime').contractForOwner(pool,people.owner.uid);assert.deepEqual(revokedContract.fields,[]);assert.equal(revokedContract.available,false);
  await assert.rejects(pipeline.updateLead({uid:people.owner.uid,id:customLead.id,role:'owner',actorType:'user',actorId:people.owner.uid,pool,input:{customFields:{configurationRevision:fieldContract.revision,values:{[leadField.key]:'Blocked after revocation'}}}}),{code:'FEATURE_UNAVAILABLE'});
  await pipeline.updateLead({uid:people.owner.uid,id:customLead.id,role:'owner',actorType:'user',actorId:people.owner.uid,pool,input:{qualificationData:{preferredContactMethod:'email'}}});
  [[customRow]]=await pool.query('SELECT qualification_data FROM pipeline_leads WHERE id=?',[customLead.id]);customSaved=typeof customRow.qualification_data==='string'?JSON.parse(customRow.qualification_data):customRow.qualification_data;assert.equal(customSaved.customFields[leadField.key].value,'Reference A');
 }finally{const restoreCapabilities=typeof savedCapabilities.capabilities==='string'?JSON.parse(savedCapabilities.capabilities):savedCapabilities.capabilities;await pool.query('UPDATE sx_plan_versions SET capabilities=? WHERE id=?',[JSON.stringify(restoreCapabilities),version]);}
 // Category contract mismatches must deny even shared-capability APIs.
 const entitlementLoader=require('../modules/platform/plans');
 const correctEntitlement=await entitlementLoader.loadEntitlements(pool,tenant);assert.equal(correctEntitlement.categoryKey,'training_center');
 for(const patch of [{key:'7network_sales',version:1},{key:'training_center',version:2}]){
  await pool.query('UPDATE sx_plan_versions SET category_key=?,category_version=? WHERE id=?',[patch.key,patch.version,version]);
  assert.equal(await entitlementLoader.loadEntitlements(pool,tenant),null);
  for(const kind of ['bearer','cookie'])for(const endpoint of ['/api/workspace/courses','/api/workspace/finance/receipts','/api/workspace/phonebook/bootstrap']){const denied=await request('owner',kind,endpoint);assert.ok([403,409].includes(denied.status),JSON.stringify({endpoint,denied}));assert.equal(denied.code,'FEATURE_UNAVAILABLE');assert.equal(denied.success,false);}
 }
 await pool.query("UPDATE sx_plan_versions SET category_key='training_center',category_version=1 WHERE id=?",[version]);
 assert.equal((await entitlementLoader.loadEntitlements(pool,tenant)).assignmentId,correctEntitlement.assignmentId);
 for(const kind of ['bearer','cookie']){const restoredCourses=await request('owner',kind,'/api/workspace/courses');assert.equal(restoredCourses.status,200,JSON.stringify(restoredCourses));}
 // Existing authenticated form editor and public/staff submission paths share pinned fields.
 const formsDenied=await request('owner','cookie','/api/workspace/forms/lead-fields');assert.equal(formsDenied.status,403,JSON.stringify(formsDenied));assert.equal(formsDenied.code,'PERMISSION_DENIED');
 await pool.query("UPDATE sx_memberships SET assigned_navigation=JSON_ARRAY_APPEND(assigned_navigation,'$', 'forms') WHERE id=?",[people.owner.membership]);
 const formOptions=await request('owner','cookie','/api/workspace/forms/lead-fields');assert.equal(formOptions.status,200,JSON.stringify(formOptions));assert.equal(formOptions.data.revision,fieldContract.revision);
 assert.equal((await request('agent','bearer','/api/workspace/forms/lead-fields')).status,403);
 const formPayload={slug:'synthetic-custom-form',nameEn:'Synthetic custom form',nameAr:'نموذج تجريبي',schema:{titleEn:'Synthetic form',titleAr:'نموذج تجريبي',consentTextEn:'I consent to contact.',consentTextAr:'أوافق على التواصل.',fields:[{key:'contact_name',labelEn:'Name',labelAr:'الاسم',required:true},{key:'phone',labelEn:'Phone',labelAr:'الهاتف',required:true},{key:'consent',labelEn:'Consent',labelAr:'الموافقة',required:true}],leadFields:{configurationRevision:fieldContract.revision,fields:[leadField]}}};
 const formCreated=await request('owner','cookie','/api/workspace/forms','POST',formPayload);assert.equal(formCreated.status,201,JSON.stringify(formCreated));
 const formPublished=await request('owner','bearer','/api/workspace/forms/'+formCreated.data.id+'/publish','POST',{expectedRevision:1});assert.equal(formPublished.status,200,JSON.stringify(formPublished));
 const values={contact_name:'Synthetic form person',phone:'+12025550197',consent:true,customFields:{[leadField.key]:'Form reference'}};
 const publicToken=uuid(),publicPath='/api/public/training/forms/unified/synthetic-custom-form/submissions';
 assert.equal((await request('owner','bearer',publicPath,'POST',{submissionToken:uuid(),values:{...values,customFields:{}}})).status,400);
 assert.equal((await request('owner','bearer',publicPath,'POST',{submissionToken:uuid(),values:{...values,customFields:{cf_text_fedcba9876543210:'foreign'}}})).status,400);
 const pinned=await request('owner','cookie','/api/workspace/customization');
 const archivedDocument={schemaVersion:2,navigationLabels:{},leadFields:[{...leadField,active:false,label:{en:'Archived reference',ar:'مرجع مؤرشف'}}]};
 assert.equal((await request('owner','cookie','/api/workspace/customization/draft','PUT',{expectedRevision:pinned.data.revision,document:archivedDocument})).status,200);
 assert.equal((await request('owner','bearer','/api/workspace/customization/publish','POST',{expectedRevision:pinned.data.revision+1})).status,200);
 const publicResult=await request('owner','bearer',publicPath,'POST',{submissionToken:publicToken,values});assert.equal(publicResult.status,201,JSON.stringify(publicResult));
 const retry=await request('owner','bearer',publicPath,'POST',{submissionToken:publicToken,values});assert.equal(retry.status,200);assert.equal(retry.data.referenceCode,publicResult.data.referenceCode);
 const [[submitted]]=await pool.query('SELECT lead_id,submission_data FROM sx_training_form_submissions WHERE tenant_id=? AND reference_code=?',[tenant,publicResult.data.referenceCode]);
 const submissionData=typeof submitted.submission_data==='string'?JSON.parse(submitted.submission_data):submitted.submission_data;assert.equal(submissionData.customFields[leadField.key].definition.label.en,'Account reference');
 const [[formLead]]=await pool.query('SELECT qualification_data FROM pipeline_leads WHERE id=?',[submitted.lead_id]);const formSaved=typeof formLead.qualification_data==='string'?JSON.parse(formLead.qualification_data):formLead.qualification_data;assert.equal(formSaved.customFields[leadField.key].value,'Form reference');assert.equal(formSaved.customFields[leadField.key].configurationRevision,fieldContract.revision);
 const staffPath='/api/pipeline/training-forms/synthetic-custom-form/submissions';
 const staffResult=await request('owner','bearer',staffPath,'POST',{submissionToken:uuid(),values:{...values,customFields:{[leadField.key]:'Staff reference'}},selectedLeadId:customLead.id});assert.equal(staffResult.status,201,JSON.stringify(staffResult));
 assert.equal((await request('owner','bearer',staffPath,'POST',{submissionToken:uuid(),values:{...values,customFields:{}}})).status,400);
 assert.equal((await request('owner','bearer',staffPath,'POST',{submissionToken:uuid(),values:{...values,customFields:{[leadField.key]:'x'.repeat(100000)}}})).status,413);
 const [[staffLinked]]=await pool.query('SELECT qualification_data FROM pipeline_leads WHERE id=?',[customLead.id]);const staffSaved=typeof staffLinked.qualification_data==='string'?JSON.parse(staffLinked.qualification_data):staffLinked.qualification_data;assert.equal(staffSaved.customFields[leadField.key].value,'Staff reference');assert.equal(staffSaved.preferredContactMethod,'email');
 assert.equal((await request('owner','cookie','/api/workspace/forms','POST',{...formPayload,slug:'stale-form'})).status,409);
 // A visitor's displayed version cannot silently adopt later questions/consent.
 const versionSchema={...formPayload.schema};delete versionSchema.leadFields;
 const versionForm=await request('owner','cookie','/api/workspace/forms','POST',{...formPayload,slug:'version-check',schema:versionSchema});assert.equal(versionForm.status,201);
 const versionFormPath='/api/workspace/forms/'+versionForm.data.id;assert.equal((await request('owner','cookie',versionFormPath+'/publish','POST',{expectedRevision:1})).status,200);
 const versionValues={contact_name:'Version synthetic',phone:'+12025550196',consent:true},savedVersionToken=uuid(),versionPublic='/api/public/training/forms/unified/version-check/submissions',versionStaff='/api/pipeline/training-forms/version-check/submissions';
 const firstVersion=await request('owner','bearer',versionPublic,'POST',{submissionToken:savedVersionToken,expectedFormVersion:1,values:versionValues});assert.equal(firstVersion.status,201,JSON.stringify(firstVersion));
 const changedVersionSchema={...versionSchema,consentTextEn:'New consent text',fields:[...versionSchema.fields,{key:'email',labelEn:'Email',labelAr:'البريد',required:true}]};
 assert.equal((await request('owner','cookie',versionFormPath,'PUT',{...formPayload,slug:'version-check',schema:changedVersionSchema,expectedRevision:1})).status,200);
 assert.equal((await request('owner','cookie',versionFormPath+'/publish','POST',{expectedRevision:2})).status,200);
 const versionRetry=await request('owner','bearer',versionPublic,'POST',{submissionToken:savedVersionToken,expectedFormVersion:1,values:versionValues});assert.equal(versionRetry.status,200,JSON.stringify(versionRetry));assert.equal(versionRetry.data.referenceCode,firstVersion.data.referenceCode);
 for(const path of [versionPublic,versionStaff]){
  const stale=await request('owner','bearer',path,'POST',{submissionToken:uuid(),expectedFormVersion:1,values:versionValues});assert.equal(stale.status,409,JSON.stringify(stale));assert.equal(stale.code,'FORM_VERSION_CHANGED');
  for(const invalid of ['2',null,0])assert.equal((await request('owner','bearer',path,'POST',{submissionToken:uuid(),expectedFormVersion:invalid,values:versionValues})).status,400);
 }
 const [[versionCount]]=await pool.query('SELECT COUNT(*) total FROM sx_training_form_submissions WHERE tenant_id=? AND form_id=?',[tenant,versionForm.data.id]);assert.equal(Number(versionCount.total),1);
 const acceptedVersion=await request('owner','bearer',versionPublic,'POST',{submissionToken:uuid(),expectedFormVersion:2,values:{...versionValues,email:'synthetic@example.invalid'}});assert.equal(acceptedVersion.status,201,JSON.stringify(acceptedVersion));
 const [[acceptedSnapshot]]=await pool.query('SELECT form_version,consent_text_en FROM sx_training_form_submissions WHERE tenant_id=? AND reference_code=?',[tenant,acceptedVersion.data.referenceCode]);assert.equal(Number(acceptedSnapshot.form_version),2);assert.equal(acceptedSnapshot.consent_text_en,'New consent text');
 // Reset only the disposable fixture's active pointer before unrelated category
 // reclassification tests below. Historical revisions remain tenant-scoped.
 await pool.query('UPDATE sx_tenant_customization_heads SET active_id=NULL,draft_id=NULL WHERE tenant_id=?',[tenant]);
 // Actual bot dispatch and pre-send guards refresh current entitlement/owner restrictions.
 const runtimeAccess=require('../modules/platform/chatbot-runtime-access'),botRuntime=require('../modules/platform/chatbot-runtime');
 const [[ownerBeforeBot]]=await pool.query('SELECT assigned_navigation FROM sx_memberships WHERE id=?',[people.owner.membership]);
 await pool.query("UPDATE sx_memberships SET assigned_navigation=JSON_ARRAY_APPEND(assigned_navigation,'$', 'chatbot') WHERE id=?",[people.owner.membership]);
 const secondSchema={...formPayload.schema};delete secondSchema.leadFields;
 const secondForm=await request('owner','cookie','/api/workspace/forms','POST',{...formPayload,slug:'synthetic-form-b',nameEn:'Form B',schema:secondSchema});assert.equal(secondForm.status,201,JSON.stringify(secondForm));assert.equal((await request('owner','bearer','/api/workspace/forms/'+secondForm.data.id+'/publish','POST',{expectedRevision:1})).status,200);
 const foreignFormId=uuid();await pool.query("INSERT INTO sx_training_forms(id,tenant_id,slug,name_en,name_ar,draft_schema,status,published_version,published_slug,published_draft_revision,created_by_identity_id,updated_by_identity_id) VALUES (?,?,'foreign-form','Foreign form','نموذج آخر',?,'published',1,'foreign-form',1,?,?)",[foreignFormId,foreignTenant,JSON.stringify(secondSchema),people.owner.identity,people.owner.identity]);
 await pool.query("INSERT INTO sx_training_form_versions(id,tenant_id,form_id,version,slug,name_en,name_ar,schema_json,published_by_identity_id) VALUES (?,?,?,1,'foreign-form','Foreign form','نموذج آخر',?,?)",[uuid(),foreignTenant,foreignFormId,JSON.stringify(secondSchema),people.owner.identity]);
 const botBody={name:'Synthetic form bot A',engine:'guided',config:{guidedMode:'domain_default',captureFormId:formCreated.data.id}};
 const formBotA=await request('owner','cookie','/api/user/chatbots','POST',botBody);assert.equal(formBotA.status,201,JSON.stringify(formBotA));
 const formBotB=await request('owner','bearer','/api/user/chatbots','POST',{...botBody,name:'Synthetic form bot B',config:{...botBody.config,captureFormId:null}});assert.equal(formBotB.status,201,JSON.stringify(formBotB));
 for(const kind of ['bearer','cookie']){const bots=await request('owner',kind,'/api/user/chatbots');assert.equal(bots.status,200);assert.ok(bots.data.captureForms.some(f=>f.id===formCreated.data.id&&f.customFieldCount===1));assert.equal(bots.data.captureForms.some(f=>f.id===foreignFormId),false);}
 const formPreview=await request('owner','cookie','/api/user/chatbots/guided-preview','POST',{message:'form',captureFormId:formCreated.data.id});assert.equal(formPreview.status,200,JSON.stringify(formPreview));assert.match(formPreview.data.reply,/synthetic-custom-form/);assert.doesNotMatch(formPreview.data.reply,/synthetic-form-b|foreign-form/);
 const noFormPreview=await request('owner','bearer','/api/user/chatbots/guided-preview','POST',{message:'form',captureFormId:null});assert.equal(noFormPreview.status,200);assert.doesNotMatch(noFormPreview.data.reply,/\/p\//);
 assert.equal((await request('owner','cookie','/api/user/chatbots','POST',{...botBody,name:'Foreign form bot',config:{...botBody.config,captureFormId:foreignFormId}})).status,409);
 assert.equal((await request('owner','cookie','/api/user/chatbots/guided-preview','POST',{message:'form',captureFormId:foreignFormId})).status,409);
 assert.equal((await request('owner','cookie','/api/user/chatbots/'+formBotA.data.id,'PUT',{...botBody,config:{...botBody.config,captureFormId:secondForm.data.id},expectedRevision:1})).status,200);
 const [formBotRows]=await pool.query('SELECT id,config FROM sx_chatbot_profiles WHERE id IN (?,?)',[formBotA.data.id,formBotB.data.id]);const configFor=id=>{const raw=formBotRows.find(b=>b.id===id).config;return typeof raw==='string'?JSON.parse(raw):raw;};assert.equal(configFor(formBotA.data.id).captureFormId,secondForm.data.id);assert.equal(configFor(formBotB.data.id).captureFormId,null);
 const trainingPack=require('../modules/platform/chatbot-domain-packs').getDomainPack('training_center',1),factArgs={db:pool,tenantId:tenant,platformOrigin:'http://127.0.0.1'};
 const selectedFacts=await trainingPack.loadFacts({...factArgs,config:{captureFormId:formCreated.data.id}});assert.deepEqual(selectedFacts.filter(f=>f.kind==='published_enquiry_form').map(f=>f.formId),[formCreated.data.id]);
 await pool.query("UPDATE sx_training_forms SET status='draft' WHERE tenant_id=? AND id=?",[tenant,formCreated.data.id]);
 const unavailableFacts=await trainingPack.loadFacts({...factArgs,config:{captureFormId:formCreated.data.id}});assert.equal(unavailableFacts.some(f=>f.kind==='published_enquiry_form'),false);
 await pool.query("UPDATE sx_training_forms SET status='published' WHERE tenant_id=? AND id=?",[tenant,formCreated.data.id]);
 await pool.query('DELETE FROM sx_chatbot_profiles WHERE id IN (?,?)',[formBotA.data.id,formBotB.data.id]);
 const activeBotAccess=await runtimeAccess.resolveOwnerAccess(pool,people.owner.uid);assert.ok(activeBotAccess.context);assert.equal(activeBotAccess.context.tenant.id,tenant);
 const botId=uuid(),botChannel='synthetic-runtime-channel';
 await pool.query("INSERT INTO sx_chatbot_profiles(id,tenant_id,category_key,category_version,name,engine,status,config,created_by_identity_id,updated_by_identity_id) VALUES (?,?,'training_center',1,'Synthetic access bot','guided','live',JSON_OBJECT(),?,?)",[botId,tenant,people.owner.identity,people.owner.identity]);
 await pool.query("INSERT INTO sx_chatbot_channel_assignments(id,tenant_id,chatbot_id,channel_kind,channel_ref,assigned_by_identity_id) VALUES (?,?,?,'whatsapp_qr',?,?)",[uuid(),tenant,botId,botChannel,people.owner.identity]);
 const sendGuard={ctx:activeBotAccess.context,profile:{id:botId,revision:1},uid:people.owner.uid,origin:'qr',sessionId:botChannel,chatId:'synthetic-access-chat',message:{senderMobile:'+12025550199'}};
 assert.equal(await botRuntime.canSendNow(sendGuard),true);
 const [[assignmentBefore]]=await pool.query('SELECT expires_at FROM sx_plan_assignments WHERE tenant_id=? AND current_tenant IS NOT NULL',[tenant]);
 await pool.query('UPDATE sx_plan_assignments SET expires_at=TIMESTAMPADD(DAY,-1,UTC_TIMESTAMP(3)) WHERE tenant_id=? AND current_tenant IS NOT NULL',[tenant]);
 assert.equal(await botRuntime.resolveTenant(people.owner.uid),null);assert.equal(await botRuntime.canSendNow(sendGuard),false);
 const blockedBot=await botRuntime.runConfiguredBot({uid:people.owner.uid,chatId:'synthetic-access-chat',sessionId:botChannel,origin:'qr',message:{route:'INCOMING',metaChatId:'synthetic-denied-turn',senderMobile:'+12025550199',msgContext:{text:{body:'Hello'}}}});assert.equal(blockedBot.handled,true);assert.equal(blockedBot.paused,true);assert.equal(blockedBot.code,'FEATURE_UNAVAILABLE');
 const legacyFallback=await botRuntime.runConfiguredBot({uid:people.owner.uid,chatId:'synthetic-access-chat',sessionId:'unassigned-legacy-channel',origin:'qr',message:{route:'INCOMING'}});assert.equal(legacyFallback.handled,false);
 const [[deniedTurns]]=await pool.query("SELECT COUNT(*) total FROM sx_chatbot_turns WHERE tenant_id=? AND conversation_id='synthetic-access-chat'",[tenant]);assert.equal(Number(deniedTurns.total),0);
 await pool.query('UPDATE sx_plan_assignments SET expires_at=? WHERE tenant_id=? AND current_tenant IS NOT NULL',[assignmentBefore.expires_at,tenant]);assert.equal(await botRuntime.canSendNow(sendGuard),true);
 await pool.query("UPDATE sx_memberships SET assigned_navigation=JSON_ARRAY() WHERE id=?",[people.owner.membership]);assert.equal(await botRuntime.canSendNow(sendGuard),false);
 await pool.query('UPDATE sx_memberships SET assigned_navigation=? WHERE id=?',[typeof ownerBeforeBot.assigned_navigation==='string'?ownerBeforeBot.assigned_navigation:JSON.stringify(ownerBeforeBot.assigned_navigation),people.owner.membership]);
 await pool.query('DELETE FROM sx_chatbot_profiles WHERE tenant_id=? AND id=?',[tenant,botId]);
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
 // Shared tasks must obtain their storage tenant from verified server context.
 async function verifySharedTasks(label){
  const [[agentBefore]]=await pool.query('SELECT assigned_navigation FROM sx_memberships WHERE id=?',[people.agent.membership]);
  await pool.query("UPDATE sx_memberships SET assigned_navigation=JSON_ARRAY_APPEND(assigned_navigation,'$', 'leads', '$', 'tasks') WHERE id=?",[people.owner.membership]);
  const listed=await request('owner','bearer','/api/pipeline/tasks');assert.equal(listed.status,200,JSON.stringify({label,...listed}));
  const created=await request('owner','bearer','/api/pipeline/tasks','POST',{title:'Synthetic '+label+' task',tenantId:foreignTenant,participants:[{actorType:'identity',actorId:people.owner.identity,role:'assignee'},{actorType:'agent',actorId:String(people.agent.id),role:'assignee'}]});
  assert.equal(created.status,201,JSON.stringify({label,...created}));
  const [[saved]]=await pool.query('SELECT tenant_id,uid_hash FROM sx_tasks WHERE id=?',[created.data.id]);assert.equal(saved.tenant_id,tenant);assert.equal(saved.uid_hash,sha(people.owner.uid));
  assert.equal((await request('owner','bearer','/api/pipeline/tasks/'+created.data.id)).status,200);
  const foreignTask=crypto.randomUUID();
  await pool.query("INSERT INTO sx_tasks(id,tenant_id,uid_hash,title,created_by_type,created_by_id) VALUES (?,?,?,'Synthetic foreign task','identity',?)",[foreignTask,foreignTenant,sha(people.owner.uid),people.owner.identity]);
  assert.equal((await request('owner','bearer','/api/pipeline/tasks/'+foreignTask)).status,404);
  const visible=await request('owner','bearer','/api/pipeline/tasks');assert.equal(visible.data.items.some(task=>task.id===foreignTask),false);
  await pool.query("UPDATE sx_memberships SET assigned_navigation=JSON_ARRAY('leads','tasks') WHERE id=?",[people.agent.membership]);
  const assigned=await request('agent','bearer','/api/pipeline/tasks/'+created.data.id);assert.equal(assigned.status,200,JSON.stringify({label,...assigned}));
  assert.equal((await request('agent','bearer','/api/pipeline/tasks?scope=team')).status,403);
  await pool.query("UPDATE sx_memberships SET assigned_navigation=JSON_ARRAY('leads') WHERE id=?",[people.agent.membership]);
  assert.equal((await request('agent','bearer','/api/pipeline/tasks/'+created.data.id)).status,403);
  await pool.query('UPDATE sx_memberships SET assigned_navigation=? WHERE id=?',[typeof agentBefore.assigned_navigation==='string'?agentBefore.assigned_navigation:JSON.stringify(agentBefore.assigned_navigation),people.agent.membership]);
  await pool.query("UPDATE sx_memberships SET status='inactive' WHERE id=?",[people.owner.membership]);
  assert.equal((await request('owner','bearer','/api/pipeline/tasks')).status,403);
  await pool.query("UPDATE sx_memberships SET status='active' WHERE id=?",[people.owner.membership]);
  await pool.query("UPDATE sx_memberships SET assigned_navigation=JSON_ARRAY('leads') WHERE id=?",[people.owner.membership]);
  assert.equal((await request('owner','bearer','/api/pipeline/tasks')).status,403);
 }
 await verifySharedTasks('training');
 // Reclassify this disposable tenant to prove storage and endpoint isolation
 // even when a category change leaves historical training records behind.
 const salesCategory=require('../modules/platform/categories').salemaxSales;
 const salesLimits=JSON.stringify({owner:1,accountant:3,manager:3,team_leader:3,agent:10});
 await pool.query("UPDATE sx_tenants SET category_key='7network_sales' WHERE id=?",[tenant]);
 await pool.query("UPDATE sx_plan_versions SET category_key='7network_sales',capabilities=?,role_limits=? WHERE id=?",[JSON.stringify(salesCategory.capabilities),salesLimits,version]);
 await pool.query('UPDATE sx_plan_assignments SET role_limits=? WHERE tenant_id=?',[salesLimits,tenant]);
 const salesWorkspace=await leadWorkspace.forOwner(pool,people.owner.uid);assert.equal(salesWorkspace.profile,'shared');assert.deepEqual(salesWorkspace.workflows,{courses:false,forms:false,saleReviews:false});
 await pool.query("UPDATE sx_memberships SET status='active',assigned_navigation=JSON_ARRAY('inbox','contacts','products-services') WHERE tenant_id=?",[tenant]);
 const [[salesOwnerRow]]=await pool.query('SELECT id,uid,email FROM user WHERE uid=?',[people.owner.uid]);
 const pipelineActors=require('../modules/platform/legacy-pipeline-actor');
 assert.equal((await pipelineActors.resolve(pool,salesOwnerRow)).code,'PERMISSION_DENIED');
 await pool.query("UPDATE sx_memberships SET assigned_navigation=JSON_ARRAY_APPEND(assigned_navigation,'$', 'leads') WHERE id=?",[people.owner.membership]);
 const mappedSalesOwner=await pipelineActors.resolve(pool,salesOwnerRow);assert.equal(mappedSalesOwner.categoryVersion,1);assert.equal(mappedSalesOwner.canonicalContext.category.key,'7network_sales');assert.equal(pipelineActors.canUsePipeline(mappedSalesOwner),true);
 const ownerPipeline=await request('owner','bearer','/api/pipeline/settings');assert.equal(ownerPipeline.status,200,JSON.stringify(ownerPipeline));assert.equal(ownerPipeline.data.categoryKey,'7network_sales');
 await verifySharedTasks('sales');
 await pool.query("UPDATE sx_memberships SET assigned_navigation=JSON_ARRAY('inbox','contacts','products-services','leads') WHERE id=?",[people.owner.membership]);
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
 const baseAccounts=await require('./base-crm-provisioning.integration.cjs')(pool,people.owner.identity);
 for(const [n,account] of baseAccounts.entries()){
  const token=crypto.randomBytes(32).toString('base64url');await pool.query("INSERT INTO sx_sessions(id,token_hash,identity_id,audience,tenant_id,membership_id,credential_version,authenticated_at,expires_at) VALUES (?,?,?,'tenant',?,?,1,UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR))",[uuid(),sha(token),account.identity,account.tenant_id,account.membership]);
  people['base'+n]={...account,token,bearer:require('jsonwebtoken').sign({uid:account.uid,email:account.email,password:account.password},process.env.JWTKEY,{expiresIn:'1h'})};
 }
 for(const kind of ['bearer','cookie'])for(const role of ['base0','base1']){
  const session=await request(role,kind,'/api/workspace/session');assert.equal(session.status,200,JSON.stringify(session));assert.equal(session.data.categoryKey,'base_crm');assert.equal(session.data.quickReplyCatalog,null);
  for(const key of ['inbox','whatsapp-qr','whatsapp-meta','flows','chatbot','leads','contacts','tasks'])assert.ok(session.data.roleNavigation.includes(key),key);
  for(const key of ['courses','products','finance'])assert.equal(session.data.modules[key],false);
  for(const url of ['/api/workspace/courses','/api/workspace/products-services','/api/workspace/forms','/api/workspace/finance/receipts'])assert.ok([403,409].includes((await request(role,kind,url)).status),url);
  assert.equal((await request(role,kind,'/api/workspace/phonebook/bootstrap')).status,200);
 }
 const basePipeline=await request('base0','bearer','/api/pipeline/settings');assert.equal(basePipeline.status,200,JSON.stringify(basePipeline));assert.equal(basePipeline.data.categoryKey,'base_crm');
 const baseTask=await request('base0','bearer','/api/pipeline/tasks','POST',{title:'Synthetic base task',participants:[{actorType:'identity',actorId:people.base0.identity,role:'assignee'}]});assert.equal(baseTask.status,201,JSON.stringify(baseTask));
 assert.equal((await request('base1','bearer','/api/pipeline/tasks/'+baseTask.data.id)).status,404);
 const baseState=await request('base0','cookie','/api/workspace/customization');
 const baseDocument={schemaVersion:1,navigationLabels:{inbox:{en:'Tenant A desk',ar:'مكتب النشاط أ'}}};
 assert.equal((await request('base0','cookie','/api/workspace/customization/draft','PUT',{expectedRevision:baseState.data.revision,document:baseDocument})).status,200);
 assert.equal((await request('base0','cookie','/api/workspace/customization/publish','POST',{expectedRevision:baseState.data.revision+1})).status,200);
 assert.equal((await request('base0','bearer','/api/workspace/session')).data.navigationLabels.inbox.en,'Tenant A desk');assert.equal((await request('base1','bearer','/api/workspace/session')).data.navigationLabels.inbox,undefined);
 const baseBot=await request('base0','bearer','/api/user/chatbots','POST',{name:'Synthetic base bot',engine:'guided',config:{flowId:'synthetic-base-flow'}});assert.equal(baseBot.status,201,JSON.stringify(baseBot));
 const baseFaq=await request('base0','cookie','/api/user/chatbots/faqs','POST',{questionEn:'Office opening hours',answerEn:'Tenant A only.'});assert.equal(baseFaq.status,201,JSON.stringify(baseFaq));
 assert.equal((await request('base1','bearer','/api/user/chatbots/faqs')).data.items.length,0);assert.equal((await request('base1','cookie','/api/user/chatbots')).data.items.some(bot=>bot.id===baseBot.data.id),false);
 assert.equal((await request('base1','bearer','/api/user/chatbots/'+baseBot.data.id,'PUT',{name:'Foreign edit',engine:'guided',config:{flowId:'foreign'},expectedRevision:1})).status,404);
 console.log(JSON.stringify({passed:true,migrations:require('../database/migration-runner').discover(path.join(__dirname,'../database/migrations')).length,checks:['two real Base CRM provisions, exact contracts, private admin grants, replay, same-category task/config/bot FAQ isolation and specialized API denial','shared Training and Sales tasks via actual Pipeline API: server tenant, foreign task denial and revocation','registry Pipeline actors retain real Sales permission denial and existing API adoption','exact plan/tenant category and version mismatch denial across shared and category APIs','rendered form version handshake, stale public/staff denial, original retry and exact consent attribution','per-profile form selection with real cookie/bearer APIs, previews, foreign-form denial, unavailable selection and independent profiles','current bot runtime expiry/owner/navigation checks, pre-send revocation and assigned-channel fallback suppression','pinned form fields with actual editor/public/staff APIs, permission and payload limits, archived definitions, retry and linked-lead preservation','owner-scoped legacy flow state with colliding conversation keys and the migrated owner index','owner-derived shared/training Pipeline contracts follow exact category and plan after synthetic reclassification','typed lead fields persisted through actual create/update, required validation, assigned scope, stale config and historical preservation','tenant customization with real bearer and cookie auth, published session labels, owner-only writes, CSRF and Origin checks','owner manager accountant agent bearer and real cookie auth','one Finance route for all roles and compatibility aliases','Finance screen includes receipts','manager uses owner phonebooks','same-account sharing and agent read-only scope','Inbox-only published course replies','foreign course and conversation denial','real cookie CSRF and Origin denial','Arabic ordered send with fake transport','mid-send permission revocation stops subsequent messages','inactive member denied for both session kinds','Sales catalog with both auth kinds and category-specific APIs and quick replies','Sales owner creates and manager publishes; agent reads; accountant denied','historical training courses stay separate after category changes','Manager creates expanded Agent role and assigns it','Agent writes course and manages phonebook with bearer and cookie sessions','Agent Finance read after explicit grant','Agent safe shell profile and identity','actual QR generation/list router with fake provider and self channel grant','foreign QR deletion denied','grant and sidebar revocation take effect immediately'],customerDataTouched:false,externalMessages:0}));
 }finally{if(server)await new Promise(r=>server.close(r));if(legacyPool)await legacyPool.promise().end();await pool?.end();await admin.query('DROP DATABASE IF EXISTS `'+name+'`');await admin.end();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
