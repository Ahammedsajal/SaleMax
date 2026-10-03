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
});
test('optional changes require MFA permission, valid switches and expected revision',async()=>{
  const ctx={audience:'platform',identity:{id:'owner'},membership:{role:'super_admin',status:'active'},mfaVerified:true};
  const db={beginTransaction:async()=>{},rollback:async()=>{},query:async sql=>sql.includes('FROM user')?[[{id:1}]]:[[{revision:4}]]};
  await assert.rejects(features.save(db,{...ctx,mfaVerified:false},1,{features:features.defaults(),revision:0}),{code:'PERMISSION_DENIED'});
  await assert.rejects(features.save(db,ctx,1,{features:{...features.defaults(),customer_api:1},revision:0}),{code:'INVALID_FEATURE_SETTINGS'});
  await assert.rejects(features.save(db,ctx,1,{features:features.defaults(),revision:0}),{code:'STALE_FEATURE_SETTINGS'});
});
