'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const settings=require('../modules/platform/tenant-customization');
const {trainingCenter,salemaxSales}=require('../modules/platform/categories');
const ctx={audience:'tenant',identity:{id:'owner'},tenant:{id:'tenant-a',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'member',tenantId:'tenant-a',status:'active',role:'owner'},category:trainingCenter,subscription:{status:'active',capabilities:[...trainingCenter.capabilities]}};
const doc={schemaVersion:1,navigationLabels:{courses:{en:'Programmes',ar:'البرامج'}}};
test('label customization is bounded, category-scoped data rather than executable configuration',()=>{
  const preview=settings.preview(ctx,doc);
  assert.deepEqual(preview.document,doc);assert.equal(preview.readOnly,true);
  assert.equal(preview.resolved.value.navigationLabels.courses.en,'Programmes');
  assert.deepEqual(preview.resolved.provenance['navigationLabels.courses.en'],{scope:'tenant',revision:0});
  assert.deepEqual(settings.resolved(ctx,null,0).provenance['navigationLabels.courses.en'],{scope:'platform'});
  const categorized={...ctx,category:{...ctx.category,customizationDefaults:{schemaVersion:3,navigationLabels:{courses:{en:'Learning',ar:'التعلم'}},leadFields:[],hiddenNavigation:[]}}};
  const inherited=settings.resolved(categorized,{schemaVersion:3,navigationLabels:{},leadFields:[],hiddenNavigation:[]},2);
  assert.equal(inherited.value.navigationLabels.courses.en,'Learning');
  assert.deepEqual(inherited.provenance['navigationLabels.courses.en'],{scope:'category_version',categoryKey:'training_center',categoryVersion:1});
  assert.throws(()=>settings.resolved({...ctx,category:{...ctx.category,customizationDefaults:{schemaVersion:3,navigationLabels:{},leadFields:[],hiddenNavigation:['not-a-category-key']}}},null,0),{code:'CUSTOMIZATION_CATEGORY_DEFAULT_INVALID',status:503});
  assert.throws(()=>settings.resolved({...ctx,category:{...ctx.category,customizationDefaults:{schemaVersion:3,navigationLabels:{},leadFields:[{key:'cf_text_0123456789abcdef',type:'text',label:{en:'Reference',ar:'مرجع'},required:false,active:true,version:1}],hiddenNavigation:[]}}},null,0),{code:'CUSTOMIZATION_CATEGORY_DEFAULT_INVALID',status:503});
  const source=structuredClone(doc),normalized=settings.normalize(ctx,source);source.navigationLabels.courses.en='Changed';assert.equal(normalized.navigationLabels.courses.en,'Programmes');
  assert.throws(()=>settings.normalize({...ctx,tenant:{...ctx.tenant,categoryVersion:2}},doc),{code:'CUSTOMIZATION_VERSION_MISMATCH'});
  for(const value of [{...doc,tenantId:'other'},{...doc,schemaVersion:4},{...doc,disabledCapabilities:[]},{schemaVersion:1,navigationLabels:{recruitment:{en:'Recruitment',ar:'توظيف'}}},{schemaVersion:1,navigationLabels:{'products-services':{en:'Products',ar:'منتجات'}}},{schemaVersion:1,navigationLabels:{courses:{en:'<script>',ar:'الدورات'}}},JSON.parse('{"schemaVersion":1,"navigationLabels":{"__proto__":{"en":"x","ar":"x"}}}')])assert.throws(()=>settings.normalize(ctx,value));
  assert.throws(()=>settings.normalize({...ctx,tenant:{...ctx.tenant,categoryKey:salemaxSales.key,categoryVersion:salemaxSales.version},category:salemaxSales},{schemaVersion:1,navigationLabels:{courses:{en:'Courses',ar:'دورات'}}}),{code:'INVALID_CUSTOMIZATION_LABEL'});
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
test('runtime effective settings resolve the published tenant overlay over platform labels',async()=>{
  const published={schemaVersion:1,navigationLabels:{courses:{en:'Programs',ar:'البرامج'}}};
  const row={id:'revision',kind:'published',category_key:'training_center',category_version:1,schema_version:1,revision:4,document:JSON.stringify(published),checksum:settings.checksum(published)};
  const db={query:async sql=>sql.includes('FROM sx_tenant_customization_heads')?[[{revision:4,active_id:'revision'}]]:[[row]]};
  const effective=await settings.effective(db,ctx);
  assert.equal(effective.revision,4);assert.equal(effective.document.navigationLabels.courses.en,'Programs');assert.equal(effective.document.navigationLabels.inbox.en,'Inbox');
});
test('schema 3 hides only category-owned navigation keys while schema 1 and 2 remain readable',()=>{
  const doc3={schemaVersion:3,navigationLabels:{},leadFields:[],hiddenNavigation:['courses','inbox']};
  assert.deepEqual(settings.normalize(ctx,doc3),doc3);
  assert.throws(()=>settings.normalize(ctx,{...doc3,hiddenNavigation:['recruitment']}),{code:'INVALID_CUSTOMIZATION_NAVIGATION'});
  assert.throws(()=>settings.normalize(ctx,{...doc3,hiddenNavigation:['courses','courses']}),{code:'INVALID_CUSTOMIZATION_NAVIGATION'});
  const doc2={schemaVersion:2,navigationLabels:{},leadFields:[]};
  assert.deepEqual(settings.normalize(ctx,doc2),doc2);
  const rows=[{key:'inbox'},{key:'courses'},{key:'tasks'}];
  assert.deepEqual(settings.visibleNavigation(rows,doc3),[{key:'tasks'}]);
  assert.deepEqual(settings.visibleNavigation(rows,{schemaVersion:2}),rows);
});
test('published hidden navigation affects only the current tenant session contract',async()=>{
  const contract=require('../modules/platform/feature-contract'),customization=require('../modules/platform/tenant-customization');
  const original=customization.effective;
  try{
    customization.effective=async(_db,context)=>({revision:8,document:{schemaVersion:3,navigationLabels:{courses:{en:'Learning',ar:'التعلم'}},leadFields:[],hiddenNavigation:context.tenant.id==='tenant-a'?['courses']:[]}});
    const a=await contract.describeWithNavigation({}, {context:ctx}),b=await contract.describeWithNavigation({}, {context:{...ctx,tenant:{...ctx.tenant,id:'tenant-b'},membership:{...ctx.membership,tenantId:'tenant-b'}}});
    assert.equal(a.roleNavigation.includes('courses'),false);
    assert.equal(a.navigationLabels.courses,undefined);
    assert.equal(b.roleNavigation.includes('courses'),true);
    assert.equal(b.navigationLabels.courses.en,'Learning');
  }finally{customization.effective=original;}
});
