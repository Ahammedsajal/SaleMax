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
const runtime = path.join(root,'database/local-runtime/existing-panel-lab');
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
    await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(3017,'127.0.0.1',()=>probe.close(resolve));});
    await admin.query(`CREATE DATABASE \`${name}\``);created=true;
    db=await mysql.createConnection({...config,database:name});
    const inventory=require('../docs/LEGACY_SCHEMA_INVENTORY.json');
    for(const table of ['admin','plan','web_public','web_private','user','orders','contact_form','beta_chats','beta_conversation','agents','agent_task','instance','beta_flows']) {
      const columns=inventory.columns.filter(column=>column.tableName===table && !(table==='instance' && column.columnName==='inactiveSince'));
      await db.query(`CREATE TABLE \`${table}\` (${columns.map(column=>`\`${column.columnName}\` ${column.columnType} ${column.nullable==='NO'?'NOT NULL':''} ${column.columnKey==='PRI'?'PRIMARY KEY':''} ${column.extra==='auto_increment'?'AUTO_INCREMENT':''} ${column.columnName==='createdAt'?'DEFAULT CURRENT_TIMESTAMP':''}`).join(',')})`);
    }
    await require('../database/migration-runner').applyMigrations(db,require('../database/migration-runner').discover(path.join(root,'database/migrations')));
    await db.query("INSERT INTO user(role,uid,name,email,timezone) VALUES ('user','synthetic-business','Synthetic Training Centre','business@example.invalid','Asia/Qatar')");
    const password=crypto.randomBytes(18).toString('base64url');
    await db.query("INSERT INTO admin(email,password,uid,role) VALUES (?,?,?,'admin')",['panel@example.invalid',await bcrypt.hash(password,12),crypto.randomUUID()]);
    await db.query("INSERT INTO web_public(app_name,logo,currency_code,currency_symbol,rtl,login_header_footer,google_login_active,fb_login_active,is_custom_home) VALUES ('SaleMaX · Synthetic test','salemax-logo.png','QAR','QAR',0,0,0,0,0)");
    await db.query('INSERT INTO web_private(id) VALUES (1)');
    fs.mkdirSync(runtime,{recursive:true});
    fs.writeFileSync(path.join(runtime,'access.json'),JSON.stringify({syntheticData:true,url:'http://127.0.0.1:3017/admin/login',email:'panel@example.invalid',password,database:name},null,2));
    // Use a minimal environment so production/local imported secrets cannot
    // flow into any imported legacy module. Only synthetic credentials exist.
    const env={SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:process.env.TEMP,TMP:process.env.TMP,
      LOCAL_ONLY_MODE:'true',CRM_INTEGRATION_ENABLED:'false',DBHOST:'127.0.0.1',DBPORT:'3309',DBUSER:'root',DBPASS:'',DBNAME:name,
      JWTKEY:crypto.randomBytes(32).toString('hex'),HOST:'127.0.0.1',PORT:'3017'};
    child=spawn(process.execPath,[__filename,'--serve'],{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
    child.stdout.on('data',data=>process.stdout.write(data));child.stderr.on('data',data=>process.stderr.write(data));
    child.once('exit',()=>{if(!stopping)stop().then(()=>{process.exitCode=1;});});
    process.once('SIGINT',()=>stop().then(()=>process.exit(0)));process.once('SIGTERM',()=>stop().then(()=>process.exit(0)));
  } catch(error) {await stop();throw error;}
}
function serve() {
  if(process.env.DBPORT!=='3309' || !/^salemax_panel_lab_[a-f0-9]{12}$/.test(process.env.DBNAME||'') || process.env.LOCAL_ONLY_MODE!=='true')throw new Error('SYNTHETIC_PANEL_ONLY');
  require('dotenv').config=()=>({parsed:{}});
  const express=require('express'),app=express();app.disable('x-powered-by');app.use(express.json({limit:'24kb'}));
  const allowed=new Set(['POST /api/admin/login','POST /api/admin/add_plan','POST /api/admin/edit_plan','POST /api/admin/update_plan','POST /api/admin/preview_user_plan','GET /api/admin/user_plan_context','GET /api/admin/get_users','GET /api/admin/get_plans','GET /api/admin/get_admin','GET /api/web/get_web_public','GET /api/admin/get_web_public','GET /api/web/get-one-translation','GET /api/web/get_all_lang','GET /api/web/get-all-translation-name','GET /api/web/get_theme','GET /api/admin/get_dashboard_for_user','GET /api/theme/get-theme-config']);
  app.use('/api',(req,res,next)=>{
    const key=req.method+' /api'+req.path;
    if(!allowed.has(key)) {console.log('Synthetic panel denied: '+key);return res.status(403).json({success:false,msg:'This action is outside the synthetic plan test.',syntheticData:true});}
    next();
  });
  app.use('/api/admin',require('../routes/admin'));
  app.use('/api/web',require('../routes/web'));
  app.use('/api/theme',require('../routes/theme'));
  app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  app.use(express.static(path.join(root,'client/public')));
  app.get('*',(req,res)=>res.sendFile(path.join(root,'client/public/index.html')));
  app.listen(3017,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:3017/admin/login',originalShell:true,actualLegacyRouters:true,syntheticData:true,providerActions:false,accessFile:'database/local-runtime/existing-panel-lab/access.json'})));
}
if(process.argv.includes('--serve'))serve();else main().catch(error=>{console.error(error.code||'PANEL_LAB_FAILED');process.exitCode=1;});
