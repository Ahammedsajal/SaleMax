'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const staff=require('../modules/platform/staff-access');
const owner={audience:'platform',identity:{id:'f2af2210-e20c-488d-aa35-2eac9025e045'},membership:{role:'super_admin',status:'active'},mfaVerified:true,recentlyAuthenticated:true};
const staffContext={audience:'platform',identity:{id:'f2af2210-e20c-488d-aa35-2eac9025e045'},membership:{role:'staff',status:'active',delegatedPermissions:['tenants.read','plans.read']},mfaVerified:true,recentlyAuthenticated:true};
test('staff permissions cannot include owner or staff-management grants',()=>{
  assert.deepEqual(staff.permissions(['plans.read','tenants.read']),['plans.read','tenants.read']);
  for(const value of [null,'plans.read',['staff.manage'],['owner.recover'],['super_admin'],['plans.read','plans.read']])assert.throws(()=>staff.permissions(value),{code:'INVALID_STAFF_PERMISSIONS'});
});
test('staff access operations require a recently reauthenticated MFA Super Admin',async()=>{
  for(const context of [staffContext,{...owner,mfaVerified:false},{...owner,recentlyAuthenticated:false},{...owner,audience:'tenant'}]){
    await assert.rejects(staff.list({query:async()=>{throw new Error('must not query');}},context),{code:'PERMISSION_DENIED'});
  }
});
test('staff invitations require normalized, valid Qatar-neutral identity input and owner permissions',()=>{
  assert.equal(staff.email('  STAFF@Example.Invalid '),'staff@example.invalid');
  for(const value of ['',null,'bad-address','a'.repeat(250)+'@example.invalid'])assert.throws(()=>staff.email(value),{code:'INVALID_EMAIL'});
});
