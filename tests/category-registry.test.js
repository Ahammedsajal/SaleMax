'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createCategoryRegistry} = require('../modules/platform/category-registry');
const {capabilities} = require('../modules/platform/policy');
const {trainingCenter, professionalServices, salonSpa, homeServices, fitnessCoaching, eventsVenues, retailBoutique, restaurantCafe, sevenNetworkSales, restaurantFixture, listCategories} = require('../modules/platform/categories');

test('category registry pins versions instead of selecting latest implicitly', () => {
  const v2 = {...trainingCenter, version:2, capabilities:trainingCenter.capabilities.filter(key => !['sales.finance','hr.recruitment'].includes(key))};
  const registry = createCategoryRegistry([trainingCenter,v2], capabilities);
  assert.deepEqual(registry.get('training_center',1).taskAdapters,{invoice_follow_up:1,enrollment:1});
  assert.deepEqual(createCategoryRegistry([sevenNetworkSales],capabilities).get('7network_sales',1).taskAdapters,{sales_call:1});
  assert.ok(registry.get('training_center',1).capabilities.includes('sales.finance'));
  assert.equal(registry.get('training_center',2).capabilities.includes('sales.finance'),false);
  for (const version of [undefined,null,0,-1,1.5,'1',3]) assert.equal(registry.get('training_center',version),null);
  assert.deepEqual(registry.list().map(row=>row.version),[1,2]);
  assert.equal(listCategories().some(row=>row.key===restaurantFixture.key&&row.planable===true),false);
  assert.deepEqual({key:professionalServices.key,version:professionalServices.version,public:professionalServices.public,planable:professionalServices.planable,catalogue:professionalServices.catalogue,leadCapture:professionalServices.chatbotLeadCapture},{key:'professional_services',version:1,public:true,planable:true,catalogue:null,leadCapture:'generic'});
  assert.ok(professionalServices.capabilities.includes('crm.leads'));
  assert.deepEqual({key:salonSpa.key,version:salonSpa.version,public:salonSpa.public,planable:salonSpa.planable,leadCapture:salonSpa.chatbotLeadCapture},{key:'salon_spa',version:1,public:true,planable:true,leadCapture:'generic'});
  assert.deepEqual({key:homeServices.key,version:homeServices.version,public:homeServices.public,planable:homeServices.planable,leadCapture:homeServices.chatbotLeadCapture},{key:'home_services',version:1,public:true,planable:true,leadCapture:'generic'});
  assert.ok(salonSpa.capabilities.includes('crm.leads'));
  for(const category of [fitnessCoaching,eventsVenues]){assert.equal(category.version,1);assert.equal(category.public,true);assert.equal(category.planable,true);assert.equal(category.catalogue,null);assert.equal(category.chatbotLeadCapture,'generic');assert.ok(category.capabilities.includes('crm.leads'));}
  assert.deepEqual({key:retailBoutique.key,version:retailBoutique.version,public:retailBoutique.public,planable:retailBoutique.planable,catalogue:retailBoutique.catalogue},{key:'retail_boutique',version:1,public:true,planable:true,catalogue:'products'});
  assert.ok(retailBoutique.capabilities.includes('products.catalog'));
  assert.ok(retailBoutique.capabilities.includes('retail.orders'));
  assert.deepEqual({key:restaurantCafe.key,version:restaurantCafe.version,public:restaurantCafe.public,planable:restaurantCafe.planable,catalogue:restaurantCafe.catalogue,migration:restaurantCafe.migration},{key:'restaurant_cafe',version:1,public:false,planable:true,catalogue:'products',migration:'20270110_restaurant_menu.sql'});
  assert.ok(restaurantCafe.capabilities.includes('restaurant.menu'));
  assert.equal(listCategories().some(row=>row.key===restaurantCafe.key&&row.public===true),false);
  assert.equal(createCategoryRegistry([{...sevenNetworkSales}],capabilities).get('7network_sales',1).key,'7network_sales');
});

test('registry rejects duplicate identity, unknown capabilities, invalid roles and malformed contracts', () => {
  assert.throws(()=>createCategoryRegistry([trainingCenter,trainingCenter],capabilities),{code:'INVALID_CATEGORY_MANIFEST'});
  for (const patch of [{version:'2'},{version:0},{key:'../clinic'},{title:{en:'Clinic'}},{public:'yes'},
    {planable:'yes'},{capabilities:['unknown.feature']},{capabilities:['messaging.inbox','messaging.inbox']},
    {seatRoles:['agent']},{seatRoles:['owner','super_admin']},{migration:'../schema.sql'},
    {chatbotLeadCapture:'unreviewed'},{chatbotLeadCapture:'generic',capabilities:['messaging.inbox']},
    {taskAdapters:[]},{taskAdapters:{sales_call:0}},{taskAdapters:{'../sales_call':1}},
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
