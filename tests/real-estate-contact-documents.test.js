'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const documents=require('../modules/platform/real-estate-contact-documents');
const tenant='11111111-1111-4111-8111-111111111111';
const contact='55555555-5555-4555-8555-555555555555';
const context={audience:'tenant',tenant:{id:tenant,status:'active',categoryKey:'real_estate',categoryVersion:1},membership:{id:'33333333-3333-4333-8333-333333333333',tenantId:tenant,role:'owner',status:'active'},identity:{id:'22222222-2222-4222-8222-222222222222'},category:require('../modules/platform/categories').realEstate,subscription:{status:'active',categoryKey:'real_estate',categoryVersion:1,capabilities:['realestate.listings']}};

test('contact document list verifies contact ownership and scopes files to tenant/contact',async()=>{
  const calls=[],db={query:async(sql,args)=>{calls.push({sql,args});return sql.startsWith('SELECT id FROM sx_real_estate_contacts')?[[{id:contact}],[]]:[[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'trade-licence.pdf',sizeBytes:1024,createdAt:'2026-10-27 10:00:00'}],[]];}};
  const result=await documents.list(db,context,contact);
  assert.equal(result.items[0].name,'trade-licence.pdf');
  assert.deepEqual(calls.map(call=>call.args),[[tenant,contact],[tenant,contact]]);
  assert.match(calls[1].sql,/tenant_id=\? AND contact_id=\?/);
});

test('contact document read does not reveal a foreign or missing document',async()=>{
  const foreignTenant='99999999-9999-4999-8999-999999999999',foreign={...context,tenant:{...context.tenant,id:foreignTenant},membership:{...context.membership,tenantId:foreignTenant}};
  const db={query:async()=>[[],[]]};
  await assert.rejects(documents.get(db,foreign,contact,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),{code:'CONTACT_DOCUMENT_NOT_FOUND'});
});

test('contact document IDs must be canonical UUIDs before filesystem or SQL access',async()=>{
  let called=false;
  await assert.rejects(documents.get({query:async()=>{called=true;}},context,'../../etc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),{code:'INVALID_CONTACT_DOCUMENT'});
  assert.equal(called,false);
});
