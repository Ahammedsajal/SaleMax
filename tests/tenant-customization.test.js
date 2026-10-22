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
  const categoryField={key:'cf_text_0123456789abcdef',type:'text',label:{en:'Reference',ar:'مرجع'},required:false,active:true,version:1};
  const withCategoryField={...ctx,category:{...ctx.category,customizationDefaults:{schemaVersion:3,navigationLabels:{},leadFields:[categoryField],hiddenNavigation:[]}}};
  const inheritedField=settings.resolved(withCategoryField,null,0);
  assert.deepEqual(inheritedField.value.leadFields,[categoryField]);
  assert.deepEqual(inheritedField.provenance.leadFields,{scope:'category_version',categoryKey:'training_center',categoryVersion:1});
  const replaced=settings.resolved(withCategoryField,{schemaVersion:3,navigationLabels:{},leadFields:[],hiddenNavigation:[]},2);
  assert.deepEqual(replaced.value.leadFields,[]);
  assert.deepEqual(replaced.provenance.leadFields,{scope:'tenant',revision:2});
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
  const inheritedFields={schemaVersion:3,navigationLabels:{},hiddenNavigation:[]};
  assert.deepEqual(settings.normalize(ctx,inheritedFields),inheritedFields,'omitted leadFields inherit category defaults');
  assert.throws(()=>settings.normalize(ctx,{...doc3,hiddenNavigation:['recruitment']}),{code:'INVALID_CUSTOMIZATION_NAVIGATION'});
  assert.throws(()=>settings.normalize(ctx,{...doc3,hiddenNavigation:['courses','courses']}),{code:'INVALID_CUSTOMIZATION_NAVIGATION'});
  const doc2={schemaVersion:2,navigationLabels:{},leadFields:[]};
  assert.deepEqual(settings.normalize(ctx,doc2),doc2);
  const rows=[{key:'inbox'},{key:'courses'},{key:'tasks'}];
  assert.deepEqual(settings.visibleNavigation(rows,doc3),[{key:'tasks'}]);
  assert.deepEqual(settings.visibleNavigation(rows,{schemaVersion:2}),rows);
});
test('schema 4 resolves and validates bilingual Pipeline stage labels without changing stage identity',()=>{
  const category={...ctx.category,customizationDefaults:{schemaVersion:4,navigationLabels:{},leadFields:[],hiddenNavigation:[],stageLabels:{training_invoice_issued:{en:'Invoice issued',ar:'صدرت الفاتورة'}}}};
  const scoped={...ctx,category};
  const tenant={schemaVersion:4,navigationLabels:{},hiddenNavigation:[],stageLabels:{training_invoice_issued:{en:'Contract signed',ar:'تم توقيع العقد'}}};
  const resolved=settings.resolved(scoped,tenant,5);
  assert.equal(resolved.value.stageLabels.training_invoice_issued.en,'Contract signed');
  assert.equal(resolved.value.stageLabels.training_invoice_issued.ar,'تم توقيع العقد');
  assert.deepEqual(resolved.provenance['stageLabels.training_invoice_issued.en'],{scope:'tenant',revision:5});
  assert.throws(()=>settings.normalize(scoped,{...tenant,stageLabels:{'bad key':{en:'A',ar:'ب'}}}),{code:'INVALID_CUSTOMIZATION_STAGE_LABELS'});
  assert.throws(()=>settings.normalize(scoped,{...tenant,stageLabels:{new:{en:'<script>',ar:'جديد'}}}),{code:'INVALID_CUSTOMIZATION_STAGE_LABELS'});
});
test('schema v5 null label tombstones restore platform labels and retain deletion provenance',()=>{
  const category={...trainingCenter,customizationDefaults:{schemaVersion:4,navigationLabels:{courses:{en:'Learning',ar:'التعلم'}},leadFields:[],hiddenNavigation:[],stageLabels:{new:{en:'Prospect',ar:'عميل محتمل'}}}};
  const scoped={...ctx,category};
  const document=settings.normalize(scoped,{schemaVersion:5,navigationLabels:{courses:null},leadFields:[],hiddenNavigation:[],stageLabels:{new:null}});
  const resolved=settings.resolved(scoped,document,9);
  assert.equal(Object.hasOwn(resolved.value.navigationLabels,'courses'),false);
  assert.equal(Object.hasOwn(resolved.value.stageLabels,'new'),false);
  assert.deepEqual(resolved.deleted['navigationLabels.courses'],{scope:'tenant',revision:9});
  assert.deepEqual(resolved.deleted['stageLabels.new'],{scope:'tenant',revision:9});
  assert.deepEqual(document.leadFields,[],'lists use explicit empty replacement rather than null tombstones');
  assert.deepEqual(settings.decode(scoped,{category_key:'training_center',category_version:1,schema_version:5,document:JSON.stringify(document),checksum:settings.checksum(document)}).document,document);
  assert.throws(()=>settings.normalize(scoped,{schemaVersion:4,navigationLabels:{courses:null},leadFields:[],hiddenNavigation:[],stageLabels:{}}),{code:'INVALID_CUSTOMIZATION_LABEL'});
  assert.equal(settings.defaults().schemaVersion,5);
});
test('the existing bilingual settings editor submits explicit per-label tombstones',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const editor=fs.readFileSync(path.join(__dirname,'../client/public/tenant-customization.js'),'utf8');
  assert.match(editor,/data-platform-label/);
  assert.match(editor,/navigationLabels\[field\.key\]=null/);
  assert.match(editor,/data-platform-stage-label/);
  assert.match(editor,/stageLabels\[key\]=null/);
  assert.match(editor,/schemaVersion:5/);
  assert.match(editor,/Platform labels restored/);
  const shell=fs.readFileSync(path.join(__dirname,'../client/public/index.html'),'utf8');
  assert.match(shell,/tenant-customization\.js\?v=20261022-null-tombstones1/);
  assert.ok(shell.indexOf('/tenant-customization.js')<shell.indexOf('/static/js/main.73648acf.js'));
});
test('owner settings lists only Pipeline stages from the authenticated business uid',async()=>{
  const calls=[],ownerUid='synthetic-owner-uid';
  const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM pipeline_stages'))return [[{key:'new',title:'New'},{key:'tenant_stage',title:'Qualified'}]];if(sql.includes('FROM sx_tenant_customization_heads'))return [[]];if(sql.includes('FROM sx_tenant_customization_revisions'))return [[]];throw Error('Unexpected query: '+sql);}};
  const state=await settings.state(db,ctx,{ownerUid});
  const stages=calls.find(call=>call.sql.includes('FROM pipeline_stages'));
  assert.deepEqual(state.stageFields,[{key:'new',title:'New'},{key:'tenant_stage',title:'Qualified'}]);
  assert.deepEqual(stages.args,[require('node:crypto').createHash('sha256').update(ownerUid,'utf8').digest('hex'),ownerUid]);
});
test('published hidden navigation affects only the current tenant session contract',async()=>{
  const contract=require('../modules/platform/feature-contract'),customization=require('../modules/platform/tenant-customization');
  const original=customization.effective;
  try{
    customization.effective=async(_db,context)=>({revision:8,document:{schemaVersion:4,navigationLabels:{courses:{en:'Learning',ar:'التعلم'}},leadFields:[],hiddenNavigation:context.tenant.id==='tenant-a'?['courses']:[],stageLabels:{new:{en:'Prospect',ar:'عميل محتمل'}}}});
    const a=await contract.describeWithNavigation({}, {context:ctx}),b=await contract.describeWithNavigation({}, {context:{...ctx,tenant:{...ctx.tenant,id:'tenant-b'},membership:{...ctx.membership,tenantId:'tenant-b'}}});
    assert.equal(a.roleNavigation.includes('courses'),false);
    assert.equal(a.navigationLabels.courses,undefined);
    assert.equal(b.roleNavigation.includes('courses'),true);
    assert.equal(b.navigationLabels.courses.en,'Learning');
    assert.deepEqual(a.stageLabels,{new:{en:'Prospect',ar:'عميل محتمل'}});
  }finally{customization.effective=original;}
});
test('owner settings draft accepts the preserved tenant alias with its canonical plan contract',async()=>{
  const sales=salemaxSales,tenantId='22222222-2222-4222-8222-222222222222',writes=[];
  const legacy={...ctx,identity:{id:'sales-owner-identity'},tenant:{id:tenantId,status:'active',categoryKey:'salemax_sales',categoryVersion:1},category:sales,
    membership:{id:'sales-owner-member',tenantId,identityId:'sales-owner-identity',role:'owner',status:'active'},
    subscription:{status:'active',categoryKey:'7network_sales',categoryVersion:1,capabilities:[...sales.capabilities]}};
  const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},query:async(sql,args)=>{
    if(sql.includes('SELECT category_key,category_version,status FROM sx_tenants'))return [[{category_key:'salemax_sales',category_version:1,status:'active'}]];
    if(sql.includes('SELECT m.role,m.status,i.status AS identityStatus'))return [[{role:'owner',status:'active',identityStatus:'active'}]];
    if(sql.includes('FROM sx_plan_assignments'))return [[{id:'assignment',status:'active',role_limits:{owner:1,accountant:1,manager:1,team_leader:1,agent:1},capabilities:[...sales.capabilities],category_key:'7network_sales',category_version:1,current_period:1}]];
    if(sql.includes('SELECT revision,active_id,draft_id FROM sx_tenant_customization_heads'))return [[]];
    if(sql.includes('SELECT COUNT(*) AS total'))return [[{total:0}]];
    if(sql.startsWith('INSERT INTO')||sql.startsWith('UPDATE')){writes.push({sql,args});return [{affectedRows:1}];}
    throw Error('Unexpected query: '+sql);
  }};
  const salesDoc={schemaVersion:1,navigationLabels:{'sales-deals':{en:'Deals',ar:'الصفقات'}}};
  const result=await settings.mutate(db,legacy,{expectedRevision:0,document:salesDoc},'draft');
  assert.equal(result.revision,1);assert.equal(writes.length,4);
});
