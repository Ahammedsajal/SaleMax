'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fields=require('../modules/platform/lead-field-contract');
const def=(type='text',extra={})=>({key:`cf_${type}_0123456789abcdef`,type,label:{en:'Business field',ar:'حقل النشاط'},required:false,active:true,version:1,...extra});
test('typed tenant field definitions reject unknown keys, duplicate IDs and mutable field types',()=>{
 assert.equal(fields.definitions([def()]).length,1);
 for(const input of [[def(),def()],[def('integer',{key:def().key})],[def('text',{script:'code'})],[def('text',{label:{en:'<script>',ar:'حقل'}})],Array(25).fill(def())])assert.throws(()=>fields.definitions(input));
});
test('field values use exact typed validation and reject unknown or foreign field keys',()=>{
 const definitions=['text','integer','boolean','date'].map(type=>def(type));
 const input={configurationRevision:4,values:Object.fromEntries(definitions.map((field,i)=>[field.key,['text',12,false,'2026-10-20'][i]]))};
 const saved=fields.save({revision:4,fields:definitions},input);assert.equal(saved[def('boolean').key].value,false);
 assert.throws(()=>fields.save({revision:5,fields:definitions},input),{code:'STALE_LEAD_FIELD_CONFIGURATION'});
 assert.throws(()=>fields.save({revision:4,fields:[def()]},{configurationRevision:4,values:{cf_text_ffffffffffffffff:'other'}}),{code:'UNKNOWN_LEAD_FIELD'});
 for(const [type,value] of [['integer','12'],['integer',1.1],['boolean','true'],['date','2026-02-30'],['text','x'.repeat(1001)]])assert.throws(()=>fields.valueFor(def(type),value));
});
test('archive, deletion and renaming preserve historical values and definition snapshots',()=>{
 const first=fields.save({revision:1,fields:[def()]},{configurationRevision:1,values:{[def().key]:'Original'}});
 const archived=fields.save({revision:2,fields:[def('text',{active:false})]},{configurationRevision:2,values:{}},first);
 assert.deepEqual(archived,first);
 assert.deepEqual(fields.save({revision:3,fields:[]},{configurationRevision:3,values:{}},first),first);
 assert.throws(()=>fields.save({revision:2,fields:[def('text',{active:false})]},{configurationRevision:2,values:{[def().key]:'Overwrite'}},first),{code:'UNKNOWN_LEAD_FIELD'});
 assert.equal(fields.save({revision:3,fields:[def('text',{label:{en:'Renamed',ar:'اسم جديد'}})]},{configurationRevision:3,values:{}},first)[def().key].definition.label.en,'Business field');
 assert.equal(first[def().key].configurationRevision,1);
});
test('required fields respect false and zero while refusing missing and cleared values',()=>{
 for(const [type,value] of [['boolean',false],['integer',0]])assert.doesNotThrow(()=>fields.save({revision:1,fields:[def(type,{required:true})]},{configurationRevision:1,values:{[def(type).key]:value}}));
 assert.throws(()=>fields.save({revision:1,fields:[def('text',{required:true})]},{configurationRevision:1,values:{}}),{code:'REQUIRED_LEAD_FIELD'});
});
