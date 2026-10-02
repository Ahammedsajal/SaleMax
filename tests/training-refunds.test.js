const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const refunds=require('../modules/platform/training-refunds');
test('excess-deposit requests accept only positive integer minor units and bounded evidence',()=>{
  const id=crypto.randomUUID(),valid={requestKey:crypto.randomUUID(),amountMinor:10000,reason:'Return excess deposit'};
  assert.equal(refunds.normalize(id,valid).amountMinor,10000);
  for(const input of [{...valid,amountMinor:0},{...valid,amountMinor:1.5},{...valid,reason:'x'},{...valid,amountMinor:100000000001},{...valid,unexpected:true}])assert.throws(()=>refunds.normalize(id,input),{code:'INVALID_REFUND_REQUEST'});
});
test('manual return evidence rejects future dates and unsupported methods',()=>{
  const id=crypto.randomUUID(),valid={requestKey:crypto.randomUUID(),method:'bank_transfer',reference:'RETURN-001',completedAt:new Date(Date.now()-60000).toISOString()};
  assert.equal(refunds.normalizeCompletion(id,valid).reference,'RETURN-001');
  assert.throws(()=>refunds.normalizeCompletion(id,{...valid,completedAt:new Date(Date.now()+3600000).toISOString()}),{code:'INVALID_REFUND_DATE'});
  assert.throws(()=>refunds.normalizeCompletion(id,{...valid,method:'cheque'}),{code:'INVALID_REFUND_COMPLETION'});
});
