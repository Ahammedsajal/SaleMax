// Isolated synthetic authentication laboratory. Never reads .env/customer data.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const mysql=require('mysql2/promise');
const bcrypt=require('bcrypt');
const express=require('express');
const {discover,applyMigrations}=require('../database/migration-runner');
const {createAuthRouter}=require('../modules/platform/auth-router');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'database/local-runtime/auth-lab');
async function main(){
  const port=Number(process.env.AUTH_LAB_DB_PORT||3309),httpPort=Number(process.env.AUTH_LAB_HTTP_PORT||3016);
  if(port!==3309||httpPort!==3016)throw new Error('AUTH_LAB_PORTS_ONLY');
  const config={host:'127.0.0.1',port,user:'root',password:''},admin=await mysql.createConnection(config),name='salemax_auth_lab_'+crypto.randomBytes(6).toString('hex');
  let pool,server,created=false,stopping=false;
  async function stop(){if(stopping)return;stopping=true;if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.end();if(created&&/^salemax_auth_lab_[a-f0-9]{12}$/.test(name))await admin.query(`DROP DATABASE \`${name}\``);await admin.end();}
  try{
    await admin.query(`CREATE DATABASE \`${name}\``);created=true;pool=mysql.createPool({...config,database:name});
    const db=await pool.getConnection();try{
      await db.query('CREATE TABLE instance (id INT PRIMARY KEY,status VARCHAR(20))');await applyMigrations(db,discover(path.join(root,'database/migrations')));
      const tenant=crypto.randomUUID(),owner=crypto.randomUUID(),platform=crypto.randomUUID(),password=crypto.randomBytes(18).toString('base64url'),hash=await bcrypt.hash(password,12);
      await db.query("INSERT INTO sx_tenants(id,slug,name,category_key,category_version,status) VALUES (?,'training-lab','Doha Skills · Test','training_center',1,'active')",[tenant]);
      for(const [id,email,name]of [[owner,'owner@example.invalid','Test business owner'],[platform,'platform@example.invalid','Test platform owner']])await db.query("INSERT INTO sx_identities(id,email_normalized,display_name,status,password_hash) VALUES (?,?,?,'active',?)",[id,email,name,hash]);
      await db.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role) VALUES (?,?,?,'owner')",[crypto.randomUUID(),tenant,owner]);await db.query("INSERT INTO sx_platform_memberships(identity_id,role) VALUES (?,'super_admin')",[platform]);
      fs.mkdirSync(runtime,{recursive:true});fs.writeFileSync(path.join(runtime,'access.json'),JSON.stringify({syntheticData:true,workspace:'training-lab',ownerEmail:'owner@example.invalid',platformEmail:'platform@example.invalid',password},null,2));
    }finally{db.release();}
    const app=express(),origin='http://127.0.0.1:'+httpPort,boundary=createAuthRouter({pool,key:crypto.randomBytes(32),origin,insecureLoopback:true});app.disable('x-powered-by');
    app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");next();});
    app.get('/api/lab/status',(req,res)=>res.json({syntheticData:true,productionActions:false}));app.use('/api/v1/auth',boundary.router);
    app.get('/',(req,res)=>res.sendFile(path.join(root,'client/.preview-build/signin.html')));app.use(express.static(path.join(root,'client/.preview-build')));
    server=app.listen(httpPort,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
    console.log(JSON.stringify({url:origin,syntheticData:true,accessFile:'database/local-runtime/auth-lab/access.json'}));
    process.once('SIGINT',()=>stop().then(()=>process.exit(0)));process.once('SIGTERM',()=>stop().then(()=>process.exit(0)));
  }catch(error){await stop();throw error;}
}
main().catch(error=>{console.error(error.code||'AUTH_LAB_FAILED');process.exitCode=1;});
