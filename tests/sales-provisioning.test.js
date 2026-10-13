'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const provisioning=require('../modules/platform/business-provisioning');

const id='5e77e7bb-bf70-44d5-8a61-1e8e2f509246';
const requestId='b407cc91-d431-4217-bd84-a090c0323c4d';
function context(role='super_admin',delegatedPermissions=[]){
  return {audience:'platform',identity:{id},membership:{role,status:'active',delegatedPermissions},mfaVerified:true};
}
const salesInput={userId:12,categoryKey:'salemax_sales',planVersionId:id,requestId,expectedState:'a'.repeat(64),businessName:'SaleMaX Internal Sales',roleLimits:{owner:1,accountant:4,manager:4,team_leader:12,agent:100}};

test('internal sales provisioning accepts exact SaleMaX Sales seat roles for platform admins',()=>{
  const selected=provisioning.selection(context(),salesInput);
  assert.equal(selected.category.key,'salemax_sales');
  assert.deepEqual(selected.roleLimits,{owner:1,accountant:4,manager:4,team_leader:12,agent:100});
});

test('internal sales provisioning requires private category authority even with plan assignment access',()=>{
  const staff=context('staff',['tenants.create','plans.assign','plans.read']);
  assert.throws(()=>provisioning.selection(staff,salesInput),error=>error.code==='PERMISSION_DENIED');
});

test('provisioning rejects role limits that do not match the selected category seats',()=>{
  assert.throws(()=>provisioning.selection(context(),{...salesInput,roleLimits:{owner:1,accountant:4,manager:4,agent:100}}),error=>error.code==='INVALID_ROLE_LIMITS');
});

test('public Training Center provisioning remains on its original four seat roles',()=>{
  const input={...salesInput,categoryKey:'training_center',roleLimits:{owner:1,accountant:1,manager:2,agent:20}};
  const selected=provisioning.selection(context(),input);
  assert.equal(selected.category.key,'training_center');
  assert.equal(Object.hasOwn(selected.roleLimits,'team_leader'),false);
});
