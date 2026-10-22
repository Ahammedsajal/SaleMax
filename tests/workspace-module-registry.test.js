'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {workspaceModules,configurableModules}=require('../modules/platform/workspace-module-registry');
const {capabilities,permissions}=require('../modules/platform/policy');
const categories=require('../modules/platform/categories');
const featureContract=require('../modules/platform/feature-contract');
const tenantModules=require('../modules/platform/tenant-module-contract');

function context(category,{disabledModules=[]}={}){
  return {audience:'tenant',identity:{id:'owner'},tenant:{id:'tenant-'+category.key,status:'active',categoryKey:category.key,categoryVersion:category.version,disabledModules},membership:{id:'member',tenantId:'tenant-'+category.key,status:'active',role:'owner'},category,subscription:{status:'active',capabilities:[...category.capabilities]}};
}

test('reviewed workspace and configurable modules share validated policy contracts',()=>{
  assert.equal(new Set(workspaceModules.map(module=>module.key)).size,workspaceModules.length);
  assert.equal(new Set(configurableModules.map(module=>module.capability)).size,configurableModules.length);
  for(const module of workspaceModules){
    assert.ok(Object.hasOwn(capabilities,module.capability),module.capability);
    assert.ok(Object.hasOwn(permissions,module.permission),module.permission);
  }
  for(const module of configurableModules){
    assert.ok(Object.hasOwn(capabilities,module.capability),module.capability);
    assert.ok(module.label.en&&module.label.ar,module.capability);
    for(const dependency of module.requires||[])assert.ok(configurableModules.some(candidate=>candidate.capability===dependency),`${module.capability} dependency ${dependency}`);
  }
  assert.ok(Object.isFrozen(workspaceModules));
  assert.ok(Object.isFrozen(workspaceModules[0]));
  assert.ok(Object.isFrozen(configurableModules));
  assert.ok(Object.isFrozen(configurableModules[0].label));
});

test('existing workspace contracts remain category, plan and member-permission intersections',()=>{
  const training=context(categories.trainingCenter),sales=context(categories.sevenNetworkSales),estate=context(categories.realEstateV3),base=context(categories.baseCrm);
  const trainingModules=featureContract.describe({context:training}).modules;
  const salesModules=featureContract.describe({context:sales}).modules;
  const estateModules=featureContract.describe({context:estate}).modules;
  const baseModules=featureContract.describe({context:base}).modules;
  assert.equal(trainingModules.courses,true);assert.equal(trainingModules.products,false);assert.equal(trainingModules.properties,false);
  assert.equal(salesModules.products,true);assert.equal(salesModules.courses,false);assert.equal(salesModules.properties,false);
  assert.equal(estateModules.properties,true);assert.equal(estateModules.courses,false);assert.equal(estateModules.products,false);
  assert.equal(baseModules.inbox,true);assert.equal(baseModules.courses,false);assert.equal(baseModules.products,false);assert.equal(baseModules.properties,false);

  const options=category=>tenantModules.options(context(category)).map(item=>item.key);
  assert.ok(options(categories.trainingCenter).includes('training.courses'));
  assert.ok(!options(categories.trainingCenter).includes('products.catalog'));
  assert.ok(options(categories.sevenNetworkSales).includes('products.catalog'));
  assert.ok(!options(categories.sevenNetworkSales).includes('training.courses'));
  assert.ok(options(categories.realEstateV3).includes('realestate.listings'));
  assert.ok(!options(categories.realEstateV3).includes('training.courses'));
});

test('tenant customization can restrict a registered module but cannot create access',()=>{
  const training=context(categories.trainingCenter,{disabledModules:['training.courses']});
  const disabled=featureContract.describe({context:training}).modules;
  assert.equal(disabled.courses,false);
  assert.ok(tenantModules.options(training).some(item=>item.key==='training.courses'),'owners must still see the module in the settings editor so they can re-enable it');

  const noPlan=context(categories.sevenNetworkSales);
  noPlan.subscription={...noPlan.subscription,capabilities:noPlan.subscription.capabilities.filter(key=>key!=='products.catalog')};
  assert.equal(featureContract.describe({context:noPlan}).modules.products,false);
  assert.ok(!tenantModules.options(noPlan).some(item=>item.key==='products.catalog'));
});

test('a future category can opt into an existing module without inheriting sibling modules',()=>{
  const future={key:'future_retail',version:1,capabilities:['messaging.inbox','crm.contacts','products.catalog'],seatRoles:['owner']};
  const ctx={...context(categories.baseCrm),tenant:{...context(categories.baseCrm).tenant,id:'future-tenant',categoryKey:future.key,categoryVersion:future.version},membership:{id:'future-owner',tenantId:'future-tenant',status:'active',role:'owner'},category:future,subscription:{status:'active',capabilities:[...future.capabilities]}};
  const modules=featureContract.describe({context:ctx}).modules;
  assert.equal(modules.products,true);
  assert.equal(modules.courses,false);
  assert.equal(modules.properties,false);
  const configurable=tenantModules.options(ctx).map(item=>item.key);
  assert.ok(configurable.includes('products.catalog'));
  assert.ok(!configurable.includes('training.courses'));
  assert.ok(!configurable.includes('realestate.listings'));
});
