'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {decision}=require('../modules/platform/policy');
const {getCategory,canonicalCategoryKey,categoryKeyMatches}=require('../modules/platform/categories');
const {normalizeInput}=require('../modules/platform/telephony-call-outcomes');
const {loadEntitlements}=require('../modules/platform/plans');

test('historical SaleMaX Sales tenant and plan keys use the canonical 7Network Sales call permissions',()=>{
  const category=getCategory('salemax_sales',1);
  const context={audience:'tenant',identity:{id:'identity-agent'},
    tenant:{id:'tenant-a',status:'active',categoryKey:'salemax_sales',categoryVersion:1},
    membership:{id:'member-a',tenantId:'tenant-a',role:'agent',status:'active'},category,
    subscription:{status:'active',categoryKey:'salemax_sales',categoryVersion:1,capabilities:['telephony.call-center']},runtimeReady:{}};

  assert.equal(canonicalCategoryKey('salemax_sales'),'7network_sales');
  assert.equal(category.key,'7network_sales');
  assert.equal(categoryKeyMatches(context.tenant.categoryKey,context.subscription.categoryKey),true);
  assert.equal(decision(context,{capability:'telephony.call-center',permission:'calls.read'}).scope,'assigned');
});

test('historical SaleMaX Sales calls retain the Sales do-not-call disposition',()=>{
  assert.deepEqual(normalizeInput({outcome:'do_not_call',note:'Asked us not to call again'},
    {categoryKey:'salemax_sales'}),{
    outcome:'do_not_call',note:'Asked us not to call again',followUpRequired:false,nextFollowUpAt:null,
  });
});

test('legacy and canonical Sales tenant and plan keys resolve entitlements in either direction',async()=>{
  let query='';
  const db={query:async sql=>{
    query=sql;
    return [[{id:'assignment-a',status:'active',role_limits:{owner:1,accountant:0,manager:1,team_leader:0,agent:1},
      capabilities:['telephony.call-center'],category_key:'7network_sales',category_version:1,current_period:1}]];
  }};
  const result=await loadEntitlements(db,'a6ec2d10-b232-4fb5-93ad-53c2ed5f2a92');
  assert.match(query,/t\.category_key IN \('7network_sales','salemax_sales'\) AND p\.category_key IN \('7network_sales','salemax_sales'\)/);
  assert.equal(result.categoryKey,'7network_sales');
  assert.equal(result.capabilities.includes('telephony.call-center'),true);
});
