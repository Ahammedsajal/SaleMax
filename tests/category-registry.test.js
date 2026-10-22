'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createCategoryRegistry} = require('../modules/platform/category-registry');
const {capabilities} = require('../modules/platform/policy');
const {trainingCenter, sevenNetworkSales, restaurantFixture, listCategories} = require('../modules/platform/categories');
const contractLock = require('../modules/platform/category-contract-lock');

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
    {chatbotLeadCapture:'training',capabilities:['messaging.inbox','crm.leads']},
    {taskAdapters:{unknown:1}},{taskAdapters:{sales_call:1},capabilities:['messaging.inbox','team.tasks']},
    {taskAdapters:{sales_call:2}}]) {
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

test('deployed category versions match reviewed fingerprints and reject silent contract edits',()=>{
  const definitions=listCategories();
  const registry=createCategoryRegistry(definitions,capabilities,contractLock);
  assert.equal(registry.list().length,Object.keys(contractLock).length);
  const changed=definitions.map(item=>item.key==='real_estate'&&item.version===3?{...item,title:{...item.title,en:'Property CRM'}}:item);
  assert.throws(()=>createCategoryRegistry(changed,capabilities,contractLock),{code:'INVALID_CATEGORY_MANIFEST'});
  assert.throws(()=>createCategoryRegistry(definitions.slice(1),capabilities,contractLock),{code:'INVALID_CATEGORY_MANIFEST'});
});
