'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const runtime=require('../modules/platform/lead-field-runtime'),settings=require('../modules/platform/tenant-customization');
const definition={key:'cf_text_0123456789abcdef',type:'text',label:{en:'Reference',ar:'مرجع'},active:true,required:false,version:1};
const document={schemaVersion:2,navigationLabels:{},leadFields:[definition]};
test('owner UID lookup binds the published revision to the verified tenant and locks configuration on writes',async()=>{
 const savedFlag=process.env.SALEMAX_PLATFORM_ENABLED;process.env.SALEMAX_PLATFORM_ENABLED='true';const calls=[];
 const trainingCenter=require('../modules/platform/categories').trainingCenter,customizationContext={tenant:{id:'tenant-a',categoryKey:trainingCenter.key,categoryVersion:trainingCenter.version},category:trainingCenter};
 const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM user u JOIN'))return [[{id:'tenant-a',status:'active',category_key:'training_center',category_version:1,active_id:'config-a'}]];return [[{id:'config-a',revision:6,kind:'published',category_key:'training_center',category_version:1,schema_version:2,document:JSON.stringify(document),checksum:settings.checksum(settings.normalize(customizationContext,document))}]];}};
 try{
  const saved=await runtime.save(db,'owner-a',{configurationRevision:6,values:{[definition.key]:'A'}});assert.equal(saved[definition.key].value,'A');assert.deepEqual(calls[1].args,['tenant-a','config-a']);assert.match(calls[0].sql,/FOR UPDATE/);assert.deepEqual(calls[0].args,['owner-a',crypto.createHash('sha256').update('owner-a').digest('hex')]);
  calls.length=0;await runtime.contractForOwner(db,'owner-a');assert.doesNotMatch(calls[0].sql,/FOR UPDATE/);
 }finally{if(savedFlag===undefined)delete process.env.SALEMAX_PLATFORM_ENABLED;else process.env.SALEMAX_PLATFORM_ENABLED=savedFlag;}
});
test('legacy unmapped accounts cannot submit a field from another business',async()=>{
 const savedFlag=process.env.SALEMAX_PLATFORM_ENABLED;process.env.SALEMAX_PLATFORM_ENABLED='true';try{
  await assert.rejects(runtime.save({query:async()=>[[]]},'legacy-b',{configurationRevision:0,values:{[definition.key]:'foreign'}}),{code:'UNKNOWN_LEAD_FIELD'});
 }finally{if(savedFlag===undefined)delete process.env.SALEMAX_PLATFORM_ENABLED;else process.env.SALEMAX_PLATFORM_ENABLED=savedFlag;}
});
test('category lead-field defaults are available to Pipeline before a tenant publishes customization',async()=>{
 const savedFlag=process.env.SALEMAX_PLATFORM_ENABLED;process.env.SALEMAX_PLATFORM_ENABLED='true';
 const categories=require('../modules/platform/categories'),original=categories.getCategory;
 const category={...categories.trainingCenter,customizationDefaults:{schemaVersion:3,navigationLabels:{},leadFields:[definition],hiddenNavigation:[]}};
 categories.getCategory=(key,version)=>key===category.key&&version===category.version?category:original(key,version);
 const db={query:async()=>[[{id:'tenant-a',status:'active',category_key:category.key,category_version:category.version,active_id:null}]]};
 try{assert.deepEqual(await runtime.contractForOwner(db,'owner-default'),{revision:0,fields:[definition]});}
 finally{categories.getCategory=original;if(savedFlag===undefined)delete process.env.SALEMAX_PLATFORM_ENABLED;else process.env.SALEMAX_PLATFORM_ENABLED=savedFlag;}
});
test('Pipeline keeps category fields active under a published tenant revision that omits an override',async()=>{
 const savedFlag=process.env.SALEMAX_PLATFORM_ENABLED;process.env.SALEMAX_PLATFORM_ENABLED='true';
 const categories=require('../modules/platform/categories'),original=categories.getCategory;
 const category={...categories.trainingCenter,customizationDefaults:{schemaVersion:3,navigationLabels:{},leadFields:[definition],hiddenNavigation:[]}},tenant={id:'tenant-a',categoryKey:category.key,categoryVersion:category.version};
 categories.getCategory=(key,version)=>key===category.key&&version===category.version?category:original(key,version);
 const document={schemaVersion:3,navigationLabels:{},hiddenNavigation:[]},row={id:'config-a',revision:4,kind:'published',category_key:category.key,category_version:category.version,schema_version:3,document:JSON.stringify(document),checksum:settings.checksum(settings.normalize({tenant,category},document))};
 const db={query:async sql=>sql.includes('FROM user u JOIN')?[[{id:tenant.id,status:'active',category_key:category.key,category_version:category.version,active_id:row.id}]]:[[row]]};
 try{assert.deepEqual(await runtime.contractForOwner(db,'owner-overlay'),{revision:4,fields:[definition]});}
 finally{categories.getCategory=original;if(savedFlag===undefined)delete process.env.SALEMAX_PLATFORM_ENABLED;else process.env.SALEMAX_PLATFORM_ENABLED=savedFlag;}
});
test('schema 1 persisted checksums remain stable after schema 2 adoption',()=>{
 const v1={schemaVersion:1,navigationLabels:{}};const ctx={tenant:{categoryKey:'training_center',categoryVersion:1},category:require('../modules/platform/categories').trainingCenter};
 assert.deepEqual(settings.decode(ctx,{id:'old',revision:1,kind:'published',category_key:'training_center',category_version:1,schema_version:1,document:JSON.stringify(v1),checksum:settings.checksum(v1)}).document,v1);
 assert.deepEqual(settings.normalize(ctx,document),document);
 assert.throws(()=>settings.decode(ctx,{id:'old',revision:1,kind:'published',category_key:'training_center',category_version:1,schema_version:2,document:JSON.stringify(v1),checksum:settings.checksum(v1)}),{code:'CUSTOMIZATION_INTEGRITY_ERROR'});
});
