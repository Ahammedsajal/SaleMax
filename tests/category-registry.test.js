'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createCategoryRegistry} = require('../modules/platform/category-registry');
const {capabilities} = require('../modules/platform/policy');
const {trainingCenter, sevenNetworkSales, restaurantFixture, listCategories} = require('../modules/platform/categories');

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

test('registry carries bounded immutable category customization defaults into the resolver', () => {
  const defaults={schemaVersion:3,navigationLabels:{courses:{en:'Learning',ar:'التعلم'}},leadFields:[],hiddenNavigation:[]};
  const input={...trainingCenter,customizationDefaults:defaults};
  const category=createCategoryRegistry([input],capabilities).get('training_center',1);
  defaults.navigationLabels.courses.en='Mutated';
  assert.equal(category.customizationDefaults.navigationLabels.courses.en,'Learning');
  assert.throws(()=>{category.customizationDefaults.navigationLabels.courses.en='Mutated';},TypeError);
  const context={tenant:{categoryKey:category.key,categoryVersion:category.version},category};
  const resolved=require('../modules/platform/tenant-customization').resolved(context,null,0);
  assert.equal(resolved.value.navigationLabels.courses.en,'Learning');
  assert.deepEqual(resolved.provenance['navigationLabels.courses.en'],{scope:'category_version',categoryKey:'training_center',categoryVersion:1});
  for(const customizationDefaults of [[],{schemaVersion:3,unsafe:()=>{}},{schemaVersion:3,deep:{a:{b:{c:{d:{e:{f:{g:{h:{i:1}}}}}}}}}},{data:'x'.repeat(33*1024)}])
    assert.throws(()=>createCategoryRegistry([{...trainingCenter,customizationDefaults}],capabilities),{code:'INVALID_CATEGORY_MANIFEST'});
  assert.throws(()=>createCategoryRegistry([{...trainingCenter,capabilities:trainingCenter.capabilities.filter(key=>key!=='tenant.settings'),customizationDefaults:defaults}],capabilities),{code:'INVALID_CATEGORY_MANIFEST'});
});
