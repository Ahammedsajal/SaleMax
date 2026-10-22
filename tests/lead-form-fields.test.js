'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const service=require('../modules/platform/lead-form-fields'),settings=require('../modules/platform/tenant-customization'),category=require('../modules/platform/categories').trainingCenter;
const field={key:'cf_boolean_0123456789abcdef',type:'boolean',label:{en:'Needs parking',ar:'يحتاج موقفًا'},required:false,active:true,version:1};
const ctx={tenant:{id:'tenant-a',categoryKey:category.key,categoryVersion:1},category};
const selected={configurationRevision:3,fields:[{...field,required:true}]};
test('form fields pin typed definitions and enforce their own required rules, including false and zero',()=>{
 assert.equal(service.save(selected,{[field.key]:false})[field.key].value,false);
 assert.throws(()=>service.save(selected,{}),{code:'REQUIRED_LEAD_FIELD'});assert.throws(()=>service.save(selected,{foreign:true}),{code:'UNKNOWN_LEAD_FIELD'});
 assert.throws(()=>service.save(undefined,{}),{code:'UNKNOWN_LEAD_FIELD'});
 const integer={...field,type:'integer',key:'cf_integer_0123456789abcdef'};assert.equal(service.save({configurationRevision:3,fields:[{...integer,required:true}]},{[integer.key]:0})[integer.key].value,0);
 const saved=service.save(selected,{[field.key]:false});field.label.en='Renamed';assert.equal(saved[field.key].definition.label.en,'Needs parking');field.label.en='Needs parking';
});
test('draft publication verifies tenant-bound active revision and refuses label/type spoofing or archived keys',async()=>{
 const doc={schemaVersion:2,navigationLabels:{},leadFields:[field]},row={id:'revision-a',revision:3,kind:'published',schema_version:2,category_key:category.key,category_version:1,document:JSON.stringify(doc),checksum:settings.checksum(doc)};
 const calls=[],db={query:async(sql,args)=>{calls.push({sql,args});return [[row]];}};
 await service.validateDraft(db,ctx,selected);assert.deepEqual(calls[0].args,['tenant-a']);assert.match(calls[0].sql,/r.tenant_id=h.tenant_id/);assert.match(calls[0].sql,/FOR UPDATE/);
 await assert.rejects(service.validateDraft(db,ctx,{...selected,configurationRevision:2}),{code:'STALE_LEAD_FIELD_CONFIGURATION'});
 await assert.rejects(service.validateDraft(db,ctx,{...selected,fields:[{...field,label:{en:'Spoof',ar:'مزيف'}}]}),{code:'INVALID_FORM_LEAD_FIELDS'});
 await assert.rejects(service.validateDraft(db,ctx,{...selected,fields:[{...field,key:'cf_boolean_fedcba9876543210'}]}),{code:'UNKNOWN_LEAD_FIELD'});
 const empty={query:async()=>[[]]};await assert.rejects(service.validateDraft(empty,ctx,selected),{code:'STALE_LEAD_FIELD_CONFIGURATION'});
});
test('invalid form metadata is bounded and unknown properties cannot become capture instructions',()=>{
 for(const input of [{configurationRevision:3,fields:[]},{...selected,tenantId:'foreign'},{...selected,fields:[{...field,active:false}]},{...selected,configurationRevision:-1}])assert.throws(()=>service.normalize(input));
 assert.equal(service.normalize(undefined),undefined);
});
test('existing Forms editor can select the exact category-version default field without a tenant override',async()=>{
 const categoryWithDefaults={...category,customizationDefaults:{schemaVersion:3,navigationLabels:{},leadFields:[field],hiddenNavigation:[]}};
 const result=await service.options({query:async()=>[[]]},{...ctx,category:categoryWithDefaults});
 assert.deepEqual(result,{revision:0,fields:[field]});
 const selectedAtBaseline={configurationRevision:result.revision,fields:[{...field,required:true}]};
 assert.deepEqual(service.contract(selectedAtBaseline),{revision:0,fields:[{...field,required:true}]});
 await service.validateDraft({query:async()=>[[]]},{...ctx,category:categoryWithDefaults},selectedAtBaseline);
 assert.equal(service.save(selectedAtBaseline,{[field.key]:false})[field.key].configurationRevision,0);
});
test('Forms keeps inherited category fields selectable under a tenant revision that omits the field override',async()=>{
 const settings=require('../modules/platform/tenant-customization'),categoryWithDefaults={...category,customizationDefaults:{schemaVersion:3,navigationLabels:{},leadFields:[field],hiddenNavigation:[]}},document={schemaVersion:3,navigationLabels:{},hiddenNavigation:[]};
 const row={id:'revision-a',revision:3,kind:'published',category_key:category.key,category_version:1,schema_version:3,document:JSON.stringify(document),checksum:settings.checksum(settings.normalize({...ctx,category:categoryWithDefaults},document))};
 const result=await service.options({query:async()=>[[row]]},{...ctx,category:categoryWithDefaults});
 assert.deepEqual(result,{revision:3,fields:[field]});
});
