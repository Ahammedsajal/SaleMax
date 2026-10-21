'use strict';
// Called only inside the disposable shared-auth integration schema.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),express=require('express');
module.exports=async(pool,operatorIdentity)=>{
 const category=require('../modules/platform/categories').baseCrm,editor=require('../modules/platform/legacy-plan-editor'),bridge=require('../modules/platform/catalogue-bridge');
 const terms=editor.normalize({title:'Synthetic base CRM',short_description:'Disposable shared CRM plan',price:100,plan_duration_in_days:30,contact_limit:100,qr_account:1,allow_chatbot:1,allow_api:1}).value;
 const [plan]=await pool.query('INSERT INTO plan ('+editor.columns.join(',')+') VALUES ('+editor.columns.map(()=>'?').join(',')+')',editor.columns.map(key=>terms[key]));
 const adminUid='synthetic-base-admin',adminId=2147480001;
 await pool.query("INSERT INTO sx_legacy_admin_identities(legacy_admin_id,legacy_uid,legacy_uid_hash,identity_id,verified_by,verified_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))",[adminId,adminUid,crypto.createHash('sha256').update(adminUid).digest('hex'),operatorIdentity,operatorIdentity]);
 const admin={audience:'platform',identity:{id:operatorIdentity},membership:{role:'super_admin',status:'active'},mfaVerified:true,recentlyAuthenticated:true};let context=admin;
 const roleLimits={owner:1,accountant:1,manager:2,agent:5};
 const db=await pool.getConnection();let draft;try{draft=await bridge.createDraft(db,admin,{legacyPlanId:plan.insertId,categoryKey:category.key,categoryVersion:1,capabilities:category.capabilities,roleLimits,requestId:crypto.randomUUID()});await bridge.publish(db,admin,{legacyPlanId:plan.insertId,versionId:draft.id,revision:1});}finally{db.release();}
 const app=express();app.use('/business',require('../modules/platform/existing-business-router').createExistingBusinessRouter({pool,legacyGuard:(req,res,next)=>{req.legacyAdminId=adminId;req.decode={uid:adminUid};next();},canonicalGuard:(req,res,next)=>{req.businessContext=context;next();}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const request=async(url,body)=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/business/'+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,...await response.json()};};
 const accounts=[];
 try{for(let n=0;n<2;n++){
  const uid='synthetic-base-owner-'+n,email=uid+'@example.invalid',password='synthetic-base-password';
  const [user]=await pool.query("INSERT INTO user(uid,name,email,password,role,plan,plan_expire,timezone) VALUES (?,?,?,?,'user',?,?,'Asia/Qatar')",[uid,'Synthetic base '+n,email,password,JSON.stringify({id:plan.insertId,...terms}),String(Date.now()+86400000)]);
  const id=user.insertId;
  await pool.query("INSERT INTO sx_platform_user_portfolios(legacy_user_id,managed_by_identity_id,created_by_identity_id,source) VALUES (?,?,?,'super_admin_assigned')",[id,operatorIdentity,operatorIdentity]);
  const available=await request(id+'/context');assert.equal(available.status,200);assert.equal(available.data.linked,false);assert.ok(available.data.categories.some(c=>c.key==='base_crm'&&c.version===1));
  context={...admin,membership:{role:'staff',status:'active',delegatedPermissions:['plans.read','plans.assign','tenants.create']}};
  assert.equal((await request(id+'/context')).data.categories.some(c=>c.key==='base_crm'),false);
  assert.equal((await request(id+'/provision-options?categoryKey=base_crm&categoryVersion=1')).status,403);context=admin;
  const options=await request(id+'/provision-options?categoryKey=base_crm&categoryVersion=1');assert.equal(options.status,200,JSON.stringify(options));assert.deepEqual(options.data.category.seatRoles,category.seatRoles);
  assert.equal((await request(id+'/provision-options?categoryKey=base_crm&categoryVersion=2')).status,400);
  const input={categoryKey:'base_crm',categoryVersion:1,planVersionId:draft.id,roleLimits,businessName:'Synthetic base '+n,requestId:crypto.randomUUID()};
  const preview=await request(id+'/provision-preview',input);assert.equal(preview.status,200,JSON.stringify(preview));assert.equal(preview.data.canProvision,true);
  const confirmed=await request(id+'/provision',{...input,expectedState:preview.data.expectedState});assert.equal(confirmed.status,201,JSON.stringify(confirmed));
  const replay=await request(id+'/provision',{...input,expectedState:preview.data.expectedState});assert.equal(replay.status,201);assert.equal(replay.data.replayed,true);assert.equal(replay.data.tenantId,confirmed.data.tenantId);
  const linked=await request(id+'/context');assert.equal(linked.status,200);assert.equal(linked.data.category.key,'base_crm');assert.equal(linked.data.versions.length,1);
  context={...admin,membership:{role:'staff',status:'active',delegatedPermissions:['plans.read']}};assert.equal((await request(id+'/context')).status,403);context=admin;
  const [[owner]]=await pool.query("SELECT o.tenant_id,m.id AS membership,m.identity_id AS identity FROM sx_legacy_ownership o JOIN sx_memberships m ON m.id=o.membership_id WHERE o.source_table='user' AND o.source_id=?",[String(id)]);
  accounts.push({id,uid,email,password,...owner});
 }
 return accounts;
 }finally{await new Promise(r=>server.close(r));}
};
