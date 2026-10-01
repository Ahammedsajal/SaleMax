const test=require('node:test');
const assert=require('node:assert/strict');
const {bootstrap,validate}=require('../modules/platform/bootstrap-super-admin');

const valid=()=>({legacyAdminId:12,legacyUid:'verified-existing-admin-uid',password:'synthetic-owner-password',confirmation:'BOOTSTRAP PRODUCT OWNER'});
test('one-time owner bootstrap requires explicit ownership confirmation and verified legacy credentials',()=>{
  for(const input of [null,{...valid(),confirmation:''},{...valid(),legacyAdminId:0},{...valid(),legacyUid:' '},{...valid(),password:'x'.repeat(73)}])assert.throws(()=>validate(input));
  assert.equal(validate(valid()).legacyAdminId,12);
});
test('invalid bootstrap requests do not touch the database',async()=>{
  let queries=0;
  await assert.rejects(bootstrap({beginTransaction:async()=>{queries++;}},{...valid(),confirmation:'wrong'}),{code:'OWNER_CONFIRMATION_REQUIRED'});
  assert.equal(queries,0);
});
