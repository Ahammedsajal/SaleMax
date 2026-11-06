'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const proof=require('../modules/platform/retail-delivery-proof');

const env={SALEMAX_PLATFORM_KEY_BASE64:Buffer.alloc(32,7).toString('base64')};
const tenant='11111111-1111-4111-8111-111111111111';
const order='22222222-2222-4222-8222-222222222222';

test('delivery proof is encrypted for retry recovery and tenant/order bound',()=>{
  const created=proof.create(tenant,order,env);
  assert.match(created.code,/^\d{6}$/);
  assert.notEqual(created.ciphertext.toString('utf8'),created.code);
  const row={code_hash:created.hash,code_ciphertext:created.ciphertext,code_iv:created.iv,code_auth_tag:created.authTag};
  assert.equal(proof.reveal(row,tenant,order,env),created.code);
  assert.equal(proof.matches(created.code,row,tenant,order,env),true);
  const other=created.code==='000000'?'000001':'000000';
  assert.equal(proof.matches(other,row,tenant,order,env),false);
  assert.throws(()=>proof.reveal(row,'33333333-3333-4333-8333-333333333333',order,env),{code:'RETAIL_PROOF_UNAVAILABLE'});
  assert.throws(()=>proof.reveal(row,tenant,'44444444-4444-4444-8444-444444444444',env),{code:'RETAIL_PROOF_UNAVAILABLE'});
});

test('delivery proof requires a valid stable platform encryption key',()=>{
  assert.throws(()=>proof.create(tenant,order,{}),{code:'RETAIL_PROOF_KEY_UNAVAILABLE'});
  assert.throws(()=>proof.create(tenant,order,{SALEMAX_PLATFORM_KEY_BASE64:'short'}),{code:'RETAIL_PROOF_KEY_UNAVAILABLE'});
});

test('delivery proof comparisons reject malformed and non-numeric codes',()=>{
  const created=proof.create(tenant,order,env);
  const row={code_hash:created.hash,code_ciphertext:created.ciphertext,code_iv:created.iv,code_auth_tag:created.authTag};
  assert.equal(proof.matches('12345',row,tenant,order,env),false);
  assert.equal(proof.matches('1234567',row,tenant,order,env),false);
  assert.equal(proof.matches('abcdef',row,tenant,order,env),false);
});
