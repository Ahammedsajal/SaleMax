'use strict';
// Explicitly limited to a disposable schema on a local synthetic MariaDB socket.
const mysql=require('mysql2/promise'),crypto=require('node:crypto'),assert=require('node:assert/strict'),path=require('node:path');
const uuid=()=>crypto.randomUUID(),sha=v=>crypto.createHash('sha256').update(v).digest('hex');
(async()=>{
 const socketPath=process.env.REAL_ESTATE_SYNTHETIC_SOCKET,testDb=process.env.REAL_ESTATE_SYNTHETIC_TEST_DB;
 if(process.env.REAL_ESTATE_SYNTHETIC_ONLY!=='true'||(!socketPath?.startsWith('/tmp/7network-real-estate-mysql-')&&!(testDb==='salemax-bot-lead-test-db'&&process.env.REAL_ESTATE_SYNTHETIC_PASSWORD)))throw Error('SYNTHETIC_DATABASE_REQUIRED');
 const dbConnection=socketPath?{user:'root',socketPath}:{host:'127.0.0.1',port:3306,user:'root',password:process.env.REAL_ESTATE_SYNTHETIC_PASSWORD},admin=await mysql.createConnection(dbConnection),name='re_sessions_'+crypto.randomBytes(5).toString('hex');let pool,server,legacyPool;
 try{
  await admin.query('CREATE DATABASE `'+name+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci');pool=mysql.createPool({...dbConnection,database:name,connectionLimit:12});
  const inventory=require('../docs/LEGACY_SCHEMA_INVENTORY.json');
  for(const table of ['admin','plan','web_public','web_private','user','orders','contact_form','broadcast','beta_campaign','beta_chats','beta_conversation','agents','agent_task','instance','meta_api','beta_flows','contact','phonebook']){
   const columns=inventory.columns.filter(c=>c.tableName===table&&!(table==='instance'&&c.columnName==='inactiveSince'));if(!columns.length)continue;
   await pool.query('CREATE TABLE `'+table+'` ('+columns.map(c=>'`'+c.columnName+'` '+c.columnType+' '+(c.nullable==='NO'?'NOT NULL':'')+' '+(c.columnKey==='PRI'?'PRIMARY KEY':'')+' '+(c.extra==='auto_increment'?'AUTO_INCREMENT':'')+' '+(c.columnName==='createdAt'?'DEFAULT CURRENT_TIMESTAMP':'')).join(',')+')');
  }
  const db=await pool.getConnection();try{await require('../database/migration-runner').applyMigrations(db,require('../database/migration-runner').discover(path.join(__dirname,'../database/migrations')).filter(m=>m.file!=='20261024_business_daily_report_default_time.sql'));}catch(error){const [failed]=await db.query("SELECT migration_name,error_code,statements_completed FROM salemax_schema_migrations WHERE status<>'applied'");console.error(JSON.stringify({failed}));throw error;}finally{db.release();}
  Object.assign(process.env,{DBNAME:name,DBUSER:'root',DBPASS:dbConnection.password||'',DBHOST:dbConnection.host||'localhost',DBPORT:String(dbConnection.port||3306),LOCAL_ONLY_MODE:'true',SALEMAX_TEST_DB_SOCKET:socketPath||'',JWTKEY:'synthetic-real-estate-jwt',SALEMAX_PLATFORM_ENABLED:'true',SALEMAX_PLATFORM_ORIGIN:'http://127.0.0.1'});
  const category=require('../modules/platform/categories').realEstate,tenant=uuid(),plan=uuid(),version=uuid(),people={},limits=JSON.stringify({owner:1,manager:2,team_leader:2,agent:5});
  await pool.query("INSERT INTO sx_tenants(id,name,slug,category_key,category_version,status) VALUES (?, 'Synthetic office','synthetic-office','real_estate',1,'active')",[tenant]);
  await pool.query("INSERT INTO sx_plans(id,name) VALUES (?,'Synthetic real estate')",[plan]);
  await pool.query("INSERT INTO sx_plan_versions(id,plan_id,version,category_key,category_version,status,capabilities,role_limits,published_at) VALUES (?,?,1,'real_estate',1,'published',?,?,UTC_TIMESTAMP(3))",[version,plan,JSON.stringify(category.capabilities),limits]);
  await pool.query("INSERT INTO sx_plan_assignments(id,tenant_id,plan_version_id,role_limits,status,effective_from,expires_at) VALUES (?,?,?,?,'active',DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 DAY))",[uuid(),tenant,version,limits]);
  for(const role of ['owner','manager','team_leader','agent','other_agent']){
   const seat=role==='other_agent'?'agent':role,identity=uuid(),membership=uuid(),uid='synthetic-re-'+role,email=role+'@example.invalid',password='synthetic-'+role;
   await pool.query("INSERT INTO sx_identities(id,email_normalized,display_name,password_hash,status) VALUES (?,?,?,'synthetic','active')",[identity,email,role]);
   await pool.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES (?,?,?,?,'active')",[membership,tenant,identity,seat]);
   const isAgent=seat==='agent';let result;
   if(isAgent)[result]=await pool.query("INSERT INTO agents(uid,name,email,password,owner_uid,role,is_active) VALUES (?,?,?,?,?,'agent',1)",[uid,role,email,password,'synthetic-re-owner']);
   else [result]=await pool.query("INSERT INTO user(uid,name,email,password,role) VALUES (?,?,?,?,'user')",[uid,role,email,password]);
   await pool.query('INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash,verified_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))',[isAgent?'agents':'user',String(result.insertId),tenant,membership,sha(uid)]);
   const token=crypto.randomBytes(32).toString('base64url');await pool.query("INSERT INTO sx_sessions(id,token_hash,identity_id,audience,tenant_id,membership_id,credential_version,authenticated_at,expires_at) VALUES (?,?,?,'tenant',?,?,1,UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR))",[uuid(),sha(token),identity,tenant,membership]);
   people[role]={id:result.insertId,identity,membership,token,bearer:require('jsonwebtoken').sign({uid,email,password},process.env.JWTKEY,{expiresIn:'1h'}),isAgent};
  }
  await pool.query('INSERT INTO sx_sales_org_history(id,tenant_id,membership_id,manager_membership_id,team_leader_membership_id,assigned_by_identity_id,reason) VALUES (?,?,?,?,?,?,?)',[uuid(),tenant,people.agent.membership,people.manager.membership,people.team_leader.membership,people.owner.identity,'Synthetic team']);
  const lead=uuid(),foreignLead=uuid();for(const [id,agent] of [[lead,people.agent],[foreignLead,people.other_agent]])await pool.query("INSERT INTO pipeline_leads(id,uid_hash,uid,identity_key,title,owner_agent_id) VALUES (?,?,?,?,?,?)",[id,sha('synthetic-re-owner'),'synthetic-re-owner',sha(id),'Synthetic lead',agent.id]);
  const express=require('express'),app=express(),origin='http://127.0.0.1',publicKey=crypto.randomBytes(32),auth=require('../modules/platform/auth-router').createAuthRouter({pool,key:publicKey,origin,insecureLoopback:true,allowedAudience:'tenant'});
  const guard=require('../modules/platform/business-feature-session').createBusinessFeatureSession({pool,origin,userGuard:require('../middlewares/user'),agentGuard:require('../middlewares/agent'),canonicalGuard:auth.guard,resolveBusinessContext:auth.resolveContext});legacyPool=require('../database/config');
  app.use('/api/user/business-auth',auth.router);app.use('/api/workspace/properties',require('../modules/platform/real-estate-properties-router').createRouter({pool,authenticate:guard.guard}));
  app.use('/api/public/real-estate/agents',require('../modules/platform/real-estate-agents').publicProfileRouter({pool,key:publicKey}));
  app.use('/api/pipeline',express.json(),require('../routes/pipeline'));
  app.use((error,req,res,next)=>{if(!res.headersSent)res.status(error.status||503).json({success:false,code:error.code||'UNAVAILABLE'});});
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=origin+':'+server.address().port;
  async function request(role,kind,url,method='GET',body){const person=people[role],headers={Origin:origin,'Content-Type':'application/json'};if(kind==='bearer'){headers.Authorization='Bearer '+person.bearer;if(person.isAgent)headers['X-Salemax-Actor']='agent';}else{headers.Cookie='salemax_dev_session='+person.token;if(method!=='GET'){const me=await fetch(base+'/api/user/business-auth/me',{headers:{Cookie:headers.Cookie}});headers['X-CSRF-Token']=(await me.json()).csrfToken;}}const res=await fetch(base+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,...await res.json()};}
  const [[leaderUser]]=await pool.query('SELECT * FROM user WHERE id=?',[people.team_leader.id]);const leaderContext=await require('../modules/platform/business-feature-session').legacyContext(pool,leaderUser,false);const pipelineActor=await require('../modules/platform/legacy-pipeline-actor').resolve(pool,leaderUser);assert.deepEqual(pipelineActor.scopeAgentIds,[people.agent.id]);const checkDb=await pool.getConnection();try{await require('../modules/platform/real-estate-tenant-requirements').get(checkDb,{context:leaderContext,ownerUid:'synthetic-re-owner'},lead);}finally{checkDb.release();}
  const url='/api/workspace/properties/leads/'+lead+'/requirement',foreign='/api/workspace/properties/leads/'+foreignLead+'/requirement';
  for(const kind of ['bearer','cookie']){
   for(const role of ['owner','manager','team_leader','agent']){const result=await request(role,kind,url);assert.equal(result.status,200,JSON.stringify({role,kind,result}));}
   for(const role of ['team_leader','agent']){const result=await request(role,kind,foreign);assert.equal(result.status,404,JSON.stringify({role,kind,result}));}
  }
  const saved=await request('agent','bearer',url,'PUT',{areas:['Lusail'],expectedRevision:0});assert.equal(saved.status,200,JSON.stringify(saved));
  const visible=await request('team_leader','cookie',url);assert.deepEqual(visible.data.areas,['Lusail']);
  const other=await request('other_agent','bearer',url);assert.equal(other.status,404,JSON.stringify(other));
  for(const role of ['owner','manager','team_leader','agent']){const result=await request(role,'bearer','/api/pipeline/leads/'+lead);assert.equal(result.status,200,JSON.stringify({role,result}));}
  for(const role of ['team_leader','agent']){const result=await request(role,'bearer','/api/pipeline/leads/'+foreignLead);assert.ok([403,404].includes(result.status),JSON.stringify({role,result}));}
  const unitResponse=await request('owner','bearer','/api/workspace/properties/units','POST',{name:'Synthetic unit',propertyType:'villa',area:'Lusail',bedrooms:2});assert.equal(unitResponse.status,201,JSON.stringify(unitResponse));const unitId=unitResponse.data.id;
  const listingResponse=await request('owner','cookie','/api/workspace/properties/listings','POST',{unitId,priceMinor:600000,minimumTermMonths:12});assert.equal(listingResponse.status,201,JSON.stringify(listingResponse));const listingId=listingResponse.data.id;
  const listingBase='/api/workspace/properties/listings/'+listingId+'/coagents/'+people.agent.membership;
  assert.equal((await request('agent','bearer','/api/workspace/properties/units/'+unitId)).status,404);
  assert.equal((await request('agent','bearer',listingBase,'PUT',{})).status,403);
  const added=await request('owner','cookie',listingBase,'PUT',{});assert.equal(added.status,200,JSON.stringify(added));
  // The count is defined over active listing records; seed that state directly
  // in this disposable fixture while authority activation is covered elsewhere.
  await pool.query("UPDATE sx_real_estate_properties SET status='active' WHERE tenant_id=? AND id=?",[tenant,listingId]);
  for(const kind of ['bearer','cookie']){
   assert.equal((await request('agent',kind,'/api/workspace/properties/units/'+unitId)).status,200);
   assert.equal((await request('other_agent',kind,'/api/workspace/properties/units/'+unitId)).status,404);
   assert.equal((await request('team_leader',kind,'/api/workspace/properties/units/'+unitId)).status,200);
  }
  const profileUrl='/api/workspace/properties/agents/'+people.agent.membership+'/profile',rulesUrl='/api/workspace/properties/agents/'+people.agent.membership+'/commission-rules';
  const profile=await request('owner','bearer',profileUrl,'PUT',{workingAreas:['Lusail'],languages:['English'],seniority:'senior',publicEnabled:true,publicBioEn:'Synthetic public profile',expectedRevision:0});assert.equal(profile.status,200,JSON.stringify(profile));
  const publicResponse=await fetch(base+'/api/public/real-estate/agents/synthetic-office/'+people.agent.membership,{headers:{Accept:'application/json'}}),publicData=await publicResponse.json();assert.equal(publicResponse.status,200,JSON.stringify(publicData));assert.deepEqual(Object.keys(publicData.data).sort(),['activeListingCount','bioAr','bioEn','businessName','languages','name','seniority','workingAreas'].sort());assert.equal(publicData.data.activeListingCount,1);assert.equal(publicData.data.bioEn,'Synthetic public profile');assert.equal(publicResponse.headers.get('cache-control'),'no-store, max-age=0');
  const rule=await request('owner','cookie',rulesUrl,'POST',{basis:'first_month_percent',value:5000,reason:'Synthetic agreement'});assert.equal(rule.status,201,JSON.stringify(rule));
  for(const kind of ['bearer','cookie']){
   for(const role of ['owner','manager','team_leader','agent']){const result=await request(role,kind,rulesUrl);assert.equal(result.status,200,JSON.stringify({role,kind,result}));assert.equal(result.data.items.length,1);}
   const ownRules=await request('agent',kind,'/api/workspace/properties/agents/me/commission-rules');assert.equal(ownRules.status,200,JSON.stringify(ownRules));assert.equal(ownRules.data.items.length,1);
   const ownProfile=await request('agent',kind,'/api/workspace/properties/agents/me/profile');assert.equal(ownProfile.status,200,JSON.stringify(ownProfile));assert.deepEqual(ownProfile.data.languages,['English']);
   assert.equal((await request('other_agent',kind,rulesUrl)).status,404);
   assert.equal((await request('agent',kind,rulesUrl,'POST',{basis:'fixed_qar',value:100,reason:'Unauthorized'})).status,403);
   assert.equal((await request('agent',kind,'/api/workspace/properties/agreements')).status,403);
  }
  assert.equal((await request('owner','bearer',listingBase,'DELETE')).status,200);
  assert.equal((await request('agent','bearer','/api/workspace/properties/units/'+unitId)).status,404);
  console.log('Real authentication: role-scoped requirements, co-agents, profiles, commission visibility and agreement denial passed for cookie and bearer sessions.');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));if(legacyPool)await new Promise(resolve=>legacyPool.end(resolve));if(pool)await pool.end();await admin.query('DROP DATABASE IF EXISTS `'+name+'`');await admin.end();}
})().catch(error=>{console.error(error);process.exitCode=1;});
