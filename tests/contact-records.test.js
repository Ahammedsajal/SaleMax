'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizedContactId,removeContact}=require('../modules/platform/contact-records');

test('contact removal validates a bounded ID and always scopes deletion to the authenticated owner',async()=>{
  assert.equal(normalizedContactId('42'),42);
  for(const value of [0,-1,'0','01','1e2','42 OR 1=1',2147483648,1.5,null])assert.throws(()=>normalizedContactId(value),{code:'INVALID_CONTACT_ID'});
  const calls=[];
  assert.deepEqual(await removeContact(async(sql,params)=>{calls.push({sql,params});return {affectedRows:1};},'tenant-a','42'),{id:42,deleted:true});
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/DELETE FROM contact WHERE id = \? AND uid = \?/);
  assert.deepEqual(calls[0].params,[42,'tenant-a']);
  await assert.rejects(removeContact(async()=>{},'',42),{code:'INVALID_CONTACT_SCOPE'});
});
