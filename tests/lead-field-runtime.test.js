'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const runtime=require('../modules/platform/lead-field-runtime'),settings=require('../modules/platform/tenant-customization');
const definition={key:'cf_text_0123456789abcdef',type:'text',label:{en:'Reference',ar:'مرجع'},active:true,required:false,version:1};
const document={schemaVersion:2,navigationLabels:{},leadFields:[definition]};
test('owner UID lookup binds the published revision to the verified tenant and locks configuration on writes',async()=>{
 const savedFlag=process.env.SALEMAX_PLATFORM_ENABLED;process.env.SALEMAX_PLATFORM_ENABLED='true';const calls=[];
 const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM user u JOIN'))return [[{id:'11111111-1111-4111-8111-111111111111',status:'active',category_key:'training_center',category_version:1,active_id:'config-a',membership_id:'22222222-2222-4222-8222-222222222222',identity_id:'33333333-3333-4333-8333-333333333333',membership_status:'active'}]];if(sql.includes('FROM sx_plan_assignments'))return [[{id:'44444444-4444-4444-8444-444444444444',status:'active',role_limits:{owner:1,manager:3,accountant:3,agent:10},capabilities:['crm.leads'],category_key:'training_center',category_version:1,current_period:1}]];return [[{id:'config-a',revision:6,kind:'published',category_key:'training_center',category_version:1,schema_version:2,document:JSON.stringify(document),checksum:settings.checksum(settings.normalize({category:require('../modules/platform/categories').trainingCenter},document))}]];}};
 try{
  const saved=await runtime.save(db,'owner-a',{configurationRevision:6,values:{[definition.key]:'A'}});assert.equal(saved[definition.key].value,'A');assert.deepEqual(calls[2].args,['11111111-1111-4111-8111-111111111111','config-a']);assert.match(calls[0].sql,/FOR UPDATE/);assert.deepEqual(calls[0].args,['owner-a',crypto.createHash('sha256').update('owner-a').digest('hex')]);
  calls.length=0;await runtime.contractForOwner(db,'owner-a');assert.doesNotMatch(calls[0].sql,/FOR UPDATE/);
 }finally{if(savedFlag===undefined)delete process.env.SALEMAX_PLATFORM_ENABLED;else process.env.SALEMAX_PLATFORM_ENABLED=savedFlag;}
});
test('legacy unmapped accounts cannot submit a field from another business',async()=>{
 const savedFlag=process.env.SALEMAX_PLATFORM_ENABLED;process.env.SALEMAX_PLATFORM_ENABLED='true';try{
  await assert.rejects(runtime.save({query:async()=>[[]]},'legacy-b',{configurationRevision:0,values:{[definition.key]:'foreign'}}),{code:'UNKNOWN_LEAD_FIELD'});
 }finally{if(savedFlag===undefined)delete process.env.SALEMAX_PLATFORM_ENABLED;else process.env.SALEMAX_PLATFORM_ENABLED=savedFlag;}
});
test('schema 1 persisted checksums remain stable after schema 2 adoption',()=>{
 const v1={schemaVersion:1,navigationLabels:{}};const ctx={tenant:{categoryKey:'training_center',categoryVersion:1},category:require('../modules/platform/categories').trainingCenter};
 assert.deepEqual(settings.decode(ctx,{id:'old',revision:1,kind:'published',category_key:'training_center',category_version:1,schema_version:1,document:JSON.stringify(v1),checksum:settings.checksum(v1)}).document,v1);
 assert.deepEqual(settings.normalize(ctx,document),document);
 assert.throws(()=>settings.decode(ctx,{id:'old',revision:1,kind:'published',category_key:'training_center',category_version:1,schema_version:2,document:JSON.stringify(v1),checksum:settings.checksum(v1)}),{code:'CUSTOMIZATION_INTEGRITY_ERROR'});
});


test('current plan entitlement gates published fields and new values without deleting prior values',async()=>{
 const savedFlag=process.env.SALEMAX_PLATFORM_ENABLED;process.env.SALEMAX_PLATFORM_ENABLED='true';
 const calls=[];const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('FROM user u JOIN'))return [[{id:'11111111-1111-4111-8111-111111111111',status:'active',category_key:'training_center',category_version:1,active_id:'config-a',membership_id:'22222222-2222-4222-8222-222222222222',identity_id:'33333333-3333-4333-8333-333333333333',membership_status:'active'}]];if(sql.includes('FROM sx_plan_assignments'))return [[{id:'44444444-4444-4444-8444-444444444444',status:'active',role_limits:{owner:1,manager:3,accountant:3,agent:10},capabilities:['team.tasks'],category_key:'training_center',category_version:1,current_period:1}]];throw new Error('The revoked plan must not load custom-field definitions');}};
 try{
  assert.deepEqual(await runtime.contractForOwner(db,'owner-a'),{revision:0,fields:[],available:false});
  await assert.rejects(runtime.save(db,'owner-a',{configurationRevision:6,values:{[definition.key]:'blocked'}},{},{creating:true}),{code:'FEATURE_UNAVAILABLE'});
  const prior={[definition.key]:{value:'retained',definition,configurationRevision:6}};
  assert.deepEqual(await runtime.save({query:async()=>{throw new Error('ordinary edits do not need the unavailable contract');}},'owner-a',undefined,{customFields:prior}),prior);
 }finally{if(savedFlag===undefined)delete process.env.SALEMAX_PLATFORM_ENABLED;else process.env.SALEMAX_PLATFORM_ENABLED=savedFlag;}
});
