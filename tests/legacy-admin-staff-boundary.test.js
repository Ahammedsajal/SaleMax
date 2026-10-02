'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createLegacyAdminStaffBoundary,requiredPermission}=require('../modules/platform/legacy-admin-staff-boundary');

const staff={legacy_uid:'staff-uid',identity_id:'staff-id',reports_to_identity_id:'admin-id',link_status:'active',role:'staff',membership_status:'active',identity_status:'active',delegated_permissions:['tenants.read','plans.read','plans.assign']};
function boundaryFor(row,options){return createLegacyAdminStaffBoundary(async()=>row?[row]:[],options);}
const request=(method,path)=>({adminId:4,uid:'staff-uid',method,path});

test('staff permissions allow only explicitly granted existing administration routes',async()=>{
  const check=boundaryFor(staff);
  for(const [method,path] of [['GET','/api/admin/get_users'],['GET','/api/admin/user_plan_context?userId=8'],['POST','/api/admin/preview_user_plan']])assert.equal((await check(request(method,path))).allowed,true,path);
  for(const [method,path] of [['POST','/api/admin/update-admin'],['POST','/api/admin/del_user'],['GET','/api/admin/get_payment_gateway_admin'],['POST','/api/admin/auto_login']])assert.equal((await check(request(method,path))).allowed,false,path);
});

test('legacy staff boundary denies missing grants, stale links and malformed permissions',async()=>{
  const check=boundaryFor({...staff,delegated_permissions:['plans.read']});
  assert.equal((await check(request('GET','/api/admin/get_users'))).code,'STAFF_PERMISSION_DENIED');
  assert.equal((await boundaryFor({...staff,link_status:'inactive'})(request('GET','/api/admin/get_admin'))).code,'PLATFORM_ACCOUNT_INACTIVE');
  assert.equal((await boundaryFor({...staff,delegated_permissions:'not-json'})(request('GET','/api/admin/get_users'))).code,'STAFF_PERMISSION_DENIED');
  assert.equal(requiredPermission('GET','/api/admin/get_admin'),null);
});

test('delegated Admins can manage customer and plan routes but cannot administer staff or impersonate customers',async()=>{
  const check=boundaryFor({...staff,role:'platform_admin',delegated_permissions:[]});
  for(const [method,path] of [['GET','/api/admin/get_users'],['POST','/api/admin/add_user'],['POST','/api/admin/update_user'],['POST','/api/admin/update_plan'],['POST','/api/admin/add_plan'],['POST','/api/admin/edit_plan'],['POST','/api/admin/del_plan']])assert.equal((await check(request(method,path))).allowed,true,path);
  for(const [method,path] of [['POST','/api/admin/auto_login'],['POST','/api/admin/update-admin'],['POST','/api/admin/update_pay_gateway']])assert.equal((await check(request(method,path))).allowed,false,path);
  assert.deepEqual((await check(request('GET','/api/admin/get_users'))).platform,{identityId:'staff-id',role:'platform_admin',reportsToIdentityId:'admin-id'});
});

test('only the owner keeps cross-portfolio access and unlinked accounts fail closed after platform activation',async()=>{
  assert.equal((await boundaryFor(null)(request('POST','/api/admin/update-admin'))).allowed,true);
  assert.equal((await boundaryFor({...staff,role:'super_admin'})(request('POST','/api/admin/update-admin'))).allowed,true);
  assert.equal((await boundaryFor(null,{enforcePlatform:true})(request('GET','/api/admin/get_users'))).code,'PLATFORM_ACCOUNT_NOT_LINKED');
  const preMigration=createLegacyAdminStaffBoundary(async()=>{throw Object.assign(new Error(),{code:'ER_NO_SUCH_TABLE'});});
  assert.equal((await preMigration(request('POST','/api/admin/update-admin'))).allowed,true);
  const enforced=createLegacyAdminStaffBoundary(async()=>{throw Object.assign(new Error(),{code:'ER_NO_SUCH_TABLE'});},{enforcePlatform:true});
  assert.equal((await enforced(request('GET','/api/admin/get_users'))).code,'PLATFORM_ACCOUNT_NOT_LINKED');
});
