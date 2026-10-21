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
  for(const value of [{...doc,tenantId:'other'},{...doc,schemaVersion:4},{...doc,disabledCapabilities:[]},{schemaVersion:1,navigationLabels:{recruitment:{en:'Recruitment',ar:'توظيف'}}},{schemaVersion:1,navigationLabels:{'products-services':{en:'Products',ar:'منتجات'}}},{schemaVersion:1,navigationLabels:{courses:{en:'<script>',ar:'الدورات'}}},JSON.parse('{"schemaVersion":1,"navigationLabels":{"__proto__":{"en":"x","ar":"x"}}}')])assert.throws(()=>settings.normalize(ctx,value));
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
test('schema 4 customizes only task types pinned to the active category and never grants plan access',()=>{
  const configured={schemaVersion:4,navigationLabels:{},leadFields:[],hiddenNavigation:[],enabledTaskTypes:['enrollment']};
  assert.deepEqual(settings.normalize(ctx,configured),configured);
  assert.throws(()=>settings.normalize(ctx,{...configured,enabledTaskTypes:['sales_call']}),{code:'INVALID_CUSTOMIZATION_TASK_TYPES'});
  const noPlan={...ctx,subscription:{status:'active',capabilities:['team.tasks']}};
  assert.deepEqual(settings.normalize(noPlan,configured),configured);
  assert.deepEqual(require('../modules/platform/task-type-adapters').available(noPlan,['enrollment']).map(item=>item.key),['general']);
  const sales={...ctx,tenant:{...ctx.tenant,categoryKey:'7network_sales'},category:salemaxSales};
  assert.throws(()=>settings.normalize(sales,{...configured,enabledTaskTypes:['enrollment']}),{code:'INVALID_CUSTOMIZATION_TASK_TYPES'});
  assert.deepEqual(require('../modules/platform/task-type-adapters').available(ctx,['enrollment']).map(item=>item.key),['lead_follow_up','general','enrollment']);
  assert.deepEqual(require('../modules/platform/task-type-adapters').available(sales,[]).map(item=>item.key),['lead_follow_up','general']);
});
test('schema 5 enables only exact modules pinned to this category and requires business settings',()=>{
  const registry=require('../modules/platform/categories').moduleRegistry;
  const all=ctx.category.modules.map(ref=>({ref,module:registry.get(ref.id,ref.version)})).filter(({module})=>module.activation!=='locked_compatibility').map(({ref})=>`${ref.id}@${ref.version}`);
  const configured={...settings.defaults(),enabledModules:all.filter(key=>key!=='core.inbox@1')};
  assert.deepEqual(settings.normalize(ctx,configured).enabledModules,[...configured.enabledModules].sort());
  for(const invalid of [
    {...configured,enabledModules:configured.enabledModules.filter(key=>key!=='core.business-settings@1')},
    {...configured,enabledModules:[...configured.enabledModules,'sales.deals@1']},
    {...configured,enabledModules:[...configured.enabledModules,'core.inbox@1','core.inbox@1']},
    {...configured,enabledModules:[...configured.enabledModules,'compat.training-center-v1@1']},
    {...configured,enabledModules:'core.business-settings@1'},
  ])assert.throws(()=>settings.normalize(ctx,invalid),{code:'INVALID_CUSTOMIZATION_MODULES'});
  const old={schemaVersion:4,navigationLabels:{},leadFields:[],hiddenNavigation:[],enabledTaskTypes:null};
  assert.deepEqual(settings.normalize(ctx,old),old,'schema 4 remains byte-for-byte compatible for revision checksums');
  const previousSchema={schemaVersion:5,navigationLabels:{},leadFields:[],hiddenNavigation:[],enabledTaskTypes:null,enabledModules:null};
  assert.deepEqual(settings.normalize(ctx,previousSchema),previousSchema,'schema 5 documents retain their exact shape and checksum');
  const previousRow={id:'revision-v5',kind:'published',category_key:'training_center',category_version:1,schema_version:5,revision:5,document:JSON.stringify(previousSchema),checksum:settings.checksum(previousSchema)};
  assert.deepEqual(settings.decode(ctx,previousRow).document,previousSchema,'published schema 5 checksum remains readable');
});
test('schema 6 accepts only bounded settings owned by the exact pinned module version',()=>{
  const propertyCtx={...ctx,tenant:{...ctx.tenant,categoryKey:'real_estate'},category:realEstate,subscription:{status:'active',capabilities:[...realEstate.capabilities]}};
  const all=realEstate.modules.map(ref=>`${ref.id}@${ref.version}`);
  const configured={...settings.defaults(),enabledModules:all,moduleSettings:{'real-estate.properties@1':{schemaVersion:1,defaultTransactionType:'rent',defaultCurrency:'AED'}}};
  const normalized=settings.normalize(propertyCtx,configured);
  assert.deepEqual(normalized,{...configured,enabledModules:[...all].sort()});
  assert.deepEqual(settings.moduleSettingsFor({...propertyCtx,moduleSettings:configured.moduleSettings},'real-estate.properties',1),{schemaVersion:2,defaultTransactionType:'rent',defaultCurrency:'AED',areaUnit:'sqm'});
  assert.deepEqual(settings.moduleSettingsFor(propertyCtx,'real-estate.properties',1),{schemaVersion:2,defaultTransactionType:'sale',defaultCurrency:'QAR',areaUnit:'sqm'});
  assert.throws(()=>settings.moduleSettingsFor({...propertyCtx,moduleSettings:{'real-estate.properties@1':{schemaVersion:1,defaultTransactionType:'admin',defaultCurrency:'QAR'}}},'real-estate.properties',1),{code:'INVALID_MODULE_SETTINGS'});
  for(const invalid of [
    {...configured,moduleSettings:{'real-estate.properties@2':configured.moduleSettings['real-estate.properties@1']}},
    {...configured,moduleSettings:{'sales.products-services@1':configured.moduleSettings['real-estate.properties@1']}},
    {...configured,moduleSettings:{'real-estate.properties@1':{...configured.moduleSettings['real-estate.properties@1'],defaultCurrency:'QAR;'}}},
    {...configured,moduleSettings:{'real-estate.properties@1':{...configured.moduleSettings['real-estate.properties@1'],admin:true}}},
    {...configured,moduleSettings:[]},
  ])assert.throws(()=>settings.normalize(propertyCtx,invalid),{code:'INVALID_CUSTOMIZATION_MODULE_SETTINGS'});
  const wrongPlan={...propertyCtx,subscription:{status:'active',capabilities:['tenant.settings']}};
  assert.deepEqual(settings.normalize(wrongPlan,configured),{...configured,enabledModules:[...all].sort()},'bounded preferences may be retained without granting plan access');
  assert.equal(require('../modules/platform/policy').decision({...wrongPlan,moduleSettings:configured.moduleSettings},{capability:'realestate.listings',permission:'properties.read'}).code,'FEATURE_UNAVAILABLE');
  const wrongCategory={...propertyCtx,tenant:{...propertyCtx.tenant,categoryKey:'training_center'},category:trainingCenter};
  assert.throws(()=>settings.normalize(wrongCategory,{...configured,enabledModules:null}),{code:'INVALID_CUSTOMIZATION_MODULE_SETTINGS'});
});
test('module setting schema upgrades are additive and keep historical revision checksums verifiable',()=>{
  const propertyCtx={...ctx,tenant:{...ctx.tenant,categoryKey:'real_estate'},category:realEstate,subscription:{status:'active',capabilities:[...realEstate.capabilities]}};
  const registry=require('../modules/platform/categories').moduleRegistry,module=registry.get('real-estate.properties',1),moduleSettings=require('../modules/platform/module-settings');
  assert.equal(module.configSchemaVersion,2);
  const schema1={schemaVersion:1,defaultTransactionType:'rent',defaultCurrency:'AED'};
  assert.deepEqual(moduleSettings.normalize(module,schema1),schema1,'stored schema 1 keeps its exact historical shape');
  assert.deepEqual(moduleSettings.migrate(module,schema1),{schemaVersion:2,defaultTransactionType:'rent',defaultCurrency:'AED',areaUnit:'sqm'});
  const configured=settings.normalize(propertyCtx,{...settings.defaults(),enabledModules:realEstate.modules.map(ref=>`${ref.id}@${ref.version}`),moduleSettings:{'real-estate.properties@1':schema1}});
  const row={id:'revision-v6-v1-settings',kind:'published',category_key:'real_estate',category_version:1,schema_version:6,revision:6,document:JSON.stringify(configured),checksum:settings.checksum(configured)};
  assert.deepEqual(settings.decode(propertyCtx,row).document,configured,'adding a module setting does not rewrite a published tenant revision');
  const option=settings.moduleSettingsOptions(propertyCtx,configured).find(item=>item.key==='real-estate.properties@1');
  assert.equal(option.schemaVersion,2);assert.deepEqual(option.values,{schemaVersion:2,defaultTransactionType:'rent',defaultCurrency:'AED',areaUnit:'sqm'});
  assert.deepEqual(moduleSettings.migrate(module,{schemaVersion:2,defaultTransactionType:'rent',defaultCurrency:'AED',areaUnit:'sqft'}),{schemaVersion:2,defaultTransactionType:'rent',defaultCurrency:'AED',areaUnit:'sqft'});
  assert.throws(()=>moduleSettings.migrate(module,{schemaVersion:1,defaultTransactionType:'rent',defaultCurrency:'AED',areaUnit:'sqft'}),{code:'INVALID_MODULE_SETTINGS'});
  assert.throws(()=>moduleSettings.migrate(module,{schemaVersion:2,defaultTransactionType:'rent',defaultCurrency:'AED',areaUnit:'admin'}),{code:'INVALID_MODULE_SETTINGS'});
});
test('module activation is tenant-scoped and composes with plan, category, and compatibility policy',()=>{
  const {decision}=require('../modules/platform/policy');
  const enabled=ctx.category.modules.map(ref=>`${ref.id}@${ref.version}`).filter(key=>key!=='core.inbox@1');
  const a={...ctx,enabledModules:enabled};
  const b={...ctx,tenant:{...ctx.tenant,id:'tenant-b'},membership:{...ctx.membership,tenantId:'tenant-b'},enabledModules:null};
  assert.deepEqual(decision(a,{capability:'messaging.inbox',permission:'conversations.read'}),{allowed:false,code:'MODULE_DISABLED'});
  assert.equal(decision(b,{capability:'messaging.inbox',permission:'conversations.read'}).allowed,true);
  assert.deepEqual(decision({...a,subscription:{status:'active',capabilities:[]}}, {capability:'messaging.inbox',permission:'conversations.read'}),{allowed:false,code:'FEATURE_UNAVAILABLE'});
  const compatibility={...ctx,enabledModules:['core.business-settings@1']};
  assert.equal(decision(compatibility,{capability:'sales.finance',permission:'sales.finance.read'}).allowed,true,'Training Center v1 historical compatibility grants remain available');
  const sales={...ctx,tenant:{...ctx.tenant,categoryKey:'7network_sales'},category:salemaxSales,subscription:{status:'active',capabilities:salemaxSales.capabilities},enabledModules:salemaxSales.modules.map(ref=>`${ref.id}@${ref.version}`).filter(key=>key!=='sales.recruitment@1')};
  assert.equal(decision(sales,{capability:'hr.recruitment',permission:'recruitment.manage'}).allowed,true,'internal first-party recruitment remains outside customer module toggles');
  assert.deepEqual(decision({...a,category:salemaxSales},{capability:'messaging.inbox',permission:'conversations.read'}),{allowed:false,code:'CATEGORY_UNAVAILABLE'});
});
test('activation loader is tenant-scoped and treats pre-schema-5 documents as category defaults',async()=>{
  const versions=new Map();
  const makeRow=(context,document,revision)=>({id:`00000000-0000-4000-8000-${String(revision).padStart(12,'0')}`,tenant_id:context.tenant.id,category_key:context.tenant.categoryKey,category_version:context.tenant.categoryVersion,schema_version:document.schemaVersion,revision,kind:'published',document:JSON.stringify(document),checksum:settings.checksum(document),created_at:'2026-10-21 00:00:00.000'});
  const modules=ctx.category.modules.map(ref=>({ref,module:require('../modules/platform/categories').moduleRegistry.get(ref.id,ref.version)})).filter(({module})=>module.activation!=='locked_compatibility').map(({ref})=>`${ref.id}@${ref.version}`);
  const aDoc=settings.normalize(ctx,{...settings.defaults(),enabledModules:modules.filter(key=>key!=='core.inbox@1')});
  versions.set('tenant-a',makeRow(ctx,aDoc,2));
  const bctx={...ctx,tenant:{...ctx.tenant,id:'tenant-b'},membership:{...ctx.membership,tenantId:'tenant-b'}};
  const oldDoc={schemaVersion:4,navigationLabels:{},leadFields:[],hiddenNavigation:[],enabledTaskTypes:null};
  versions.set('tenant-b',makeRow(bctx,oldDoc,1));
  const db={query:async(_sql,args)=>[[versions.get(args[0])||null]]};
  const a=await settings.withActivation(db,ctx),b=await settings.withActivation(db,bctx);
  assert.deepEqual(a.enabledModules,aDoc.enabledModules);
  assert.equal(b.enabledModules,null,'older published tenant configurations retain category defaults');
});
test('schema 6 module settings load only from the authenticated tenant revision',async()=>{
  const propertyContext=id=>({...ctx,tenant:{...ctx.tenant,id,categoryKey:'real_estate'},membership:{...ctx.membership,tenantId:id},category:realEstate,subscription:{status:'active',capabilities:[...realEstate.capabilities]}});
  const aContext=propertyContext('tenant-a'),bContext=propertyContext('tenant-b'),all=realEstate.modules.map(ref=>`${ref.id}@${ref.version}`).sort();
  const aDocument=settings.normalize(aContext,{...settings.defaults(),enabledModules:all,moduleSettings:{'real-estate.properties@1':{schemaVersion:1,defaultTransactionType:'rent',defaultCurrency:'AED'}}});
  const bDocument=settings.normalize(bContext,{...settings.defaults(),enabledModules:null,moduleSettings:{}});
  const rowFor=(context,document,revision)=>({id:`00000000-0000-4000-8000-${String(revision).padStart(12,'0')}`,tenant_id:context.tenant.id,category_key:'real_estate',category_version:1,schema_version:6,revision,kind:'published',document:JSON.stringify(document),checksum:settings.checksum(document),created_at:'2026-10-21 00:00:00.000'});
  const rows=new Map([['tenant-a',rowFor(aContext,aDocument,1)],['tenant-b',rowFor(bContext,bDocument,1)]]);
  const db={query:async(_sql,args)=>[[rows.get(args[0])||null]]};
  const a=await settings.withActivation(db,aContext),b=await settings.withActivation(db,bContext);
  assert.deepEqual(settings.moduleSettingsFor(a,'real-estate.properties',1),{schemaVersion:2,defaultTransactionType:'rent',defaultCurrency:'AED',areaUnit:'sqm'});
  assert.deepEqual(settings.moduleSettingsFor(b,'real-estate.properties',1),{schemaVersion:2,defaultTransactionType:'sale',defaultCurrency:'QAR',areaUnit:'sqm'});
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
test('tenant-disabled modules disappear from category navigation while defaults retain legacy visibility',()=>{
  const navigation=require('../modules/platform/navigation');
  const enabled=ctx.category.modules.map(ref=>`${ref.id}@${ref.version}`).filter(key=>key!=='training.core@1');
  assert.equal(navigation.supportsCategoryScreen(ctx.category,'courses'),true);
  assert.equal(navigation.supportsCategoryScreen(ctx.category,'courses',enabled),false);
  const visible=navigation.navigationFor({...ctx,enabledModules:enabled}).map(item=>item.key);
  assert.equal(visible.includes('courses'),false);
  assert.equal(visible.includes('inbox'),true);
  assert.equal(visible.includes('settings'),true);
});
