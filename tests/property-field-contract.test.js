'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fields=require('../modules/platform/property-field-contract');

const definition=(type='text',extra={})=>({key:`pf_${type}_0123456789abcdef`,type,label:{en:'Listing detail',ar:'تفصيل الإعلان'},required:false,active:true,version:1,...extra});

test('property fields use their own stable namespace and keep typed validation',()=>{
  for(const type of fields.types)assert.equal(fields.definitions([definition(type)])[0].key,definition(type).key);
  assert.throws(()=>fields.definitions([{...definition(),key:'cf_text_0123456789abcdef'}]),{code:'INVALID_PROPERTY_FIELD'});
  assert.throws(()=>fields.definitions([definition('integer',{label:{en:'Value',ar:'<b>قيمة</b>'}})]),{code:'INVALID_PROPERTY_FIELD_LABEL'});
  assert.throws(()=>fields.valueFor(definition('integer'),'4'),{code:'INVALID_PROPERTY_FIELD_VALUE'});
});

test('required listing values accept false and zero while rejecting missing and stale submissions',()=>{
  const boolean=definition('boolean',{required:true}),integer=definition('integer',{key:'pf_integer_0123456789abcdef',required:true});
  const contract={revision:7,fields:[boolean,integer]};
  const saved=fields.save(contract,{configurationRevision:7,values:{[boolean.key]:false,[integer.key]:0}});
  assert.equal(saved[boolean.key].value,false);assert.equal(saved[integer.key].value,0);
  assert.throws(()=>fields.save(contract,{configurationRevision:7,values:{[boolean.key]:false}}),{code:'REQUIRED_PROPERTY_FIELD'});
  assert.throws(()=>fields.save(contract,{configurationRevision:6,values:{}}),{code:'STALE_PROPERTY_FIELD_CONFIGURATION'});
  assert.throws(()=>fields.save(contract,{configurationRevision:7,values:{pf_text_ffffffffffffffff:'other'}}),{code:'UNKNOWN_PROPERTY_FIELD'});
});

test('archived property values retain their bilingual historical definition',()=>{
  const original=definition('text');
  const first=fields.save({revision:1,fields:[original]},{configurationRevision:1,values:{[original.key]:'Covered parking'}});
  const archived=fields.save({revision:2,fields:[{...original,active:false}]},{configurationRevision:2,values:{}},first);
  assert.deepEqual(archived,first);
  const renamed=fields.save({revision:3,fields:[{...original,label:{en:'Parking',ar:'مواقف'}}]},{configurationRevision:3,values:{}},first);
  assert.equal(renamed[original.key].definition.label.en,'Listing detail');
  assert.equal(renamed[original.key].value,'Covered parking');
  assert.equal(renamed[original.key].configurationRevision,1);
});
