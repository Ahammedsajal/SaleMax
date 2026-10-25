'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),crypto=require('node:crypto');
const {createBusinessFeatureSession}=require('../modules/platform/business-feature-session');
const {createTaskRouter}=require('../modules/platform/task-router');
const {createTaskContext}=require('../modules/platform/training-task-context');
const {trainingCenter}=require('../modules/platform/categories');
const tenantId='11111111-1111-4111-8111-111111111111';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
test('existing Task handlers accept the panel Agent session and enforce current scope, grants and origin',async t=>{
  let grants=['tasks.read','tasks.manage'],active=true;const seen=[];
  const actor={id:7,uid:'agent-uid',owner_uid:'owner-uid',password:'synthetic',is_active:1},owner={id:1,uid:'owner-uid',role:'user'};
  const query=async(sql,args)=>{
    if(sql.startsWith('SELECT revision,active_id FROM sx_tenant_customization_heads'))return [[]];
    if(sql.includes('SELECT u.uid,o.legacy_uid_hash'))return [[{uid:owner.uid,uidHash:hash(owner.uid),legacy_uid_hash:hash(owner.uid)}]];
    if(sql.includes('SELECT u.uid,m.id AS membershipId'))return [[{uid:owner.uid,uidHash:hash(owner.uid),membershipId:'owner-member',identityId:'owner-identity'}]];
    if(sql.includes('o.legacy_uid_hash AS uidHash'))return [[{uidHash:hash(actor.uid),tenantId,tenantStatus:'active',categoryKey:'training_center',categoryVersion:1,membershipId:'member',identityId:'identity-agent',role:'agent',membershipStatus:active?'active':'revoked',identityStatus:'active',delegatedPermissions:'[]',assignedNavigation:null,roleProfileId:'profile',rolePermissions:JSON.stringify(grants),seatRole:'agent',roleStatus:'active'}]];
    if(sql.includes('FROM sx_plan_assignments'))return [[{id:'assignment',status:'active',current_period:1,role_limits:JSON.stringify({owner:1,accountant:2,manager:2,agent:10}),capabilities:JSON.stringify(trainingCenter.capabilities),category_key:'training_center',category_version:1}]];
    if(sql.includes('FROM sx_legacy_ownership o JOIN agents a'))return [[{id:7}]];
    if(sql.startsWith('SELECT id,COALESCE'))return [[{id:7,label:'Agent'}]];
    if(sql.startsWith('SELECT m.identity_id'))return [[{actorId:'owner-identity',role:'owner',label:'Main User'}]];
    if(sql.includes('SELECT t.id,t.title')){seen.push({sql,args});return [[{id:'assigned-task',title:'Synthetic assigned task'}]];}
    if(sql.includes('SELECT * FROM user WHERE uid='))return [[owner]];
    throw Error('Unexpected query: '+sql);
  };
  const db={query,release(){}},pool={query,getConnection:async()=>db};
  const agentGuard=(req,res,next)=>{
    if(req.get('Authorization')!=='Bearer active-agent')return res.status(401).json({code:'AUTH_REQUIRED'});
    req.decode={userData:actor};req.owner=owner;next();
  };
  // A canonical-cookie guard is intentionally a different identity. It must
  // never run for the signed-in Agent bearer.
  let cookieCalls=0;
  const canonicalGuard=(req,res,next)=>{cookieCalls++;res.status(401).json({code:'AUTH_REQUIRED'});};
  const feature=createBusinessFeatureSession({pool,origin:'http://localhost',userGuard:agentGuard,agentGuard,canonicalGuard});
  const app=express();app.use(['/api/workspace/tasks','/api/user/training/tasks'],feature.guard,createTaskRouter({pool,contextFor:(req,p)=>createTaskContext(pool,req.businessContext,p)}));
  app.use((error,req,res,next)=>{return res.status(error.status||503).json({code:error.code||'ERROR'});});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port,headers={Authorization:'Bearer active-agent','X-Salemax-Actor':'agent'};
  for(const route of ['/api/workspace/tasks','/api/user/training/tasks']){
    const r=await fetch(base+route,{headers});assert.equal(r.status,200);const body=await r.json();assert.equal(body.data.items[0].title,'Synthetic assigned task');assert.equal(body.data.permissions.canViewTeam,false);
    const people=await fetch(base+route+'/participants',{headers});assert.equal(people.status,200);assert.deepEqual((await people.json()).data,[{actorType:'identity',actorId:'owner-identity',role:'owner',label:'Main User'},{actorType:'agent',actorId:'7',role:'agent',label:'Agent'}]);
  }
  assert.equal(cookieCalls,0);assert.equal(seen.length,2);for(const row of seen){assert.match(row.sql,/p\.actor_type=\? AND p\.actor_id=\?/);assert.ok(row.args.includes(tenantId));assert.ok(row.args.includes(hash(owner.uid)));assert.ok(row.args.includes('7'));}
  grants=[];assert.equal((await fetch(base+'/api/workspace/tasks',{headers})).status,403);assert.equal(seen.length,2);
  grants=['tasks.read'];active=false;assert.notEqual((await fetch(base+'/api/workspace/tasks',{headers})).status,200);assert.equal(seen.length,2);
  assert.equal((await fetch(base+'/api/workspace/tasks')).status,401);
  assert.equal((await fetch(base+'/api/workspace/tasks',{method:'POST',headers:{...headers,Origin:'https://foreign.invalid','Content-Type':'application/json'},body:'{}'})).status,403);
});
