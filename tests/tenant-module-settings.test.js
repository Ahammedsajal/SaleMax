'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {copySchema,defaults,normalize}=require('../modules/platform/tenant-module-settings');
const {createCategoryRegistry}=require('../modules/platform/category-registry');
const capabilities=require('../modules/platform/policy').capabilities;
const customization=require('../modules/platform/tenant-customization');
const baseCategory=require('../modules/platform/categories').baseCrm;

const schema={moduleSettings:{pipeline:{capability:'crm.leads',fields:[
  {key:'enabled',type:'boolean',label:{en:'Lead reminders',ar:'تذكيرات العملاء المحتملين'},default:false},
  {key:'days',type:'integer',label:{en:'Reminder days',ar:'أيام التذكير'},min:0,max:30,default:7},
  {key:'priority',type:'enum',label:{en:'Default priority',ar:'الأولوية الافتراضية'},default:'normal',options:[{key:'normal',label:{en:'Normal',ar:'عادي'}},{key:'high',label:{en:'High',ar:'مرتفع'}}]},
  {key:'intro',type:'text',label:{en:'Lead note',ar:'ملاحظة العميل'},default:'',maxLength:80},
]}}};
const clean=()=>copySchema(structuredClone(schema),baseCategory.capabilities);

test('category module setting schemas are bounded, immutable and tied to category capabilities',()=>{
  const copied=clean();assert.equal(Object.isFrozen(copied.moduleSettings.pipeline.fields[0]),true);
  assert.deepEqual(defaults(copied),{pipeline:{enabled:false,days:7,priority:'normal',intro:''}});
  const manifest={...baseCategory,customizationSchema:schema};
  const registered=createCategoryRegistry([manifest],capabilities).get(baseCategory.key,baseCategory.version);
  assert.equal(registered.customizationSchema.moduleSettings.pipeline.capability,'crm.leads');
  assert.throws(()=>{registered.customizationSchema.moduleSettings.pipeline.fields[0].default=true;},TypeError);
  for(const invalid of [
    {moduleSettings:{pipeline:{capability:'crm.leads',fields:[{...schema.moduleSettings.pipeline.fields[0],key:'invalid key'}]}}},
    {moduleSettings:{pipeline:{capability:'crm.leads',fields:[{...schema.moduleSettings.pipeline.fields[0],key:'constructor'}]}}},
    {moduleSettings:{pipeline:{capability:'sales.deals',fields:[schema.moduleSettings.pipeline.fields[0]]}}},
    {moduleSettings:{pipeline:{capability:'crm.leads',fields:[{...schema.moduleSettings.pipeline.fields[0],default:'yes'}]}}},
    {moduleSettings:{pipeline:{capability:'crm.leads',fields:[{...schema.moduleSettings.pipeline.fields[1],min:8,max:2}]}}},
    {moduleSettings:{pipeline:{capability:'crm.leads',fields:[{...schema.moduleSettings.pipeline.fields[0],label:{en:'<b>unsafe</b>',ar:'غير آمن'}}]}}},
  ])assert.throws(()=>copySchema(invalid,baseCategory.capabilities),{code:'INVALID_CUSTOMIZATION_MODULE_SETTINGS'});
  assert.throws(()=>createCategoryRegistry([{...manifest,capabilities:manifest.capabilities.filter(item=>item!=='tenant.settings')}],capabilities),{code:'INVALID_CATEGORY_MANIFEST'});
  assert.throws(()=>createCategoryRegistry([{...manifest,customizationDefaults:{schemaVersion:6,moduleSettings:{pipeline:{days:31}}}}],capabilities),{code:'INVALID_CATEGORY_MANIFEST'});
});

test('tenant values are typed, bounded, sparse overrides and preserve false and zero',()=>{
  const copied=clean();
  assert.deepEqual(normalize({pipeline:{enabled:false,days:0,priority:'high',intro:'Call after 5'}},copied),{pipeline:{enabled:false,days:0,priority:'high',intro:'Call after 5'}});
  assert.deepEqual(normalize({},copied),{});
  for(const input of [
    {pipeline:{unknown:true}},
    {other:{enabled:true}},
    {pipeline:{enabled:'false'}},
    {pipeline:{days:31}},
    {pipeline:{priority:'urgent'}},
    {pipeline:{intro:'x'.repeat(81)}},
    JSON.parse('{"__proto__":{"enabled":true}}'),
  ])assert.throws(()=>normalize(input,copied),{code:'INVALID_CUSTOMIZATION_MODULE_SETTINGS'});
});

test('tenant module settings resolve with source provenance and do not modify capabilities',()=>{
  const category={...baseCategory,customizationSchema:clean()};
  const ctx={audience:'tenant',identity:{id:'owner'},tenant:{id:'tenant-a',status:'active',categoryKey:category.key,categoryVersion:category.version},membership:{id:'member',tenantId:'tenant-a',status:'active',role:'owner'},category,subscription:{status:'active',capabilities:[...category.capabilities]}};
  const inherited=customization.resolved(ctx,null,0);
  assert.deepEqual(inherited.value.moduleSettings.pipeline,{enabled:false,days:7,priority:'normal',intro:''});
  assert.deepEqual(inherited.provenance['moduleSettings.pipeline.days'],{scope:'category_version',categoryKey:'base_crm',categoryVersion:1});
  const document=customization.normalize(ctx,{schemaVersion:6,navigationLabels:{},hiddenNavigation:[],stageLabels:{},moduleSettings:{pipeline:{enabled:true,days:0}}});
  const result=customization.resolved(ctx,document,4);
  assert.equal(result.value.moduleSettings.pipeline.enabled,true);
  assert.equal(result.value.moduleSettings.pipeline.days,0);
  assert.equal(result.value.moduleSettings.pipeline.priority,'normal');
  assert.deepEqual(result.provenance['moduleSettings.pipeline.enabled'],{scope:'tenant',revision:4});
  assert.deepEqual(result.provenance['moduleSettings.pipeline.priority'],{scope:'category_version',categoryKey:'base_crm',categoryVersion:1});
  assert.deepEqual(ctx.subscription.capabilities,[...category.capabilities]);
  assert.throws(()=>customization.normalize(ctx,{schemaVersion:6,navigationLabels:{},hiddenNavigation:[],stageLabels:{},moduleSettings:{pipeline:{days:31}}}),{code:'INVALID_CUSTOMIZATION_MODULE_SETTINGS'});
  const legacy={schemaVersion:5,navigationLabels:{},leadFields:[],hiddenNavigation:[],stageLabels:{}};
  assert.deepEqual(customization.decode(ctx,{category_key:'base_crm',category_version:1,schema_version:5,document:JSON.stringify(legacy),checksum:customization.checksum(legacy)}).document,legacy);
  assert.equal(customization.defaults().schemaVersion,5,'untouched business configurations keep the compatible schema');
});

test('existing settings editor renders and submits typed module settings without granting access',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const editor=fs.readFileSync(path.join(__dirname,'../client/public/tenant-customization.js'),'utf8');
  assert.match(editor,/state\.moduleSettingsSchema/);assert.match(editor,/data-module-override/);assert.match(editor,/type==='integer'\?Number\(input\.value\)/);assert.match(editor,/hasModuleSettings\?6:5/);assert.match(editor,/hasModuleSettings\?\{moduleSettings\}:\{\}/);
  assert.match(editor,/never grant plan features or member permissions/);
});
