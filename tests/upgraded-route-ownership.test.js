'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
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
  assert.equal(route('/api/workspace/properties').ownership.moduleContracts['real-estate.properties'].dataBoundary,'tenant_scoped');
  assert.equal(route('/api/workspace/properties').ownership.moduleContracts['real-estate.properties'].primaryService,'modules/platform/real-estate-properties-router.js');
  assert.equal(route('/api/workspace/courses').ownership.moduleContracts['training.core'].dataBoundary,'mixed_legacy_and_tenant');
});

test('Real Estate route ownership resolves to its tenant-owned table and scoped shared references',()=>{
  const ownership=ownershipForInventory(routerInventory(),{moduleRegistry:categoryRegistry.moduleRegistry,categories:{list:categoryRegistry.listCategories,get:categoryRegistry.getCategory}});
  const route=ownership.routes.find(item=>item.mount==='/api/workspace/properties');
  const module=route.ownership.moduleContracts['real-estate.properties'];
  assert.equal(route.ownership.service,'modules/platform/real-estate-properties.js');
  assert.equal(module.dataOwnership.status,'reviewed');
  assert.deepEqual(module.dataOwnership.ownedTables,['sx_real_estate_properties']);
  const service=fs.readFileSync(path.join(root,route.ownership.service),'utf8');
  const router=fs.readFileSync(path.join(root,module.primaryService),'utf8');
  assert.match(router,/require\('\.\/real-estate-properties'\)/);
  assert.match(router,/properties\.(list|listAssignees|create|update)\(/);
  const referenced=new Set([...service.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(sx_[a-z0-9_]+)/gi)].map(match=>match[1]));
  const declared=new Set([...module.dataOwnership.ownedTables,...module.dataOwnership.referencedTables.map(item=>item.name)]);
  assert.deepEqual([...referenced].sort(),[...declared].sort(),'every queried sx_ table must have a reviewed owner/reference classification');
  for(const item of module.dataOwnership.referencedTables)assert.ok(['tenant_qualified','tenant_qualified_through_membership'].includes(item.scope));
  const migration=fs.readFileSync(path.join(root,'database/migrations/20261222_real_estate_properties.sql'),'utf8');
  assert.match(migration,/CREATE TABLE sx_real_estate_properties/);
  assert.match(migration,/tenant_id CHAR\(36\)/);
});
