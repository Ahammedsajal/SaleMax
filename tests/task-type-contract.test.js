'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const types=require('../modules/platform/task-type-contract');
const {trainingCenter,sevenNetworkSales,realEstate}=require('../modules/platform/categories');

const context=(category,capabilities=category.capabilities,enabledTaskTypes=null)=>({category,tenant:{categoryKey:category.key,categoryVersion:category.version},subscription:{status:'active',capabilities},enabledTaskTypes});

test('task catalog follows the category contract and current plan capabilities',()=>{
  const training=types.forContext(context(trainingCenter));
  const sales=types.forContext(context(sevenNetworkSales));
  const realEstateTypes=types.forContext(context(realEstate));
  assert.ok(training.some(item=>item.key==='enrollment'));
  assert.ok(!training.some(item=>item.key==='sales_call'));
  assert.ok(sales.some(item=>item.key==='sales_call'));
  assert.ok(!sales.some(item=>item.key==='enrollment'));
  assert.ok(!realEstateTypes.some(item=>['enrollment','sales_call'].includes(item.key)));
  const limited=types.forContext(context(trainingCenter,['team.tasks']));
  assert.equal(limited.find(item=>item.key==='general').planAvailable,true);
  assert.equal(limited.find(item=>item.key==='lead_follow_up').planAvailable,false);
  assert.equal(limited.find(item=>item.key==='enrollment').planAvailable,false);
});

test('same-category tenants can have separate enabled task types without granting plan features',()=>{
  const tenantA=context(trainingCenter,trainingCenter.capabilities,['general']);
  const tenantB=context(trainingCenter,trainingCenter.capabilities,['enrollment']);
  assert.deepEqual([...types.enabledKeys(tenantA,{enabledTaskTypes:tenantA.enabledTaskTypes})],['general']);
  assert.deepEqual([...types.enabledKeys(tenantB,{enabledTaskTypes:tenantB.enabledTaskTypes})],['enrollment']);
  assert.throws(()=>types.assertSelected(tenantA,'lead_follow_up'),{code:'TASK_TYPE_NOT_ENABLED',status:409});
  assert.doesNotThrow(()=>types.assertSelected(tenantB,'enrollment'));
  const missingPlan=context(trainingCenter,['team.tasks'],['general']);
  assert.throws(()=>types.assertSelected(missingPlan,'enrollment'),{code:'FEATURE_UNAVAILABLE',status:403});
});

test('published task-type customization rejects unknown, duplicate, and plan-ineligible choices',()=>{
  const ctx=context(trainingCenter,['team.tasks']);
  assert.deepEqual(types.normalizeEnabled(ctx,['general'],{enforcePlan:true}),['general']);
  assert.throws(()=>types.normalizeEnabled(ctx,['sales_call']),{code:'INVALID_CUSTOMIZATION_TASK_TYPES'});
  assert.throws(()=>types.normalizeEnabled(ctx,['general','general']),{code:'INVALID_CUSTOMIZATION_TASK_TYPES'});
  assert.throws(()=>types.normalizeEnabled(ctx,['enrollment'],{enforcePlan:true}),{code:'INVALID_CUSTOMIZATION_TASK_TYPES'});
});

test('special task behavior is pinned to the category adapter version',()=>{
  const trainingV2={...trainingCenter,version:2,taskAdapters:{enrollment:99}};
  assert.throws(()=>require('../modules/platform/category-registry').createCategoryRegistry([trainingV2],require('../modules/platform/policy').capabilities),{code:'INVALID_CATEGORY_MANIFEST'});
  const withoutAdapter={...trainingCenter,version:2,taskAdapters:{}};
  const registry=require('../modules/platform/category-registry').createCategoryRegistry([withoutAdapter],require('../modules/platform/policy').capabilities);
  assert.deepEqual(registry.get('training_center',2).taskAdapters,{});
  assert.deepEqual(types.forContext(context(realEstate)).filter(item=>['invoice_follow_up','enrollment','sales_call'].includes(item.key)),[]);
});
