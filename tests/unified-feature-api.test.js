'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),express=require('express');
const {trainingCenter}=require('../modules/platform/categories');
const {decision}=require('../modules/platform/policy');
const shared=require('../modules/platform/business-feature-session');
const tenant='11111111-1111-4111-8111-111111111111';
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
function context(role,extra={}){return {audience:'tenant',identity:{id:'identity-'+role},tenant:{id:tenant,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'member-'+role,tenantId:tenant,role,status:'active',delegatedPermissions:[],...extra},category:trainingCenter,subscription:{status:'active',capabilities:trainingCenter.capabilities}};}
function fixture(role='manager'){
 const actor={id:2,uid:role+'-uid',email:role+'@example.invalid',password:'synthetic',owner_uid:'owner-uid',is_active:1},owner={id:1,uid:'owner-uid',role:'user',password:'synthetic'};
 let member={tenantId:tenant,tenantStatus:'active',categoryKey:'training_center',categoryVersion:1,membershipId:'member-'+role,identityId:'identity-'+role,role,membershipStatus:'active',identityStatus:'active',uidHash:sha(actor.uid),delegatedPermissions:'[]',assignedNavigation:role==='agent'?'["inbox","contacts"]':'["invoices","inbox","contacts"]',roleProfileId:null};
 const query=async(sql,args)=>{
  if(sql.includes('SELECT u.uid,m.id AS membershipId'))return [[{uid:owner.uid,uidHash:sha(owner.uid),membershipId:'owner-member',identityId:'owner-identity'}]];
  if(sql.includes('o.legacy_uid_hash AS uidHash'))return [[member]];
  if(sql.includes('FROM sx_plan_assignments'))return [[{id:'assignment',status:'active',current_period:1,role_limits:JSON.stringify({owner:1,accountant:2,manager:2,agent:10}),capabilities:JSON.stringify(trainingCenter.capabilities),category_key:'training_center',category_version:1}]];
  if(sql.includes('sx_tenant_customization_heads'))return [[null]];
  if(sql.includes('SELECT u.uid,o.legacy_uid_hash'))return [[{uid:owner.uid,legacy_uid_hash:sha(owner.uid)}]];
  if(sql.includes('SELECT * FROM user WHERE uid='))return [[owner]];
  if(sql.includes('SELECT source_table,source_id'))return [[{source_table:role==='agent'?'agents':'user',source_id:'2',legacy_uid_hash:sha(actor.uid)}]];
  if(sql.includes('SELECT * FROM user WHERE id=')||sql.includes('SELECT * FROM agents WHERE id='))return [[actor]];
  if(sql.includes('sx_qr_channel_shares'))return [[]];
  throw Error('Unexpected synthetic query: '+sql);
 };
 const db={query,release(){}},pool={query,getConnection:async()=>db};
 return {pool,actor,owner,get member(){return member;},set member(value){member=value;}};
}
test('Finance screen assignment enables receipt/payment views while role and action denials remain enforced',()=>{
 for(const role of ['owner','manager','accountant']){
  const c=context(role,{assignedNavigation:['invoices']});
  assert.equal(decision(c,{capability:'finance.receipts',permission:'receipts.read'}).allowed,true);
  assert.equal(decision(c,{capability:'finance.payments',permission:'payments.verify'}).allowed,true);
 }
 assert.equal(decision(context('agent',{assignedNavigation:['invoices']}),{capability:'finance.payments',permission:'payments.verify'}).allowed,false);
 assert.equal(decision(context('manager',{assignedNavigation:['inbox']}),{capability:'finance.receipts',permission:'receipts.read'}).allowed,false);
 assert.equal(decision(context('manager',{assignedNavigation:['invoices'],customPermissions:['invoices.read']}),{capability:'finance.payments',permission:'payments.verify'}).allowed,false);
});
test('legacy and cookie sessions normalize to the same tenant/member without borrowing owner permissions',async()=>{
 const f=fixture();
 const legacy=await shared.resolve(f.pool,{actor:f.actor});
 const cookie=await shared.resolve(f.pool,{context:context('manager',{assignedNavigation:['invoices','inbox','contacts']}),refreshContext:async()=>null});
 for(const session of [legacy,cookie]){assert.equal(session.ownerUid,'owner-uid');assert.equal(session.actor.uid,'manager-uid');assert.equal(session.context.identity.id,'identity-manager');assert.equal(session.context.membership.role,'manager');}
 f.member={...f.member,membershipStatus:'revoked'};
 await assert.rejects(legacy.refresh(),{code:'ACCOUNT_INACTIVE'});
 await assert.rejects(cookie.refresh(),{code:'AUTH_REQUIRED'});
});
test('Inbox-only staff can use published course replies with assignment scope and live permission rechecks',async()=>{
 const f=fixture('agent'),service=require('../modules/platform/course-quick-replies');
 const session=await shared.resolve(f.pool,{actor:f.actor,agent:true,owner:f.owner});
 const c=await service.sessionContext(f.pool,session);
 assert.equal(c.scope.uid,'owner-uid');assert.equal(c.scope.identityId,'identity-agent');assert.equal(c.scope.assignedOnly,true);
 const assigned={origin:'qr',chat_id:'chat',assigned_agent:JSON.stringify([{kind:'identity',identityId:'identity-agent'}])};
 await assert.doesNotReject(service.conversation({...c,query:async()=>[assigned]},'chat'));
 await assert.rejects(service.conversation({...c,query:async()=>[{...assigned,assigned_agent:'[]'}]},'chat'),{code:'PERMISSION_DENIED'});
 f.member={...f.member,assignedNavigation:'["contacts"]'};
 await assert.rejects(c.refresh(),{code:'PERMISSION_DENIED'});
});
test('Phonebook normalizes owner scope and respects shared read-only recipients and custom roles',async()=>{
 const service=require('../modules/platform/phonebook-workspace'),f=fixture('manager');
 const session=await shared.resolve(f.pool,{actor:f.actor}),c=await service.sessionContext({},session);
 assert.equal(c.uid,'owner-uid');assert.equal(c.manage,true);
 const readOnly=await service.sessionContext({}, {...session,context:context('agent',{assignedNavigation:['contacts']})});
 assert.equal(readOnly.manage,false);assert.match(service.visibility(readOnly).sql,/sx_phonebook_shares/);
 await assert.rejects(service.move({},readOnly,{ids:[1],bookId:2}),{code:'READ_ONLY_SHARE'});
});
test('one Finance handler serves shared and old role-prefixed URLs for both credential types',async t=>{
 const f=fixture(),generator=require('../modules/platform/invoice-generator');
 t.mock.method(generator,'getSettings',async(db,c)=>{generator.requireRole(c);return {tenantId:c.tenant.id,role:c.membership.role,identityId:c.identity.id};});
 const legacyGuard=(req,res,next)=>{if(req.get('Authorization')!=='Bearer synthetic-manager')return res.status(401).json({success:false,code:'AUTH_REQUIRED'});req.decode={uid:f.actor.uid,userData:f.actor};next();};
 const canonicalGuard=(req,res,next)=>{if(req.get('Cookie')!=='synthetic=cookie')return res.status(401).json({success:false,code:'AUTH_REQUIRED'});if(req.method!=='GET'&&req.get('X-CSRF-Token')!=='synthetic-csrf')return res.status(403).json({success:false,code:'CSRF_DENIED'});req.businessContext=context('manager',{assignedNavigation:['invoices']});next();};
 const session=shared.createBusinessFeatureSession({pool:f.pool,origin:'http://localhost',userGuard:legacyGuard,agentGuard:legacyGuard,canonicalGuard,resolveBusinessContext:async()=>context('manager')});
 const router=require('../modules/platform/training-finance-router').createTrainingFinanceRouter({pool:f.pool,origin:'http://localhost',sessionGuard:session.guard});
 const registered=router.stack.filter(layer=>layer.route).map(layer=>Object.keys(layer.route.methods).join(',')+' '+layer.route.path);
 assert.equal(new Set(registered).size,registered.length,'Every action must be registered once');
 const app=express();app.use(['/api/workspace/finance','/api/user/training/finance-policies'],router);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 for(const path of ['/api/workspace/finance/generator/settings','/api/user/training/finance-policies/generator/settings','/api/user/training/finance-policies/accountant/generator/settings'])for(const headers of [{Authorization:'Bearer synthetic-manager'},{Cookie:'synthetic=cookie'}]){
  const response=await fetch(base+path,{headers}),body=await response.json();assert.equal(response.status,200);assert.deepEqual(body.data,{tenantId:tenant,role:'manager',identityId:'identity-manager'});
 }
 assert.equal((await fetch(base+'/api/workspace/finance/generator/settings')).status,401);
 assert.equal((await fetch(base+'/api/workspace/finance/generator/settings',{method:'PUT',headers:{Cookie:'synthetic=cookie',Origin:'http://localhost','Content-Type':'application/json'},body:'{}'})).status,403);
});
