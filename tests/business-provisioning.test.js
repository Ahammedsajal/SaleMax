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
test('7Network Sales setup only accepts the designated Business Admin before contract lookup',async()=>{
  const queries=[];const db={async query(sql){queries.push(sql);if(sql.includes('SELECT id,uid,name,email,plan,plan_expire FROM user'))return [[{id:27,uid:'legacy-user-27',name:'Other account',email:'other@example.qa',plan:JSON.stringify({id:12,title:'Internal',price:0,plan_duration_in_days:365}),plan_expire:1}],[]];if(sql.includes('SELECT id FROM user WHERE uid='))return [[{id:27}],[]];if(sql.includes('FROM sx_legacy_ownership'))return [[],[]];throw new Error('provisioning must stop before identity or contract lookup');}};
  await assert.rejects(provisioning.options(db,actor,27,'7network_sales'),{code:'DESIGNATED_OWNER_REQUIRED'});
  assert.equal(queries.some(sql=>sql.includes('FROM sx_plan_versions')),false);
});
test('onboarding controls extend the original Manage Users contract screen',()=>{
  const ui=fs.readFileSync(path.join(__dirname,'../client/public/admin-user-plans.js'),'utf8');
  const router=fs.readFileSync(path.join(__dirname,'../modules/platform/existing-business-router.js'),'utf8');
  const manual=fs.readFileSync(path.join(__dirname,'../docs/USER_MANUAL.md'),'utf8');
  const lab=fs.readFileSync(path.join(__dirname,'../scripts/existing-panel-lab.cjs'),'utf8');
  assert.match(router,/provision-options/);assert.match(router,/provision-preview/);assert.match(router,/provisioning\.provision/);
  assert.match(ui,/DESIGNATED_OWNER_REQUIRED:t\('7Network Sales must be provisioned against the designated Business Admin account/);
  assert.match(ui,/Publish a 7Network Sales contract for the user’s current catalogue plan first\./);
  assert.match(ui,/existing Manage Users account/);assert.match(ui,/options\.category\.title/);assert.match(ui,/options\.category\.seatRoles/);assert.match(ui,/Preview only/);
  assert.match(ui,/PLATFORM_UPGRADE_NOT_ENABLED:t\('Training-center setup is not enabled in this environment/);
  assert.match(ui,/إعداد مركز التدريب غير مفعّل في هذه البيئة/);
  assert.match(ui,/ASSIGNMENT_UNAVAILABLE:t\('The setup service is temporarily unavailable/);
  assert.match(ui,/AUDIT_UNAVAILABLE:t\('The required audit record could not be saved/);
  assert.match(manual,/Set up training-center business/);
  assert.match(lab,/provisioning-candidate@example\.invalid/);assert.match(lab,/provision-options\|provision-preview\|provision/);assert.match(lab,/SYNTHETIC_PANEL_ONLY/);
});
