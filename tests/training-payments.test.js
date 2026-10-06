'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const payments=require('../modules/platform/training-payments');
const {trainingCenter}=require('../modules/platform/categories');
function context(role='owner',capabilities=['finance.invoices','finance.payments','finance.receipts']){const tenantId=crypto.randomUUID();return {audience:'tenant',identity:{id:crypto.randomUUID()},tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:crypto.randomUUID(),tenantId,role,status:'active'},category:trainingCenter,subscription:{status:'active',capabilities}};}
test('manual payment capture validates QAR amounts, method, timestamp and bounded reference',()=>{
  const id=crypto.randomUUID(),requestKey=crypto.randomUUID(),valid={requestKey,method:'bank_transfer',amountMinor:10000,receivedAt:'2026-10-02T10:00:00+03:00',reference:'BANK-001',note:'Counter deposit'};
  const normalized=payments.normalizeRecord(id,valid);assert.equal(normalized.amountMinor,10000);assert.equal(normalized.reference,'BANK-001');assert.equal(normalized.receivedAt.toISOString(),'2026-10-02T07:00:00.000Z');
  for(const input of [{...valid,amountMinor:0},{...valid,amountMinor:1.1},{...valid,method:'crypto'},{...valid,receivedAt:'2026-02-30T10:00:00Z'},{...valid,reference:'x'.repeat(201)}])assert.throws(()=>payments.normalizeRecord(id,input));
});
test('payment review role gate admits owners and accountants while rejecting other roles',()=>{
  assert.doesNotThrow(()=>payments.requireRole(context('owner'),'payments.verify',['owner','accountant']));
  assert.doesNotThrow(()=>payments.requireRole(context('accountant'),'payments.verify',['owner','accountant']));
  assert.throws(()=>payments.requireRole(context('agent'),'payments.verify',['owner','accountant']),{code:'PERMISSION_DENIED'});
});
test('owner or accountant can verify payments without a separate finance-policy approval threshold',()=>{
  const recorder=crypto.randomUUID(),owner=crypto.randomUUID(),payment={amount_minor:600000,recorded_by_identity_id:recorder};
  assert.throws(()=>payments.approvalRule('accountant',recorder,payment,500000),{code:'SECOND_APPROVER_REQUIRED'});
  assert.equal(payments.approvalRule('owner',owner,payment,500000),true);
  assert.equal(payments.approvalRule('owner',owner,{...payment,amount_minor:500000},null),false);
  assert.equal(payments.approvalRule('accountant',recorder,{...payment,amount_minor:500000},null),false);
});
test('manual payments and receipts use the existing bilingual Finance screen and authenticated routes',()=>{
  const fs=require('node:fs'),path=require('node:path'),read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
  const router=read('modules/platform/training-finance-router.js'),ui=read('client/public/training-finance.js');
  assert.match(router,/accountant\/payments\/pending/);assert.match(router,/payments\/pending/);assert.match(router,/payments\.verify/);assert.match(router,/payments\.receipt/);
  assert.match(ui,/Record payment/);assert.match(ui,/Verify and issue receipt/);assert.match(ui,/Receipt/);
  assert.match(read('docs/API_DOCUMENTATION.md'),/Manual payment recording, verification and receipts/);
  assert.match(read('docs/USER_MANUAL.md'),/Record and verify a manual payment/);
});
