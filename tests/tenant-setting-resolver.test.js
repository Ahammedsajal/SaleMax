'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {resolve}=require('../modules/platform/tenant-setting-resolver');

const context={categoryKey:'base_crm',categoryVersion:2,tenantRevision:9};

test('settings resolve platform, category-version, then tenant values with per-value provenance',()=>{
  const result=resolve({
    ...context,
    platform:{labels:{inbox:{en:'Inbox',ar:'الوارد'}},features:{tasks:true},fields:['platform']},
    category:{labels:{inbox:{en:'Conversations'},pipeline:{en:'Pipeline',ar:'المبيعات'}},fields:['category']},
    tenant:{labels:{inbox:{ar:'الرسائل'}},features:{tasks:false},fields:[]},
  });
  assert.deepEqual(result.value,{labels:{inbox:{en:'Conversations',ar:'الرسائل'},pipeline:{en:'Pipeline',ar:'المبيعات'}},features:{tasks:false},fields:[]});
  assert.deepEqual(result.provenance['labels.inbox.en'],{scope:'category_version',categoryKey:'base_crm',categoryVersion:2});
  assert.deepEqual(result.provenance['labels.inbox.ar'],{scope:'tenant',revision:9});
  assert.deepEqual(result.provenance['features.tasks'],{scope:'tenant',revision:9});
  assert.deepEqual(result.provenance.fields,{scope:'tenant',revision:9});
  assert.deepEqual(result.provenance['labels.pipeline.ar'],{scope:'category_version',categoryKey:'base_crm',categoryVersion:2});
});

test('null object members are tombstones, omitted keys inherit, and lists replace atomically',()=>{
  const result=resolve({
    ...context,
    platform:{labels:{keep:'base',remove:'base'},modules:['inbox','tasks']},
    category:{labels:{remove:'category'},modules:['inbox','pipeline']},
    tenant:{labels:{remove:null},modules:[]},
  });
  assert.deepEqual(result.value,{labels:{keep:'base'},modules:[]});
  assert.deepEqual(result.deleted['labels.remove'],{scope:'tenant',revision:9});
  assert.equal(result.provenance['labels.keep'].scope,'platform');
  assert.equal(result.provenance.modules.scope,'tenant');
});

test('replacing a nested object with a list clears stale descendant provenance',()=>{
  const result=resolve({...context,platform:{setting:{legacy:'value'}},category:{},tenant:{setting:[]}});
  assert.deepEqual(result.value,{setting:[]});
  assert.equal(result.provenance.setting.scope,'tenant');
  assert.equal(Object.hasOwn(result.provenance,'setting.legacy'),false);
});

test('resolver rejects malformed layers and missing layer identity metadata',()=>{
  assert.throws(()=>resolve({...context,platform:[]}),{code:'INVALID_SETTING_LAYER'});
  assert.throws(()=>resolve({...context,platform:JSON.parse('{"__proto__":{"unsafe":true}}')}),{code:'INVALID_SETTING_LAYER'});
  assert.throws(()=>resolve({...context,platform:{'ambiguous.path':true}}),{code:'INVALID_SETTING_LAYER'});
  assert.throws(()=>resolve({platform:{},category:{x:1},tenant:{}}),{code:'INVALID_SETTING_LAYER'});
  assert.throws(()=>resolve({...context,tenantRevision:-1,platform:{},category:{},tenant:{}}),{code:'INVALID_SETTING_LAYER'});
});
