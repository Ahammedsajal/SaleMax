'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const settings=require('../modules/platform/tenant-customization');
const {trainingCenter,salemaxSales,realEstate}=require('../modules/platform/categories');
const ctx={audience:'tenant',identity:{id:'owner'},tenant:{id:'tenant-a',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'member',tenantId:'tenant-a',status:'active',role:'owner'},category:trainingCenter,subscription:{status:'active',capabilities:[...trainingCenter.capabilities]}};
const doc={schemaVersion:1,navigationLabels:{courses:{en:'Programmes',ar:'البرامج'}}};
test('label customization is bounded, category-scoped data rather than executable configuration',()=>{
  assert.deepEqual(settings.preview(ctx,doc),{readOnly:true,document:doc});
  const source=structuredClone(doc),normalized=settings.normalize(ctx,source);source.navigationLabels.courses.en='Changed';assert.equal(normalized.navigationLabels.courses.en,'Programmes');
  for(const value of [{...doc,tenantId:'other'},{...doc,schemaVersion:5},{...doc,disabledCapabilities:[]},{schemaVersion:1,navigationLabels:{recruitment:{en:'Recruitment',ar:'توظيف'}}},{schemaVersion:1,navigationLabels:{'products-services':{en:'Products',ar:'منتجات'}}},{schemaVersion:1,navigationLabels:{courses:{en:'<script>',ar:'الدورات'}}},JSON.parse('{"schemaVersion":1,"navigationLabels":{"__proto__":{"en":"x","ar":"x"}}}')])assert.throws(()=>settings.normalize(ctx,value));
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
  const v5={schemaVersion:5,navigationLabels:{},leadFields:[],hiddenNavigation:[],enabledTaskTypes:null,taskTypeLabels:{general:{en:'Other',ar:'أخرى'}}};
  assert.deepEqual(settings.decode(ctx,{...row,schema_version:5,document:JSON.stringify(v5),checksum:settings.checksum(v5)}).document,v5);
  const v6={schemaVersion:6,navigationLabels:{},leadFields:[],hiddenNavigation:[],enabledTaskTypes:null,taskTypeLabels:{},propertyFields:[]};
  const realEstateCtx={...ctx,tenant:{...ctx.tenant,categoryKey:'real_estate'},category:realEstate,subscription:{status:'active',capabilities:[...realEstate.capabilities]}};
  const propertyField={key:'pf_text_0123456789abcdef',type:'text',label:{en:'Parking spaces',ar:'مواقف السيارات'},required:false,active:true,version:1};
  const propertyDoc={...v6,propertyFields:[propertyField]};
  assert.deepEqual(settings.normalize(realEstateCtx,propertyDoc).propertyFields,[propertyField]);
  const propertyAgent={...realEstateCtx,membership:{...realEstateCtx.membership,role:'agent'}};
  assert.deepEqual(settings.normalize(propertyAgent,propertyDoc).propertyFields,[propertyField],'assigned agents must be able to read an owner-published field contract');
  assert.throws(()=>settings.normalize({...realEstateCtx,subscription:{...realEstateCtx.subscription,capabilities:[]}},propertyDoc),{code:'FEATURE_UNAVAILABLE'});
  assert.throws(()=>settings.normalize(ctx,{...v6,propertyFields:[propertyField]}),{code:'CATEGORY_UNAVAILABLE'});
  assert.throws(()=>settings.normalize(realEstateCtx,{...propertyDoc,propertyFields:[{...propertyField,key:'cf_text_0123456789abcdef'}]}),{code:'INVALID_PROPERTY_FIELD'});
  assert.deepEqual(settings.decode(realEstateCtx,{...row,category_key:'real_estate',schema_version:6,document:JSON.stringify(propertyDoc),checksum:settings.checksum(propertyDoc)}).document,propertyDoc);
  assert.throws(()=>settings.decode(ctx,{...row,checksum:'0'.repeat(64)}),{code:'CUSTOMIZATION_INTEGRITY_ERROR'});
  assert.throws(()=>settings.decode(ctx,{...row,category_version:2}),{code:'CUSTOMIZATION_VERSION_MISMATCH'});
});
test('schema 7 disables only reviewed category modules and policy blocks dependent APIs per tenant',()=>{
  const v6={schemaVersion:6,navigationLabels:{},leadFields:[],hiddenNavigation:[],enabledTaskTypes:null,taskTypeLabels:{},propertyFields:[]};
  const v7={...v6,schemaVersion:7,disabledModules:['training.courses']};
  assert.deepEqual(settings.normalize(ctx,v7),v7);
  for(const disabledModules of [['realestate.listings'],['tenant.settings'],['training.courses','training.courses'],['not-a-module']])assert.throws(()=>settings.normalize(ctx,{...v7,disabledModules}),{code:'INVALID_CUSTOMIZATION_MODULES'});
  const moduleOptions=require('../modules/platform/tenant-module-contract').options(ctx).map(item=>item.key);
  assert.ok(moduleOptions.includes('training.courses'));
  assert.ok(moduleOptions.includes('training.batches'));
  assert.ok(!moduleOptions.includes('products.catalog'));
  const policy=require('../modules/platform/policy');
  const tenantA=structuredClone(ctx),tenantB={...ctx,tenant:{...ctx.tenant,id:'tenant-b'},membership:{...ctx.membership,tenantId:'tenant-b'}};
  settings.attachRuntimeRestrictions(tenantA,v7);
  assert.deepEqual(tenantA.tenant.disabledModules,['training.courses']);
  assert.equal(Object.keys(tenantA.tenant).includes('disabledModules'),false,'runtime restrictions are not serialized into public tenant identity');
  assert.equal(policy.decision(tenantA,{capability:'training.courses',permission:'courses.read'}).code,'MODULE_DISABLED');
  assert.equal(policy.decision(tenantA,{capability:'training.enrollments',permission:'sales.request'}).code,'MODULE_DISABLED','enrollment APIs require the courses module');
  assert.equal(policy.decision(tenantB,{capability:'training.courses',permission:'courses.read'}).allowed,true,'another tenant keeps the category module');
  const withoutPlan={...tenantB,subscription:{status:'active',capabilities:[]}};
  settings.attachRuntimeRestrictions(withoutPlan,{...v7,disabledModules:[]});
  assert.equal(policy.decision(withoutPlan,{capability:'training.courses',permission:'courses.read'}).code,'FEATURE_UNAVAILABLE','module settings cannot grant plan access');
  assert.deepEqual(settings.normalize(ctx,v6),v6,'schema 6 revisions remain readable');
});
test('schema 8 stores entity field contracts in capability-checked scopes and reads legacy scoped documents',()=>{
  const scopes=require('../modules/platform/custom-field-scope-registry');
  const leadField={key:'cf_text_0123456789abcdef',type:'text',label:{en:'Account code',ar:'رمز الحساب'},required:false,active:true,version:1};
  const propertyField={key:'pf_text_0123456789abcdef',type:'text',label:{en:'Facing direction',ar:'اتجاه الإطلالة'},required:false,active:true,version:1};
  const v8={schemaVersion:8,navigationLabels:{},customFieldScopes:{lead:[leadField]},hiddenNavigation:[],enabledTaskTypes:null,taskTypeLabels:{},disabledModules:[]};
  assert.deepEqual(settings.normalize(ctx,v8),v8);
  assert.deepEqual(scopes.available(ctx).map(scope=>scope.key),['lead']);
  const realEstateCtx={...ctx,tenant:{...ctx.tenant,categoryKey:'real_estate'},category:realEstate,subscription:{status:'active',capabilities:[...realEstate.capabilities]}};
  const propertyDoc={...v8,customFieldScopes:{lead:[],property:[propertyField]}};
  assert.deepEqual(settings.normalize(realEstateCtx,propertyDoc),propertyDoc);
  assert.deepEqual(require('../modules/platform/custom-field-contract').publicContract({revision:4,document:propertyDoc},'property').fields,[propertyField]);
  const propertyAgent={...realEstateCtx,membership:{...realEstateCtx.membership,role:'agent'}};
  assert.equal(scopes.available(propertyAgent).find(scope=>scope.key==='property').editable,false);
  assert.throws(()=>settings.normalize(realEstateCtx,{...propertyDoc,customFieldScopes:{lead:[]}}),{code:'INVALID_CUSTOM_FIELD_SCOPES'});
  assert.throws(()=>settings.normalize(ctx,{...v8,customFieldScopes:{lead:[],property:[propertyField]}}),{code:'CATEGORY_UNAVAILABLE'});
  assert.throws(()=>settings.normalize(ctx,{...v8,customFieldScopes:{lead:[],clinical:[leadField]}}),{code:'INVALID_CUSTOM_FIELD_SCOPE'});
  assert.throws(()=>settings.normalize({...realEstateCtx,subscription:{status:'active',capabilities:[]}},propertyDoc),{code:'FEATURE_UNAVAILABLE'});
  const row={id:'revision-v8',kind:'published',category_key:'real_estate',category_version:1,schema_version:8,revision:1,document:JSON.stringify(propertyDoc),checksum:settings.checksum(propertyDoc)};
  assert.deepEqual(settings.decode(realEstateCtx,row).document,propertyDoc);
  const noListingPlan={...realEstateCtx,subscription:{status:'active',capabilities:realEstate.capabilities.filter(capability=>capability!=='realestate.listings')}};
  assert.deepEqual(settings.decode(noListingPlan,row).document,propertyDoc,'plan removal preserves a valid saved configuration for runtime reads');
  const propertyScope=scopes.available(noListingPlan).find(scope=>scope.key==='property');
  assert.equal(propertyScope.planAvailable,false);assert.equal(propertyScope.editable,false);
  assert.deepEqual(settings.preview(noListingPlan,propertyDoc,propertyDoc),{document:propertyDoc,readOnly:true},'unrelated settings remain previewable while inaccessible fields are preserved');
  assert.throws(()=>settings.preview(noListingPlan,{...propertyDoc,customFieldScopes:{lead:[],property:[]}},propertyDoc),{code:'FEATURE_UNAVAILABLE'});
  assert.ok(Object.hasOwn(settings.defaults(noListingPlan).customFieldScopes,'property'),'category scope remains in defaults for backward-safe round trips');
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
test('schema 4 enables only reviewed category task types and preserves legacy configuration schemas',()=>{
  const doc4={schemaVersion:4,navigationLabels:{},leadFields:[],hiddenNavigation:[],enabledTaskTypes:['enrollment','invoice_follow_up']};
  assert.deepEqual(settings.normalize(ctx,doc4),doc4);
  assert.throws(()=>settings.normalize(ctx,{...doc4,enabledTaskTypes:['sales_call']}),{code:'INVALID_CUSTOMIZATION_TASK_TYPES'});
  assert.throws(()=>settings.normalize(ctx,{...doc4,enabledTaskTypes:['enrollment','enrollment']}),{code:'INVALID_CUSTOMIZATION_TASK_TYPES'});
  assert.deepEqual(settings.normalize(ctx,{schemaVersion:3,navigationLabels:{},leadFields:[],hiddenNavigation:[]}),{schemaVersion:3,navigationLabels:{},leadFields:[],hiddenNavigation:[]});
});
test('schema 5 personalizes only reviewed task labels for this tenant and category',()=>{
  const labels={general:{en:'Other work',ar:'أعمال أخرى'},enrollment:{en:'New learner',ar:'متدرب جديد'}};
  const doc5={schemaVersion:5,navigationLabels:{},leadFields:[],hiddenNavigation:[],enabledTaskTypes:['enrollment'],taskTypeLabels:labels};
  assert.deepEqual(settings.normalize(ctx,doc5),doc5);
  for(const taskTypeLabels of [
    {...labels,sales_call:{en:'Sales call',ar:'مكالمة مبيعات'}},
    {enrollment:{en:'Only English',ar:''}},
    {enrollment:{en:'<script>',ar:'متدرب'}},
    JSON.parse('{"__proto__":{"en":"Injected","ar":"حقن"}}')
  ])assert.throws(()=>settings.normalize(ctx,{...doc5,taskTypeLabels}),{code:'INVALID_CUSTOMIZATION_TASK_LABELS'});
  const taskAdapters=require('../modules/platform/task-type-adapters');
  const tenantA={...ctx,customization:{document:doc5}},tenantB={...ctx,tenant:{...ctx.tenant,id:'tenant-b'},membership:{...ctx.membership,tenantId:'tenant-b'}};
  assert.equal(taskAdapters.available(tenantA,doc5.enabledTaskTypes).find(item=>item.key==='enrollment').label.en,'New learner');
  assert.equal(taskAdapters.available(tenantB).find(item=>item.key==='enrollment').label.en,'Enrollment');
  assert.deepEqual(settings.normalize(ctx,{schemaVersion:4,navigationLabels:{},leadFields:[],hiddenNavigation:[],enabledTaskTypes:null}),{schemaVersion:4,navigationLabels:{},leadFields:[],hiddenNavigation:[],enabledTaskTypes:null});
});
test('existing workspace customizer collects bilingual task labels into the tenant draft',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const client=fs.readFileSync(path.join(__dirname,'../client/public/tenant-customization.js'),'utf8');
  const shell=fs.readFileSync(path.join(__dirname,'../client/public/index.html'),'utf8');
  assert.match(client,/schemaVersion:8[\s\S]*customFieldScopes[\s\S]*disabledModules/);
  assert.match(client,/for\(const scope of state\.customFieldScopes\|\|\[\]\)/);
  assert.match(client,/taskTypeLabels/);
  assert.match(client,/Use your business names for tasks/);
  assert.match(client,/data-task-label-en/);
  assert.match(client,/data-task-label-ar/);
  assert.match(client,/Changes stay in the draft until you publish/);
  assert.match(shell,/lead-field-editor\.js\?v=20261022-field-scopes1/);
  assert.match(shell,/tenant-customization\.js\?v=20261022-field-scopes1/);
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
