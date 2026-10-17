'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const directory=require('../modules/platform/invoice-customers'),generator=require('../modules/platform/invoice-generator');
const owner={uid:'synthetic-tenant-owner',legacy_uid_hash:crypto.createHash('sha256').update('synthetic-tenant-owner').digest('hex')};
test('customer searches support empty browse, escaped wildcards and formatted Qatar mobiles',()=>{
  assert.equal(directory.query().text,'');assert.equal(directory.query(' +974 5031-3785 ').phone,'%50313785%');
  assert.equal(directory.query('5031 3785').phone,'%50313785%');assert.equal(directory.query('user123@example.test').phone,'');
  assert.equal(directory.query('A_%').term,'%A\\_\\%%');assert.throws(()=>directory.query('x'.repeat(81)));
});
test('directory uses the verified tenant owner scope instead of the requesting staff UID',async()=>{
  const calls=[],db={async query(sql,params){calls.push({sql,params});if(sql.includes('sx_legacy_ownership'))return [[owner]];return [[{id:'lead',source:'lead',name:'Synthetic Learner',phone:'null',email:'synthetic@example.invalid',address:'Doha'}]];}};
  const result=await directory.list(db,{tenant:{id:'tenant'}},{uid:'staff-account',q:''});
  assert.equal(result[0].phone,'');assert.equal(result[0].address,'Doha');
  assert.equal(calls[1].params[2],owner.uid);assert(calls[1].params.includes(owner.legacy_uid_hash));
  assert.match(calls[1].sql,/recent\.tenant_id=fs\.tenant_id/);assert.match(calls[1].sql,/NOT EXISTS/);
});
test('ambiguous or tampered tenant owner mappings do not expose directory records',async()=>{
  for(const rows of [[],[owner,owner],[{...owner,legacy_uid_hash:'bad'}]])await assert.rejects(directory.list({async query(){return [rows];}},{tenant:{id:'tenant'}},{}),{code:'BUSINESS_LINK_INVALID'});
});
test('unauthorized directory reads are rejected before database access',async()=>{
  await assert.rejects(generator.customers({query(){throw Error('must not query');}},{},{q:''}),{code:'TENANT_CONTEXT_REQUIRED'});
});
