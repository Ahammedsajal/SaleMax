'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const features=require('../modules/platform/optional-features');
test('optional integrations default off and deny missing, ambiguous or unavailable account settings',async()=>{
  assert.deepEqual(features.project(undefined),{features:{chat_widget:false,customer_api:false,webhooks:false,whatsapp_warmer:false},revision:0});
  for(const rows of [[],[{enabled:0}],[{enabled:1},{enabled:1}]])assert.equal(await features.enabledForUid('owner','customer_api',async()=>rows),false);
  assert.equal(await features.enabledForUid('owner','webhooks',async()=>{throw Error('offline');}),false);
  assert.equal(await features.enabledForUid('owner','customer_api',async()=>[{enabled:1}]),true);
});
test('optional gates leave internal training APIs and ordinary messaging available',()=>{
  for(const path of ['/training/courses','/training/finance-policies','/training/forms','/get_profile'])assert.equal(features.featureForRequest({baseUrl:'/api/user',path}),null);
  assert.equal(features.featureForRequest({baseUrl:'/api/user',path:'/generate_api_keys'}),'customer_api');
  assert.equal(features.featureForRequest({baseUrl:'/api/user',path:'/get_my_widget'}),'chat_widget');
  assert.equal(features.featureForRequest({baseUrl:'/api/user',path:'/add_ins_to_warm'}),'whatsapp_warmer');
  assert.equal(features.featureForRequest({baseUrl:'/api/webhook',path:'/get_webhook_logs'}),'webhooks');
  assert.equal(features.featureForRequest({baseUrl:'/api/v1',path:'/get_logs'}),'customer_api');
  assert.equal(features.featureForRequest({baseUrl:'/api/v1',path:'/delete_logs'}),'customer_api');
  assert.equal(features.featureForRequest({baseUrl:'/api/v1',path:'/send-message'}),null);
});
test('customer API logs are owner-managed for custom legacy roles',()=>{
  const dbPath=require.resolve('../database/dbpromise');
  const priorDbModule=require.cache[dbPath];
  require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{query:async()=>[]}};
  const guard=require('../modules/platform/team-role-request-guard');
  if(priorDbModule)require.cache[dbPath]=priorDbModule;else delete require.cache[dbPath];
  const request=(method,path)=>({baseUrl:'/api/v1',path,method});
  for(const [method,path] of [['GET','/get_logs'],['POST','/delete_logs']]){
    assert.equal(guard.routePermission(request(method,path)),'tenant.manage');
    assert.equal(guard.authorizeLegacyMembership(request(method,path),{
      categoryKey:'7network_sales',role:'owner',roleProfileId:'role-owner',seatRole:'owner',rolePermissions:['tenant.manage'],
    }).allowed,true);
    assert.deepEqual(guard.authorizeLegacyMembership(request(method,path),{
      categoryKey:'7network_sales',role:'manager',roleProfileId:'role-manager',seatRole:'manager',rolePermissions:['tenant.read'],
    }),{allowed:false,code:'TEAM_ROLE_PERMISSION_DENIED'});
  }
});
test('optional changes require MFA permission, valid switches and expected revision',async()=>{
  const ctx={audience:'platform',identity:{id:'owner'},membership:{role:'super_admin',status:'active'},mfaVerified:true};
  const db={beginTransaction:async()=>{},rollback:async()=>{},query:async sql=>sql.includes('FROM user')?[[{id:1}]]:[[{revision:4}]]};
  await assert.rejects(features.save(db,{...ctx,mfaVerified:false},1,{features:features.defaults(),revision:0}),{code:'PERMISSION_DENIED'});
  await assert.rejects(features.save(db,ctx,1,{features:{...features.defaults(),customer_api:1},revision:0}),{code:'INVALID_FEATURE_SETTINGS'});
  await assert.rejects(features.save(db,ctx,1,{features:features.defaults(),revision:0}),{code:'STALE_FEATURE_SETTINGS'});
});
