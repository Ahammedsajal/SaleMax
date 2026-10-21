'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {routerInventory}=require('../scripts/audit-upgraded-route-factories.cjs');
const {ownershipForInventory}=require('../modules/platform/upgraded-route-ownership');
const categoryRegistry=require('../modules/platform/categories');

test('every discovered upgraded route has an explicit source-owned module or platform owner',()=>{
  const inventory=routerInventory();
  const ownership=ownershipForInventory(inventory,{moduleRegistry:categoryRegistry.moduleRegistry,categories:{list:categoryRegistry.listCategories,get:categoryRegistry.getCategory}});
  assert.equal(ownership.contractCount,ownership.stale.length+new Set(ownership.routes.map(route=>`${route.module}|${route.mount}`)).size);
  assert.deepEqual(ownership.unowned,[]);
  assert.deepEqual(ownership.stale,[]);
  assert.ok(ownership.routes.every(route=>route.ownership&&route.ownershipStatus==='mapped_policy_unverified'));
  assert.ok(ownership.routes.every(route=>route.reviewStatus==='review_required'));
});

test('vertical route ownership follows category module contracts without merging catalogues',()=>{
  const ownership=ownershipForInventory(routerInventory(),{moduleRegistry:categoryRegistry.moduleRegistry,categories:{list:categoryRegistry.listCategories,get:categoryRegistry.getCategory}});
  const route=(mount)=>ownership.routes.find(item=>item.mount===mount);
  assert.deepEqual(route('/api/workspace/courses').ownership.categoryModules,{training_center:['training.core']});
  assert.deepEqual(route('/api/workspace/products-services').ownership.categoryModules,{'7network_sales':['sales.products-services']});
  assert.deepEqual(route('/api/workspace/properties').ownership.categoryModules,{real_estate:['real-estate.properties']});
  assert.deepEqual(route('/api/workspace/finance').ownership.categoryModules,{training_center:['training.finance']});
  assert.deepEqual(route('/api/admin/plan-contracts').ownership.modules,[]);
  assert.equal(Object.hasOwn(route('/api/crm').ownership.categoryModules,'restaurant_fixture'),false);
});
