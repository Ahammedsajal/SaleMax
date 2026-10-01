'use strict';
// Runs the original compiled shell and actual legacy routers/middleware against
// fresh synthetic tables. No replacement panel, .env import or provider calls.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const labPort=Number(process.env.SALEMAX_TEST_PANEL_PORT||3017);
if(![3017,3018].includes(labPort))throw new Error('SYNTHETIC_PANEL_PORT_ONLY');
const runtime = path.join(root,'database/local-runtime',labPort===3017?'existing-panel-lab':'existing-panel-lab-3018');
async function main() {
  const config={host:'127.0.0.1',port:3309,user:'root',password:''};
  const admin=await mysql.createConnection(config);
  const name='salemax_panel_lab_'+crypto.randomBytes(6).toString('hex');
  let created=false, db, child, stopping=false;
  async function stop() {
    if(stopping)return;stopping=true;
    if(child && child.exitCode===null) {child.kill();await new Promise(resolve=>child.once('exit',resolve));}
    if(db)await db.end();
    if(created && /^salemax_panel_lab_[a-f0-9]{12}$/.test(name))await admin.query(`DROP DATABASE \`${name}\``);
    await admin.end();
  }
  try {
    const net=require('node:net');
    await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(labPort,'127.0.0.1',()=>probe.close(resolve));});
    await admin.query(`CREATE DATABASE \`${name}\``);created=true;
    db=await mysql.createConnection({...config,database:name});
    const inventory=require('../docs/LEGACY_SCHEMA_INVENTORY.json');
    for(const table of ['admin','plan','web_public','web_private','user','orders','contact_form','beta_chats','beta_conversation','agents','agent_task','instance','beta_flows']) {
      const columns=inventory.columns.filter(column=>column.tableName===table && !(table==='instance' && column.columnName==='inactiveSince'));
      await db.query(`CREATE TABLE \`${table}\` (${columns.map(column=>`\`${column.columnName}\` ${column.columnType} ${column.nullable==='NO'?'NOT NULL':''} ${column.columnKey==='PRI'?'PRIMARY KEY':''} ${column.extra==='auto_increment'?'AUTO_INCREMENT':''} ${column.columnName==='createdAt'?'DEFAULT CURRENT_TIMESTAMP':''}`).join(',')})`);
    }
    await require('../database/migration-runner').applyMigrations(db,require('../database/migration-runner').discover(path.join(root,'database/migrations')));
    const [businessUser]=await db.query("INSERT INTO user(role,uid,name,email,timezone) VALUES ('user','synthetic-business','Synthetic Training Centre','business@example.invalid','Asia/Qatar')");
    const password=crypto.randomBytes(18).toString('base64url');
    const passwordHash=await bcrypt.hash(password,12),legacyUid=crypto.randomUUID(),identityId=crypto.randomUUID();
    const [legacyAdmin]=await db.query("INSERT INTO admin(email,password,uid,role) VALUES (?,?,?,'admin')",['panel@example.invalid',passwordHash,legacyUid]);
    await db.query("INSERT INTO sx_identities(id,email_normalized,display_name,password_hash,status) VALUES (?,?,'Synthetic owner',?,'active')",[identityId,'panel@example.invalid',passwordHash]);
    await db.query("INSERT INTO sx_platform_memberships(identity_id,role) VALUES (?,'super_admin')",[identityId]);
    await db.query('INSERT INTO sx_legacy_admin_identities(legacy_admin_id,legacy_uid,legacy_uid_hash,identity_id,verified_by,verified_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))',[legacyAdmin.insertId,legacyUid,crypto.createHash('sha256').update(legacyUid).digest('hex'),identityId,identityId]);
    const legacyPlans=require('../modules/platform/legacy-plan-editor'),planHandlers=legacyPlans.createHandlers(async(sql,args)=>{const [rows]=await db.query(sql,args);return rows;});
    let savedPlan;await planHandlers.add({body:{title:'Synthetic Training plan',short_description:'Browser test only',price:'250',plan_duration_in_days:'30',contact_limit:'100',qr_account:'2',is_trial:'0',allow_tag:'1',allow_note:'1',allow_chatbot:'1',allow_api:'0',wa_warmer:'0',rest_api_qr:'0'}},{json:result=>{savedPlan=result;}});
    if(!savedPlan?.success)throw new Error('SYNTHETIC_PLAN_FIXTURE_FAILED');
    const [[legacyPlan]]=await db.query('SELECT * FROM plan LIMIT 1');
    const tenantId=crypto.randomUUID(),membershipId=crypto.randomUUID();
    await db.query("INSERT INTO sx_tenants(id,slug,name,category_key,category_version,status) VALUES (?,?,'Synthetic Training Centre','training_center',1,'active')",[tenantId,'panel-'+crypto.randomUUID()]);
    await db.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role) VALUES (?,?,?,'owner')",[membershipId,tenantId,identityId]);
    const expires=Date.now()+30*86400000,snapshot=JSON.stringify(legacyPlan);
    await db.query('UPDATE user SET plan=?,plan_expire=? WHERE id=?',[snapshot,expires,businessUser.insertId]);
    await db.query("INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,legacy_uid_hash,verified_at) VALUES ('user',?,?,?,?,UTC_TIMESTAMP(3))",[String(businessUser.insertId),tenantId,membershipId,crypto.createHash('sha256').update('synthetic-business').digest('hex')]);
    const bridge=require('../modules/platform/catalogue-bridge'),platform={audience:'platform',identity:{id:identityId},membership:{role:'super_admin',status:'active'},mfaVerified:true,recentlyAuthenticated:true};
    const draft=await bridge.createDraft(db,platform,{legacyPlanId:legacyPlan.id,requestId:crypto.randomUUID(),categoryKey:'training_center',categoryVersion:1,capabilities:['messaging.inbox','team.members','training.courses'],roleLimits:{owner:1,accountant:1,manager:1,agent:7}});
    await bridge.publish(db,platform,{legacyPlanId:legacyPlan.id,versionId:draft.id,revision:draft.revision});
    const [unlinkedUser]=await db.query("INSERT INTO user(role,uid,name,email,timezone,plan,plan_expire) VALUES ('user',?,?,?,?,?,?)",['synthetic-unlinked-'+crypto.randomUUID(),'Synthetic Provisioning Candidate','provisioning-candidate@example.invalid','Asia/Qatar',snapshot,expires]);
    await db.query("INSERT INTO web_public(app_name,logo,currency_code,currency_symbol,rtl,login_header_footer,google_login_active,fb_login_active,is_custom_home) VALUES ('SaleMaX · Synthetic test','salemax-logo.png','QAR','QAR',0,0,0,0,0)");
    await db.query('INSERT INTO web_private(id) VALUES (1)');
    fs.mkdirSync(runtime,{recursive:true});
    fs.writeFileSync(path.join(runtime,'access.json'),JSON.stringify({syntheticData:true,url:`http://127.0.0.1:${labPort}/admin/login`,email:'panel@example.invalid',password,database:name,provisioningUserId:unlinkedUser.insertId},null,2));
    // Use a minimal environment so production/local imported secrets cannot
    // flow into any imported legacy module. Only synthetic credentials exist.
    const env={SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:process.env.TEMP,TMP:process.env.TMP,
      LOCAL_ONLY_MODE:'true',CRM_INTEGRATION_ENABLED:'false',DBHOST:'127.0.0.1',DBPORT:'3309',DBUSER:'root',DBPASS:'',DBNAME:name,
      JWTKEY:crypto.randomBytes(32).toString('hex'),HOST:'127.0.0.1',PORT:String(labPort),SALEMAX_TEST_PANEL_PORT:String(labPort),SALEMAX_PLATFORM_ENABLED:'true',SALEMAX_PLATFORM_ORIGIN:`http://127.0.0.1:${labPort}`,SALEMAX_PLATFORM_KEY_BASE64:crypto.randomBytes(32).toString('base64')};
    child=spawn(process.execPath,[__filename,'--serve'],{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
    child.stdout.on('data',data=>process.stdout.write(data));child.stderr.on('data',data=>process.stderr.write(data));
    child.once('exit',code=>{if(!stopping)stop().then(()=>{if(code!==0)process.exitCode=1;});});
    process.once('SIGINT',()=>stop().then(()=>process.exit(0)));process.once('SIGTERM',()=>stop().then(()=>process.exit(0)));
  } catch(error) {await stop();throw error;}
}
function serve() {
  if(process.env.DBPORT!=='3309' || !/^salemax_panel_lab_[a-f0-9]{12}$/.test(process.env.DBNAME||'') || process.env.LOCAL_ONLY_MODE!=='true')throw new Error('SYNTHETIC_PANEL_ONLY');
  require('dotenv').config=()=>({parsed:{}});
  const express=require('express'),app=express();app.disable('x-powered-by');
  const allowed=new Set(['POST /api/admin/login','POST /api/admin/add_plan','POST /api/admin/edit_plan','POST /api/admin/update_plan','POST /api/admin/preview_user_plan','GET /api/admin/user_plan_context','GET /api/admin/get_users','GET /api/admin/get_plans','GET /api/admin/get_admin','GET /api/admin/get_social_login','GET /api/web/get_web_public','GET /api/admin/get_web_public','GET /api/web/get-one-translation','GET /api/web/get_all_lang','GET /api/web/get-all-translation-name','GET /api/web/get_theme','GET /api/admin/get_dashboard_for_user','GET /api/theme/get-theme-config']);
  app.use('/api',(req,res,next)=>{
    const key=req.method+' /api'+req.path;
    const apiPath='/api'+req.path;
    const contractRoute=/^\/api\/admin\/plan-contracts\/[1-9][0-9]*\/(versions|drafts|publish)$/.test(apiPath);
    const draftUpdateRoute=req.method==='PUT'&&/^\/api\/admin\/plan-contracts\/[1-9][0-9]*\/drafts\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(apiPath);
    const businessRoute=/^\/api\/admin\/business-contracts\/[1-9][0-9]*\/(context|preview|assign|provision-options|provision-preview|provision)$/.test(apiPath);
    const protectedAction=(req.method==='GET' && (apiPath==='/api/admin/plan-contracts/context'||apiPath==='/api/admin/platform-auth/me'||(contractRoute&&apiPath.endsWith('/versions'))||(businessRoute&&(apiPath.endsWith('/context')||apiPath.endsWith('/provision-options'))))) || (req.method==='POST' && (['/api/admin/platform-auth/login','/api/admin/platform-auth/logout','/api/admin/platform-auth/mfa/enroll','/api/admin/platform-auth/mfa/verify'].includes(apiPath)||(contractRoute&&!apiPath.endsWith('/versions'))||(businessRoute&&!apiPath.endsWith('/context')&&!apiPath.endsWith('/provision-options')))) || draftUpdateRoute;
    if(!allowed.has(key)&&!protectedAction) {console.log('Synthetic panel denied: '+key);return res.status(403).json({success:false,msg:'This action is outside the synthetic plan test.',syntheticData:true});}
    next();
  });
  require('../modules/platform/mount-existing-upgrade').mountConfiguredUpgrade(app);
  app.use(express.json({limit:'24kb'}));
  app.use('/api/admin',require('../routes/admin'));
  app.use('/api/web',require('../routes/web'));
  app.use('/api/theme',require('../routes/theme'));
  app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  app.post('/__test/shutdown',(req,res)=>{res.json({stopping:true,syntheticData:true});const server=req.app.locals.syntheticServer;server.close(()=>process.exit(0));});
  app.use(express.static(path.join(root,'client/public')));
  app.get('*',(req,res)=>res.sendFile(path.join(root,'client/public/index.html')));
  app.locals.syntheticServer=app.listen(labPort,'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${labPort}/admin/login`,originalShell:true,actualLegacyRouters:true,syntheticData:true,providerActions:false,accessFile:path.relative(root,path.join(runtime,'access.json'))})));
}
if(process.argv.includes('--serve'))serve();else main().catch(error=>{console.error(error.code||'PANEL_LAB_FAILED');process.exitCode=1;});
