'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const adapters=require('../modules/platform/task-type-adapters');
const {trainingCenter,sevenNetworkSales,baseCrm}=require('../modules/platform/categories');

const context=(category,capabilities=category.capabilities)=>({
  tenant:{id:'tenant-a',status:'active',categoryKey:category.key,categoryVersion:category.version},
  category,subscription:{status:'active',capabilities:[...capabilities]},
});

test('task adapter options are selected by immutable category version and current plan',()=>{
  const training=adapters.available(context(trainingCenter));
  assert.deepEqual(training.map(item=>item.key),['lead_follow_up','general','invoice_follow_up','enrollment']);
  assert.deepEqual(adapters.available(context(sevenNetworkSales,sevenNetworkSales.capabilities.filter(key=>key!=='telephony.call-center'))).map(item=>item.key),['lead_follow_up','general']);
  assert.deepEqual(adapters.available(context(sevenNetworkSales)).map(item=>item.key),['lead_follow_up','general','sales_call']);
  assert.deepEqual(adapters.available(context(baseCrm)).map(item=>item.key),['lead_follow_up','general']);
});

test('tenant task choices can only hide reviewed types and cannot grant plan or category authority',()=>{
  assert.deepEqual(adapters.available(context(trainingCenter),['enrollment']).map(item=>item.key),['lead_follow_up','general','enrollment']);
  assert.equal(adapters.supports(context(sevenNetworkSales,sevenNetworkSales.capabilities.filter(key=>key!=='telephony.call-center')),'sales_call'),false);
  assert.throws(()=>adapters.validate(context(trainingCenter),'sales_call',{}),{code:'INVALID_TASK_TYPE'});
  assert.throws(()=>adapters.validate(context(sevenNetworkSales),'sales_call',{sourceType:'lead',linked:{leadId:'lead-a'},participants:[]}),{code:'TASK_ASSIGNEE_REQUIRED'});
});
