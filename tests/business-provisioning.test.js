'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const provisioning=require('../modules/platform/business-provisioning');
const actor={audience:'platform',identity:{id:'f2af2210-e20c-488d-aa35-2eac9025e045'},membership:{role:'super_admin',status:'active'},mfaVerified:true,recentlyAuthenticated:true};
test('business provisioning denies missing platform authority before database access',async()=>{
  const db={query(){throw new Error('must not touch storage')}};
  await assert.rejects(provisioning.options(db,{...actor,mfaVerified:false},1),{code:'PERMISSION_DENIED'});
  await assert.rejects(provisioning.options(db,{...actor,membership:{role:'staff',status:'active',delegatedPermissions:['plans.read','plans.assign']}},1),{code:'PERMISSION_DENIED'});
});
test('business provisioning validates category-plan limits before database access',async()=>{
  const db={query(){throw new Error('must not touch storage')}};
  await assert.rejects(provisioning.preview(db,actor,{userId:1,planVersionId:'00000000-0000-4000-8000-000000000001',roleLimits:{owner:2,accountant:1,manager:1,agent:7},businessName:'Training centre',requestId:'00000000-0000-4000-8000-000000000002'}),{code:'ONE_OWNER_REQUIRED'});
  await assert.rejects(provisioning.preview(db,actor,{userId:1,planVersionId:'invalid',roleLimits:{owner:1,accountant:1,manager:1,agent:7},businessName:'Training centre',requestId:'00000000-0000-4000-8000-000000000002'}),{code:'INVALID_PROVISION'});
});
test('onboarding controls extend the original Manage Users contract screen',()=>{
  const ui=fs.readFileSync(path.join(__dirname,'../client/public/admin-user-plans.js'),'utf8');
  const router=fs.readFileSync(path.join(__dirname,'../modules/platform/existing-business-router.js'),'utf8');
  const manual=fs.readFileSync(path.join(__dirname,'../docs/USER_MANUAL.md'),'utf8');
  assert.match(router,/provision-options/);assert.match(router,/provision-preview/);assert.match(router,/provisioning\.provision/);
  assert.match(ui,/existing Manage Users account/);assert.match(ui,/Training center/);assert.match(ui,/Preview only/);
  assert.match(manual,/Set up training-center business/);
});
