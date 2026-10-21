'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createCategoryRegistry} = require('../modules/platform/category-registry');
const {createModuleRegistry}=require('../modules/platform/module-registry');
const {capabilities} = require('../modules/platform/policy');
const {baseCrm,trainingCenter,sevenNetworkSales,realEstate,restaurantFixture,listCategories,moduleRegistry} = require('../modules/platform/categories');
const {decision}=require('../modules/platform/policy');

test('category registry pins versions instead of selecting latest implicitly', () => {
  const v2 = {...trainingCenter, version:2, modules:trainingCenter.modules.filter(module=>module.id!=='compat.training-center-v1'), capabilities:trainingCenter.capabilities.filter(key => !['sales.finance','hr.recruitment'].includes(key))};
  const registry = createCategoryRegistry([trainingCenter,v2], capabilities,moduleRegistry);
  assert.ok(registry.get('training_center',1).capabilities.includes('sales.finance'));
  assert.equal(registry.get('training_center',2).capabilities.includes('sales.finance'),false);
  for (const version of [undefined,null,0,-1,1.5,'1',3]) assert.equal(registry.get('training_center',version),null);
  assert.deepEqual(registry.list().map(row=>row.version),[1,2]);
  assert.equal(listCategories().some(row=>row.key===restaurantFixture.key&&row.planable===true),false);
  assert.equal(createCategoryRegistry([{...sevenNetworkSales}],capabilities,moduleRegistry).get('7network_sales',1).key,'7network_sales');
});

test('registry rejects duplicate identity, unknown capabilities, invalid roles and malformed contracts', () => {
  assert.throws(()=>createCategoryRegistry([trainingCenter,trainingCenter],capabilities,moduleRegistry),{code:'INVALID_CATEGORY_MANIFEST'});
  for (const patch of [{version:'2'},{version:0},{key:'../clinic'},{title:{en:'Clinic'}},{public:'yes'},
    {planable:'yes'},{capabilities:['unknown.feature']},{capabilities:['messaging.inbox','messaging.inbox']},
    {seatRoles:['agent']},{seatRoles:['owner','super_admin']},{migration:'../schema.sql'},
    {chatbotLeadCapture:'unreviewed'},{chatbotLeadCapture:'generic',capabilities:['messaging.inbox']},
    {chatbotLeadCapture:'training',capabilities:['messaging.inbox','crm.leads']}]) {
    assert.throws(()=>createCategoryRegistry([{...trainingCenter,...patch}],capabilities,moduleRegistry),{code:'INVALID_CATEGORY_MANIFEST'});
  }
});

test('registry copies caller input and exposes immutable manifests and listings', () => {
  const input={...trainingCenter,title:{...trainingCenter.title},capabilities:[...trainingCenter.capabilities],seatRoles:[...trainingCenter.seatRoles]};
  const registry=createCategoryRegistry([input],capabilities,moduleRegistry);
  input.title.en='Other';input.capabilities.length=0;input.seatRoles.push('doctor');
  assert.equal(registry.get(input.key,1).title.en,trainingCenter.title.en);
  assert.ok(registry.get(input.key,1).capabilities.includes('messaging.inbox'));
  assert.throws(()=>registry.list().pop(),TypeError);
  assert.throws(()=>{registry.get(input.key,1).title.en='Other';},TypeError);
});

test('task adapter declarations are exact-version capability contracts and immutable', () => {
  const sales = createCategoryRegistry([sevenNetworkSales], capabilities,moduleRegistry).get('7network_sales', 1);
  assert.deepEqual(sales.taskAdapters, {sales_call: 1});
  assert.equal(Object.isFrozen(sales.taskAdapters), true);
  assert.equal(trainingCenter.taskAdapters.invoice_follow_up, 1);
  for (const patch of [
    {taskAdapters:{unreviewed_task:1}},
    {taskAdapters:{sales_call:2}},
    {taskAdapters:{sales_call:1},capabilities:sevenNetworkSales.capabilities.filter(key=>key!=='telephony.call-center')},
    {taskAdapters:{sales_call:1},capabilities:sevenNetworkSales.capabilities.filter(key=>key!=='team.tasks')},
  ]) assert.throws(()=>createCategoryRegistry([{...sevenNetworkSales,...patch}],capabilities,moduleRegistry),{code:'INVALID_CATEGORY_MANIFEST'});
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

test('version-pinned module composition exactly matches each category capability contract',()=>{
  for(const category of listCategories()){
    assert.ok(Array.isArray(category.modules)&&category.modules.length,`${category.key} must declare reviewed modules`);
    const composed=category.modules.flatMap(ref=>{
      const module=moduleRegistry.get(ref.id,ref.version);
      assert.ok(module,`${category.key} references missing module ${ref.id}@${ref.version}`);
      return module.capabilities;
    });
    assert.equal(new Set(composed).size,composed.length,`${category.key} modules must not grant the same capability twice`);
    assert.deepEqual([...composed].sort(),[...category.capabilities].sort(),`${category.key} module composition must exactly match capabilities`);
    assert.ok(category.modules.every(ref=>Object.isFrozen(ref)));
  }
  const knownScreens=new Set(require('../modules/platform/navigation').items.map(item=>item.key));
  for(const module of moduleRegistry.list())for(const screen of module.screens)assert.ok(knownScreens.has(screen),`${module.id} references unknown screen ${screen}`);
  assert.ok(trainingCenter.modules.some(ref=>ref.id==='compat.training-center-v1'));
  assert.ok(!sevenNetworkSales.modules.some(ref=>ref.id.startsWith('training.')));
  assert.ok(!trainingCenter.modules.some(ref=>ref.id.startsWith('sales.')));
  assert.equal(realEstate.planable,false);
  assert.equal(moduleRegistry.get('real-estate.properties',1).configSchemaVersion,1);
  assert.equal(require('../modules/platform/module-settings').assertRegistry(moduleRegistry),true);
});

test('category registry rejects missing, duplicate, or capability-mismatched module references',()=>{
  assert.throws(()=>createCategoryRegistry([{...baseCrm,modules:[{id:'unknown.module',version:1}]}],capabilities,moduleRegistry),{code:'INVALID_CATEGORY_MANIFEST'});
  assert.throws(()=>createCategoryRegistry([{...baseCrm,modules:undefined}],capabilities,moduleRegistry),{code:'INVALID_CATEGORY_MANIFEST'});
  assert.throws(()=>createCategoryRegistry([{...baseCrm,modules:[...baseCrm.modules,baseCrm.modules[0]]}],capabilities,moduleRegistry),{code:'INVALID_CATEGORY_MANIFEST'});
  assert.throws(()=>createCategoryRegistry([{...baseCrm,modules:baseCrm.modules.slice(1)}],capabilities,moduleRegistry),{code:'INVALID_CATEGORY_MANIFEST'});
});

test('module manifests reject unsafe contracts and copy immutable ownership metadata',()=>{
  const source={id:'clinic.appointments',version:1,capabilities:['team.tasks'],screens:['appointments'],primaryService:'modules/clinic/appointments.js',dataBoundary:'tenant_scoped',configSchemaVersion:1};
  const registry=createModuleRegistry([source],capabilities);
  source.capabilities.push('tenant.settings');source.screens.push('unreviewed');
  const stored=registry.get('clinic.appointments',1);
  assert.deepEqual(stored.capabilities,['team.tasks']);assert.deepEqual(stored.screens,['appointments']);
  assert.equal(Object.isFrozen(stored),true);assert.equal(Object.isFrozen(stored.capabilities),true);assert.equal(Object.isFrozen(registry.list()),true);
  assert.throws(()=>createModuleRegistry([source,source],capabilities),{code:'INVALID_MODULE_MANIFEST'});
  for(const patch of [{id:'../clinic'},{version:0},{activation:'grant-all'},{capabilities:['not.a.capability']},{screens:['<script>']},{primaryService:'../secret.js'},{dataBoundary:'global'},{configSchemaVersion:0},{dataOwnership:{status:'reviewed',ownedTables:[],referencedTables:[]}},{dataOwnership:{status:'reviewed',ownedTables:['sx_bad-name'],referencedTables:[]}},{dataOwnership:{status:'reviewed',ownedTables:['sx_a'],referencedTables:[{name:'sx_a',scope:'tenant_qualified'}]}},{dataOwnership:{status:'reviewed',ownedTables:['sx_a'],referencedTables:[{name:'sx_b',scope:'global'}]}},{dataOwnership:{status:'reviewed',ownedTables:['sx_a'],referencedTables:[],tenantId:'tenant-a'}},{dataOwnership:{status:'reviewed',ownedTables:['sx_a'],referencedTables:[{name:'sx_b',scope:'tenant_qualified',module:'core.inbox'}]}}])
    assert.throws(()=>createModuleRegistry([{...source,...patch}],capabilities),{code:'INVALID_MODULE_MANIFEST'});
  const ownership={status:'reviewed',ownedTables:['sx_clinic_appointments'],referencedTables:[{name:'sx_tenants',scope:'tenant_qualified'}]};
  const ownerSource={...source,dataOwnership:ownership},owned=createModuleRegistry([ownerSource],capabilities).get(source.id,source.version);
  ownership.ownedTables.push('sx_mutated');ownership.referencedTables[0].name='sx_mutated';
  assert.deepEqual(owned.dataOwnership,{status:'reviewed',ownedTables:['sx_clinic_appointments'],referencedTables:[{name:'sx_tenants',scope:'tenant_qualified'}]});
  assert.equal(Object.isFrozen(owned.dataOwnership),true);assert.equal(Object.isFrozen(owned.dataOwnership.ownedTables),true);assert.equal(Object.isFrozen(owned.dataOwnership.referencedTables[0]),true);
  assert.throws(()=>createModuleRegistry([{...ownerSource,id:'clinic.other',dataOwnership:{status:'reviewed',ownedTables:['sx_clinic_appointments'],referencedTables:[]}},ownerSource],capabilities),{code:'INVALID_MODULE_MANIFEST'});
  const versionedOwner={...ownerSource,dataOwnership:{status:'reviewed',ownedTables:['sx_clinic_appointments'],referencedTables:[{name:'sx_tenants',scope:'tenant_qualified'}]}};
  const v2=createModuleRegistry([{...versionedOwner,version:1},{...versionedOwner,version:2}],capabilities);
  assert.ok(v2.get(source.id,2),'one module may retain ownership of the same table across pinned module versions');
  assert.equal(Object.isFrozen(moduleRegistry.get('real-estate.properties',1).dataOwnership),true);
  assert.equal(Object.isFrozen(moduleRegistry.get('sales.targets',1).dataOwnership.referencedTables[0]),true);
  assert.equal(moduleRegistry.get('core.business-settings',1).activation,'required');
  assert.equal(moduleRegistry.get('compat.training-center-v1',1).activation,'locked_compatibility');
});

test('existing navigation only exposes screens declared by the pinned category modules',()=>{
  const navigation=require('../modules/platform/navigation');
  const visible=category=>navigation.navigationFor({audience:'tenant',tenant:{id:'tenant-1',status:'active',categoryKey:category.key,categoryVersion:category.version},category,subscription:{status:'active',capabilities:category.capabilities},membership:{id:'member-1',tenantId:'tenant-1',status:'active',role:'owner',delegatedPermissions:[]}}).map(item=>item.key);
  const training=visible(trainingCenter),sales=visible(sevenNetworkSales),property=visible(realEstate),base=visible(baseCrm);
  assert.ok(training.includes('courses'));assert.equal(training.includes('sales-finance'),false);assert.equal(training.includes('recruitment'),false);
  assert.ok(sales.includes('products-services'));assert.ok(sales.includes('sales-deals'));assert.equal(sales.includes('courses'),false);assert.equal(sales.includes('properties'),false);
  assert.ok(property.includes('properties'));assert.equal(property.includes('products-services'),false);assert.equal(property.includes('courses'),false);
  assert.equal(base.includes('sales-deals'),false);assert.equal(base.includes('products-services'),false);assert.equal(base.includes('properties'),false);assert.equal(base.includes('courses'),false);
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
