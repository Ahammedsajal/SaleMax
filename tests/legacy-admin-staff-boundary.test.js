'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createLegacyAdminStaffBoundary,requiredPermission}=require('../modules/platform/legacy-admin-staff-boundary');

const staff={legacy_uid:'staff-uid',link_status:'active',role:'staff',membership_status:'active',identity_status:'active',delegated_permissions:['tenants.read','plans.read','plans.assign']};
function boundaryFor(row){return createLegacyAdminStaffBoundary(async()=>row?[row]:[]);}

test('legacy staff permissions allow only explicitly granted read and preview routes',async()=>{
  const check=boundaryFor(staff);
  assert.deepEqual(await check({adminId:4,uid:'staff-uid',method:'GET',path:'/api/admin/get_users'}),{allowed:true});
  assert.deepEqual(await check({adminId:4,uid:'staff-uid',method:'GET',path:'/api/admin/user_plan_context?userId=8'}),{allowed:true});
  assert.deepEqual(await check({adminId:4,uid:'staff-uid',method:'POST',path:'/api/admin/preview_user_plan'}),{allowed:true});
  assert.deepEqual(await check({adminId:4,uid:'staff-uid',method:'POST',path:'/api/admin/update-admin'}),{allowed:false,code:'STAFF_PERMISSION_DENIED'});
  assert.deepEqual(await check({adminId:4,uid:'staff-uid',method:'POST',path:'/api/admin/del_user'}),{allowed:false,code:'STAFF_PERMISSION_DENIED'});
  assert.deepEqual(await check({adminId:4,uid:'staff-uid',method:'GET',path:'/api/admin/get_payment_gateway_admin'}),{allowed:false,code:'STAFF_PERMISSION_DENIED'});
});

test('legacy staff boundary denies missing grants, stale links, and malformed permissions',async()=>{
  const check=boundaryFor({...staff,delegated_permissions:['plans.read']});
  assert.deepEqual(await check({adminId:4,uid:'staff-uid',method:'GET',path:'/api/admin/get_users'}),{allowed:false,code:'STAFF_PERMISSION_DENIED'});
  assert.deepEqual(await boundaryFor({...staff,link_status:'inactive'})({adminId:4,uid:'staff-uid',method:'GET',path:'/api/admin/get_admin'}),{allowed:false,code:'PLATFORM_ACCOUNT_INACTIVE'});
  assert.deepEqual(await boundaryFor({...staff,delegated_permissions:'not-json'})({adminId:4,uid:'staff-uid',method:'GET',path:'/api/admin/get_users'}),{allowed:false,code:'STAFF_PERMISSION_DENIED'});
  assert.equal(requiredPermission('GET','/api/admin/get_admin'),null);
});

test('legacy owner and pre-adoption administrators keep existing route access',async()=>{
  assert.deepEqual(await boundaryFor(null)({adminId:4,uid:'legacy-owner',method:'POST',path:'/api/admin/update-admin'}),{allowed:true});
  assert.deepEqual(await boundaryFor({...staff,role:'super_admin'})({adminId:4,uid:'staff-uid',method:'POST',path:'/api/admin/update-admin'}),{allowed:true});
  const preMigration=createLegacyAdminStaffBoundary(async()=>{throw Object.assign(new Error(),{code:'ER_NO_SUCH_TABLE'});});
  assert.deepEqual(await preMigration({adminId:4,uid:'legacy-owner',method:'POST',path:'/api/admin/update-admin'}),{allowed:true});
});
