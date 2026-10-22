'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const categories=require('../modules/platform/categories');
const contracts=require('../modules/platform/feature-contract');

function context(category,role='owner'){
  return {audience:'tenant',identity:{id:'synthetic-identity'},tenant:{id:'synthetic-tenant',status:'active',categoryKey:category.key,categoryVersion:category.version},category,membership:{id:'synthetic-membership',tenantId:'synthetic-tenant',role,status:'active'},subscription:{status:'active',categoryKey:category.key,categoryVersion:category.version,capabilities:[...category.capabilities]}};
}

test('module extensions are exact-category, capability and permission checked contributions',()=>{
  const key='test_base_workspace_extension';
  const registered=contracts.registerModuleExtension({key,capability:'crm.leads',permission:'leads.read',categoryKey:'base_crm',categoryVersion:1});
  assert.deepEqual(registered,{key,capability:'crm.leads',permission:'leads.read',categoryKey:'base_crm',categoryVersion:1});
  const base=contracts.describe({context:context(categories.baseCrm)});
  assert.equal(base.modules[key],true);
  const training=contracts.describe({context:context(categories.trainingCenter)});
  assert.equal(Object.hasOwn(training.modules,key),false);
  const nextVersion={...context(categories.baseCrm),tenant:{...context(categories.baseCrm).tenant,categoryVersion:2}};
  assert.equal(Object.hasOwn(contracts.describe({context:nextVersion}).modules,key),false);
  const expired={...context(categories.baseCrm),subscription:{...context(categories.baseCrm).subscription,status:'expired'}};
  assert.equal(contracts.describe({context:expired}).modules[key],false);
  const deniedMember={...context(categories.baseCrm),membership:{...context(categories.baseCrm).membership,customPermissions:[]}};
  assert.equal(contracts.describe({context:deniedMember}).modules[key],false);
  assert.equal(base.modules.inbox,true);
  assert.equal(base.permissions['leads.read'],true);

  for(const invalid of [
    {key:'bad_module_capability',capability:'unknown.capability',permission:'leads.read'},
    {key:'bad_module_permission',capability:'crm.leads',permission:'invoices.read'},
    {key:'unversioned_module_scope',capability:'crm.leads',permission:'leads.read',categoryKey:'base_crm'},
    {key:'unknown_category_module',capability:'crm.leads',permission:'leads.read',categoryKey:'future_category',categoryVersion:1},
    {key:'undeclared_category_capability',capability:'crm.leads',permission:'leads.read',categoryKey:'restaurant_fixture',categoryVersion:1},
  ])assert.throws(()=>contracts.registerModuleExtension(invalid),{code:'INVALID_MODULE_CONTRACT'});
  assert.throws(()=>contracts.registerModuleExtension({key,capability:'crm.leads',permission:'leads.read',categoryKey:'base_crm',categoryVersion:1}),{code:'MODULE_CONTRACT_EXISTS'});
  assert.throws(()=>contracts.registerModuleExtension({key:'inbox',capability:'messaging.inbox',permission:'conversations.read'}),{code:'MODULE_CONTRACT_EXISTS'});
});

test('category-scoped module extensions honor reviewed historical aliases',()=>{
  const key='test_sales_alias_extension';
  contracts.registerModuleExtension({key,capability:'crm.leads',permission:'leads.read',categoryKey:'7network_sales',categoryVersion:1});
  const sales=context(categories.sevenNetworkSales);
  const historical={...sales,tenant:{...sales.tenant,categoryKey:'salemax_sales'},subscription:{...sales.subscription,categoryKey:'salemax_sales'}};
  assert.equal(contracts.describe({context:sales}).modules[key],true);
  assert.equal(contracts.describe({context:historical}).modules[key],true);
});
