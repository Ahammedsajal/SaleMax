'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const scope=require('../modules/platform/phonebook-owner-scope');

test('linked managers use the verified owner phonebook records',async()=>{
  const uid=await scope.resolveOwnerUid({id:7,uid:'manager-uid'},{pool:{},resolver:async()=>({role:'manager',uid:'owner-uid'})});
  assert.equal(uid,'owner-uid');
});

test('owners and unlinked users keep their current phonebook account',async()=>{
  assert.equal(await scope.resolveOwnerUid({id:1,uid:'owner-uid'},{pool:{},resolver:async()=>null}),'owner-uid');
});

test('inactive or invalid canonical links fail closed',async()=>{
  await assert.rejects(scope.resolveOwnerUid({id:7,uid:'manager-uid'},{pool:{},resolver:async()=>({denied:true,code:'BUSINESS_ACCESS_INACTIVE'})}),{code:'BUSINESS_ACCESS_INACTIVE'});
});

test('all Phonebook routes resolve the shared owner account after authentication',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../routes/phonebook.js'),'utf8');
  assert.equal((source.match(/validateUser,\s*phonebookOwnerScope/g)||[]).length,8);
  assert.match(source,/DELETE FROM phonebook WHERE id = \? AND uid = \?/);
  assert.match(source,/DELETE FROM contact WHERE id IN \(\?\) AND uid = \?/);
  assert.match(source,/phonebookOwnerScope=require\('\.\.\/modules\/platform\/phonebook-owner-scope'\)/);
});
