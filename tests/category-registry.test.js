'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createCategoryRegistry} = require('../modules/platform/category-registry');
const {capabilities} = require('../modules/platform/policy');
const {baseCrm,trainingCenter,sevenNetworkSales,realEstate,restaurantFixture,listCategories} = require('../modules/platform/categories');
const {decision}=require('../modules/platform/policy');

test('category registry pins versions instead of selecting latest implicitly', () => {
  const v2 = {...trainingCenter, version:2, capabilities:trainingCenter.capabilities.filter(key => !['sales.finance','hr.recruitment'].includes(key))};
  const registry = createCategoryRegistry([trainingCenter,v2], capabilities);
  assert.ok(registry.get('training_center',1).capabilities.includes('sales.finance'));
  assert.equal(registry.get('training_center',2).capabilities.includes('sales.finance'),false);
  for (const version of [undefined,null,0,-1,1.5,'1',3]) assert.equal(registry.get('training_center',version),null);
  assert.deepEqual(registry.list().map(row=>row.version),[1,2]);
  assert.equal(listCategories().some(row=>row.key===restaurantFixture.key&&row.planable===true),false);
  assert.equal(createCategoryRegistry([{...sevenNetworkSales}],capabilities).get('7network_sales',1).key,'7network_sales');
});

test('registry rejects duplicate identity, unknown capabilities, invalid roles and malformed contracts', () => {
  assert.throws(()=>createCategoryRegistry([trainingCenter,trainingCenter],capabilities),{code:'INVALID_CATEGORY_MANIFEST'});
  for (const patch of [{version:'2'},{version:0},{key:'../clinic'},{title:{en:'Clinic'}},{public:'yes'},
    {planable:'yes'},{capabilities:['unknown.feature']},{capabilities:['messaging.inbox','messaging.inbox']},
    {seatRoles:['agent']},{seatRoles:['owner','super_admin']},{migration:'../schema.sql'},
    {chatbotLeadCapture:'unreviewed'},{chatbotLeadCapture:'generic',capabilities:['messaging.inbox']},
    {chatbotLeadCapture:'training',capabilities:['messaging.inbox','crm.leads']}]) {
    assert.throws(()=>createCategoryRegistry([{...trainingCenter,...patch}],capabilities),{code:'INVALID_CATEGORY_MANIFEST'});
  }
});

test('registry copies caller input and exposes immutable manifests and listings', () => {
  const input={...trainingCenter,title:{...trainingCenter.title},capabilities:[...trainingCenter.capabilities],seatRoles:[...trainingCenter.seatRoles]};
  const registry=createCategoryRegistry([input],capabilities);
  input.title.en='Other';input.capabilities.length=0;input.seatRoles.push('doctor');
  assert.equal(registry.get(input.key,1).title.en,trainingCenter.title.en);
  assert.ok(registry.get(input.key,1).capabilities.includes('messaging.inbox'));
  assert.throws(()=>registry.list().pop(),TypeError);
  assert.throws(()=>{registry.get(input.key,1).title.en='Other';},TypeError);
});

test('task adapter declarations are exact-version capability contracts and immutable', () => {
  const sales = createCategoryRegistry([sevenNetworkSales], capabilities).get('7network_sales', 1);
  assert.deepEqual(sales.taskAdapters, {sales_call: 1});
  assert.equal(Object.isFrozen(sales.taskAdapters), true);
  assert.equal(trainingCenter.taskAdapters.invoice_follow_up, 1);
  for (const patch of [
    {taskAdapters:{unreviewed_task:1}},
    {taskAdapters:{sales_call:2}},
    {taskAdapters:{sales_call:1},capabilities:sevenNetworkSales.capabilities.filter(key=>key!=='telephony.call-center')},
    {taskAdapters:{sales_call:1},capabilities:sevenNetworkSales.capabilities.filter(key=>key!=='team.tasks')},
  ]) assert.throws(()=>createCategoryRegistry([{...sevenNetworkSales,...patch}],capabilities),{code:'INVALID_CATEGORY_MANIFEST'});
});

test('vertical categories share the base CRM contract without inheriting unrelated modules',()=>{
  const shared=new Set(baseCrm.capabilities);
  for(const category of [trainingCenter,sevenNetworkSales,realEstate])for(const capability of shared)assert.ok(category.capabilities.includes(capability),`${category.key} must preserve shared capability ${capability}`);
  assert.ok(trainingCenter.capabilities.includes('training.courses'));
  assert.ok(!trainingCenter.capabilities.includes('products.catalog'));
  assert.ok(!trainingCenter.capabilities.includes('realestate.listings'));
  assert.ok(sevenNetworkSales.capabilities.includes('products.catalog'));
  assert.ok(!sevenNetworkSales.capabilities.includes('training.courses'));
  assert.ok(!sevenNetworkSales.capabilities.includes('realestate.listings'));
  assert.ok(realEstate.capabilities.includes('realestate.listings'));
  assert.ok(!realEstate.capabilities.includes('training.courses'));
  assert.ok(!realEstate.capabilities.includes('products.catalog'));
  assert.ok(!baseCrm.capabilities.some(key=>key.startsWith('training.')||key.startsWith('sales.')||key.startsWith('realestate.')));
  // Training Center v1 retains two historical capabilities until a reviewed v2 migration.
  assert.ok(trainingCenter.capabilities.includes('sales.finance'));
  assert.ok(trainingCenter.capabilities.includes('hr.recruitment'));
  assert.equal(realEstate.planable,false);
});

test('a plan entitlement cannot bypass the active category capability contract',()=>{
  for(const [category,capability,permission] of [
    [baseCrm,'training.courses','courses.read'],
    [trainingCenter,'products.catalog','products.read'],
    [sevenNetworkSales,'realestate.listings','properties.read'],
    [realEstate,'training.courses','courses.read'],
  ]){
    const context={audience:'tenant',tenant:{id:'tenant-a',status:'active',categoryKey:category.key,categoryVersion:category.version},membership:{tenantId:'tenant-a',status:'active',role:'owner'},category,subscription:{status:'active',categoryKey:category.key,categoryVersion:category.version,capabilities:Object.keys(capabilities)}};
    assert.equal(decision(context,{capability,permission}).code,'CATEGORY_UNAVAILABLE',`${category.key} must reject ${capability} even when the plan grants it`);
  }
});
