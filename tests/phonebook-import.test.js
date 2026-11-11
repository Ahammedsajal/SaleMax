'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {normalizeHeader,normalizeImportRows,sendableContacts}=require('../modules/platform/phonebook-import');

test('CSV parser header normalization removes an Excel UTF-8 byte-order mark',()=>{
  assert.equal(normalizeHeader('\uFEFFname'),'name');
  assert.equal(normalizeHeader('mobile'),'mobile');
});

test('imports phone, email-only, social-only, and company-only contacts without inventing numbers',()=>{
  const rows=normalizeImportRows([
    {name:'Centre A',mobile:'+97440000000',var1:'Training Center',var2:'Qatar',var3:'Centre A'},
    {name:'Contact B',mobile:'',var1:'Training Center',var2:'Qatar',var3:'Centre B',var4:'b@example.invalid'},
    {name:'Contact C',mobile:null,var1:'Training Center',var2:'Qatar',var3:'Centre C',var5:'https://example.invalid/profile'},
    {name:'Centre D',mobile:null,var1:'Training Center',var2:'Qatar',var3:'Centre D'},
  ]);
  assert.equal(rows.length,4);
  assert.equal(rows[0][1],'+97440000000');
  assert.equal(rows.slice(1).every(row=>row[1]===null),true);
});

test('rejects missing names and overlong values before inserting CSV rows',()=>{
  assert.throws(()=>normalizeImportRows([{name:'',mobile:'',var3:'Centre'}]),{code:'INVALID_CONTACT_IMPORT_ROW'});
  assert.throws(()=>normalizeImportRows([{name:'No contact details',mobile:'',var1:'Training Center',var2:'Qatar'}]),{code:'INVALID_CONTACT_IMPORT_ROW'});
  assert.throws(()=>normalizeImportRows([{name:'Centre',mobile:'',var3:'x'.repeat(1000)}]),{code:'CONTACT_FIELD_TOO_LONG'});
});

test('email-only phonebook imports require a valid address and explicit consent confirmation',()=>{
  const rows=normalizeImportRows([{name:'Email contact',email:'Sales@Example.com',email_marketing_consent:'yes'}],{emailMarketing:true});
  assert.equal(rows[0][1],null);
  assert.equal(rows[0][7],'sales@example.com');
  assert.equal(rows[0][8],0);
  const confirmed=normalizeImportRows([{name:'Email contact',email:'Sales@Example.com',email_marketing_consent:'yes'}],{emailMarketing:true,consentConfirmed:true});
  assert.equal(confirmed[0][8],1);
  assert.throws(()=>normalizeImportRows([{name:'Email contact',email:'invalid'}],{emailMarketing:true}),{code:'INVALID_EMAIL_ADDRESS'});
});

test('only contacts with a real nonblank mobile are campaign and call recipients',()=>{
  const rows=sendableContacts([
    {name:'Phone',mobile:'+97440000000'},
    {name:'Email',mobile:null},
    {name:'Blank',mobile:'   '},
    {name:'Social',mobile:undefined},
  ]);
  assert.deepEqual(rows.map(row=>row.name),['Phone']);
});
