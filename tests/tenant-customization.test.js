'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const settings=require('../modules/platform/tenant-customization');
const {trainingCenter,salemaxSales}=require('../modules/platform/categories');
const ctx={audience:'tenant',identity:{id:'owner'},tenant:{id:'tenant-a',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'member',tenantId:'tenant-a',status:'active',role:'owner'},category:trainingCenter,subscription:{status:'active',capabilities:[...trainingCenter.capabilities]}};
const doc={schemaVersion:1,navigationLabels:{courses:{en:'Programmes',ar:'البرامج'}}};
test('label customization is bounded, category-scoped data rather than executable configuration',()=>{
  assert.deepEqual(settings.preview(ctx,doc),{readOnly:true,document:doc});
  const source=structuredClone(doc),normalized=settings.normalize(ctx,source);source.navigationLabels.courses.en='Changed';assert.equal(normalized.navigationLabels.courses.en,'Programmes');
  for(const value of [{...doc,tenantId:'other'},{...doc,schemaVersion:2},{...doc,disabledCapabilities:[]},{schemaVersion:1,navigationLabels:{recruitment:{en:'Recruitment',ar:'توظيف'}}},{schemaVersion:1,navigationLabels:{'products-services':{en:'Products',ar:'منتجات'}}},{schemaVersion:1,navigationLabels:{courses:{en:'<script>',ar:'الدورات'}}},JSON.parse('{"schemaVersion":1,"navigationLabels":{"__proto__":{"en":"x","ar":"x"}}}')])assert.throws(()=>settings.normalize(ctx,value));
  assert.throws(()=>settings.normalize({...ctx,category:salemaxSales},{schemaVersion:1,navigationLabels:{courses:{en:'Courses',ar:'دورات'}}}),{code:'INVALID_CUSTOMIZATION_LABEL'});
});
test('preview cannot grant access and denied staff never reach persistence',async()=>{
  const db={query(){throw Error('must not access database')}};
  for(const role of ['manager','accountant','agent']){
    const denied={...ctx,membership:{...ctx.membership,role}};
    assert.throws(()=>settings.preview(denied,doc),{code:'PERMISSION_DENIED'});
    await assert.rejects(settings.state(db,denied),{code:'PERMISSION_DENIED'});
  }
  await assert.rejects(settings.state(db,{...ctx,membership:{...ctx.membership,tenantId:'foreign'}}),{code:'TENANT_CONTEXT_INVALID'});
});
test('saved revisions must match tenant category version and canonical checksum',()=>{
  const row={id:'revision',kind:'published',category_key:'training_center',category_version:1,schema_version:1,revision:1,document:JSON.stringify(doc),checksum:settings.checksum(doc)};
  assert.deepEqual(settings.decode(ctx,row).document,doc);
  assert.throws(()=>settings.decode(ctx,{...row,checksum:'0'.repeat(64)}),{code:'CUSTOMIZATION_INTEGRITY_ERROR'});
  assert.throws(()=>settings.decode(ctx,{...row,category_version:2}),{code:'CUSTOMIZATION_VERSION_MISMATCH'});
});
