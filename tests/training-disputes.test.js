'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const disputes=require('../modules/platform/training-disputes');
test('payment dispute requests and independent outcomes have bounded required evidence',()=>{
  const paymentId=crypto.randomUUID(),caseId=crypto.randomUUID(),valid={requestKey:crypto.randomUUID(),amountMinor:12500,reference:'BANK-CASE-1042',reason:'Customer reported a card payment dispute.'};
  assert.equal(disputes.normalize(paymentId,valid).amountMinor,12500);
  assert.equal(disputes.normalizeResolution(caseId,{requestKey:crypto.randomUUID(),decision:'lost',reason:'Issuer confirmed chargeback.'}).decision,'lost');
  for(const input of [{...valid,amountMinor:0},{...valid,amountMinor:1.5},{...valid,reason:'x'},{...valid,reference:'a'},{...valid,reference:'   '},{...valid,reference:'BAD\nREF'},{...valid,unexpected:true}])assert.throws(()=>disputes.normalize(paymentId,input),{code:'INVALID_DISPUTE_REQUEST'});
  for(const input of [{requestKey:crypto.randomUUID(),decision:'open',reason:'Not a final outcome'},{requestKey:crypto.randomUUID(),decision:'won',reason:'x'},{requestKey:crypto.randomUUID(),decision:'lost',reason:'Decision recorded',unexpected:true}])assert.throws(()=>disputes.normalizeResolution(caseId,input),{code:'INVALID_DISPUTE_RESOLUTION'});
});
test('dispute workflow keeps chargebacks tenant-scoped, independently reviewed and out of provider dispatch',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const router=fs.readFileSync(path.join(__dirname,'../modules/platform/training-finance-router.js'),'utf8');
  const service=fs.readFileSync(path.join(__dirname,'../modules/platform/training-disputes.js'),'utf8');
  const ui=fs.readFileSync(path.join(__dirname,'../client/public/training-finance.js'),'utf8');
  assert.match(router,/payments\/\:id\/disputes/);
  assert.match(router,/disputes\/queue/);
  assert.match(service,/reported_by_identity_id===ctx\.identity\.id/);
  assert.match(service,/assertBalancedJournal/);
  assert.match(service,/finance\.payment\.chargeback/);
  assert.match(service,/externalDispatch:false/);
  assert.match(ui,/Payment disputes/);
  assert.match(ui,/منازعات المدفوعات/);
  assert.match(ui,/Record outcome/);
});
