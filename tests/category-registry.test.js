'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createCategoryRegistry} = require('../modules/platform/category-registry');
const {capabilities} = require('../modules/platform/policy');
const {baseCrm,trainingCenter, sevenNetworkSales, restaurantFixture, listCategories} = require('../modules/platform/categories');

test('category registry pins versions instead of selecting latest implicitly', () => {
  const v2 = {...trainingCenter, version:2, conversationTransferLeadAdapter:'none', capabilities:trainingCenter.capabilities.filter(key => !['sales.finance','hr.recruitment'].includes(key))};
  const registry = createCategoryRegistry([trainingCenter,v2], capabilities);
  assert.ok(registry.get('training_center',1).capabilities.includes('sales.finance'));
  assert.equal(registry.get('training_center',2).capabilities.includes('sales.finance'),false);
  for (const version of [undefined,null,0,-1,1.5,'1',3]) assert.equal(registry.get('training_center',version),null);
  assert.deepEqual(registry.list().map(row=>row.version),[1,2]);
  assert.equal(registry.get('training_center',1).taskAssignmentScope,'workspace');
  assert.equal(registry.get('training_center',2).taskAssignmentScope,'workspace');
  assert.equal(registry.get('training_center',1).conversationTransferLeadAdapter,'whatsapp_inquiry_v1');
  assert.equal(registry.get('training_center',2).conversationTransferLeadAdapter,'none');
  assert.deepEqual(registry.get('training_center',1).qrSharing,{managerAgentScope:'tenant',accountantAccess:true});
  assert.equal(registry.get('training_center',2).qrSharing.accountantAccess,true);
  assert.equal(listCategories().some(row=>row.key===restaurantFixture.key&&row.planable===true),false);
  const salesRegistry=createCategoryRegistry([{...sevenNetworkSales}],capabilities);
  assert.equal(salesRegistry.get('7network_sales',1).key,'7network_sales');
  assert.equal(salesRegistry.get('7network_sales',1).taskAssignmentScope,'self');
  assert.equal(salesRegistry.get('7network_sales',1).qrSharing.accountantAccess,false);
  assert.deepEqual(salesRegistry.get('7network_sales',1).accessPolicy,sevenNetworkSales.accessPolicy);
});

test('registry rejects duplicate identity, unknown capabilities, invalid roles and malformed contracts', () => {
  assert.throws(()=>createCategoryRegistry([trainingCenter,trainingCenter],capabilities),{code:'INVALID_CATEGORY_MANIFEST'});
  for (const patch of [{version:'2'},{version:0},{key:'../clinic'},{title:{en:'Clinic'}},{public:'yes'},{taskWorkspaceLabel:'<bad>'},{taskWorkspaceLabel:' '},
    {planable:'yes'},{capabilities:['unknown.feature']},{capabilities:['messaging.inbox','messaging.inbox']},
    {seatRoles:['agent']},{seatRoles:['owner','super_admin']},{migration:'../schema.sql'},
    {chatbotLeadCapture:'unreviewed'},{chatbotLeadCapture:'generic',capabilities:['messaging.inbox']},
    {chatbotLeadCapture:'training',capabilities:['messaging.inbox','crm.leads']},
    {taskAssignmentScope:'tenant'},{taskAssignmentScope:'anyone'},
    {conversationTransferLeadAdapter:'unreviewed'},
    {conversationTransferLeadAdapter:'whatsapp_inquiry_v1',capabilities:['messaging.inbox','team.tasks']},
    {qrSharing:{managerAgentScope:'global'}},{qrSharing:{accountantAccess:'yes'}},
    {qrSharing:{managerAgentScope:'tenant'},capabilities:['messaging.inbox']},
    {qrSharing:{accountantAccess:true},capabilities:['messaging.inbox','messaging.qr']},
    {taskAdapters:{unreviewed_task:1}},{taskAdapters:{enrollment:2}},
    {inventoryAdapter:'unreviewed'},{inventoryAdapter:'retail_stock_ledger_v1',capabilities:baseCrm.capabilities},{inventoryAdapter:'retail_stock_ledger_v1',catalogue:null},
    {accessPolicy:{unknownPolicy:[]}},
    {accessPolicy:{planExemptOwnerCapabilities:['sales.deals']}},
    {accessPolicy:{deniedRolePermissions:{super_admin:['leads.read']}}},
    {accessPolicy:{deniedRolePermissions:{accountant:['leads.read']},capabilities:['crm.leads']}},
    {accessPolicy:{tenantRolePermissions:{manager:['not.a.permission']}}},
    {taskAdapters:{enrollment:1},capabilities:trainingCenter.capabilities.filter(key=>key!=='training.enrollments')}]) {
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

test('a future category can opt into reviewed QR delegation without category-name rules',()=>{
  const future={...baseCrm,key:'future_services',qrSharing:{managerAgentScope:'tenant',accountantAccess:true}};
  const manifest=createCategoryRegistry([future],capabilities).get('future_services',1);
  assert.deepEqual(manifest.qrSharing,{managerAgentScope:'tenant',accountantAccess:true});
  assert.equal(manifest.capabilities.includes('messaging.inbox'),true);
});

test('a future products category can opt into the reviewed retail inventory adapter',()=>{
  const future={...baseCrm,key:'future_grocery',catalogue:'products',inventoryAdapter:'retail_stock_ledger_v1',capabilities:[...baseCrm.capabilities,'products.catalog','retail.inventory']};
  const manifest=createCategoryRegistry([future],capabilities).get('future_grocery',1);
  assert.equal(manifest.inventoryAdapter,'retail_stock_ledger_v1');
  assert.ok(manifest.capabilities.includes('retail.inventory'));
});

test('reviewed role policy is copied and deeply immutable',()=>{
  const input={...baseCrm,key:'future_services',accessPolicy:{tenantRolePermissions:{manager:['team.invite']}}};
  const manifest=createCategoryRegistry([input],capabilities).get('future_services',1);
  input.accessPolicy.tenantRolePermissions.manager.push('channels.configure');
  assert.deepEqual(manifest.accessPolicy.tenantRolePermissions.manager,['team.invite']);
  assert.throws(()=>manifest.accessPolicy.tenantRolePermissions.manager.push('channels.configure'),TypeError);
});
