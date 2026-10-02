'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const credits=require('../modules/platform/training-credits');
const finance=require('../modules/platform/finance-contract');
const {trainingCenter}=require('../modules/platform/categories');
const id=()=>crypto.randomUUID();
function context(role='owner',capabilities=['finance.invoices','finance.payments']){const tenantId=id();return {audience:'tenant',identity:{id:id()},tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:id(),tenantId,role,status:'active'},category:trainingCenter,subscription:{status:'active',capabilities}};}
test('credit request validates key, positive integer dirhams and meaningful reason',()=>{
  const invoiceId=id(),request={requestKey:id(),amountMinor:1250,reason:'Agreed course adjustment'};
  assert.deepEqual(credits.normalize(invoiceId,request),{invoiceId,...request,reason:request.reason});
  for(const input of [{...request,requestKey:'bad'},{...request,amountMinor:0},{...request,amountMinor:1.5},{...request,amountMinor:Number.MAX_SAFE_INTEGER+1},{...request,reason:'ok'},{...request,unexpected:true}])assert.throws(()=>credits.normalize(invoiceId,input));
  assert.throws(()=>credits.normalize('not-an-invoice',request));
});
test('credit-adjusted invoice balance keeps receipts and outstanding receivable distinct',()=>{
  assert.deepEqual(finance.invoiceBalance({grossMinor:300000,allocatedMinor:100000,creditMinor:50000}),{grossMinor:300000,openMinor:150000,creditedMinor:50000,allocatedMinor:100000});
  assert.throws(()=>finance.invoiceBalance({grossMinor:300000,allocatedMinor:100000,creditMinor:200001}),{code:'INVOICE_BALANCE_OUT_OF_RANGE'});
  assert.deepEqual(finance.assertBalancedJournal([{currency:'QAR',debitMinor:5000,creditMinor:0},{currency:'QAR',debitMinor:0,creditMinor:5000}]),{currency:'QAR',debitsMinor:5000,creditsMinor:5000});
});
test('credit request and review permissions are limited to the existing owner and accountant roles',()=>{
  assert.doesNotThrow(()=>credits.requireRole(context('owner'),['owner','accountant']));
  assert.doesNotThrow(()=>credits.requireRole(context('accountant'),['owner','accountant']));
  assert.throws(()=>credits.requireRole(context('agent'),['owner','accountant']),{code:'PERMISSION_DENIED'});
  assert.throws(()=>credits.requireRole(context('owner',['finance.invoices']),['owner','accountant']),{code:'FEATURE_UNAVAILABLE'});
});
test('credit workflow is exposed through the existing invoice and Finance screens in both languages',()=>{
  const fs=require('node:fs'),path=require('node:path'),read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  const router=read('modules/platform/training-finance-router.js');assert.match(router,/credits\/pending/);assert.match(router,/credits\/\:id\/decision/);
  assert.match(read('modules/platform/training-invoices.js'),/creditedMinor/);
  const ui=read('client/public/training-finance.js');assert.match(ui,/Credit notes/);assert.match(ui,/الإشعارات الدائنة/);assert.match(ui,/Request credit for accountant review/);assert.match(ui,/طلب مراجعة الإشعار من المحاسب/);
  assert.match(read('docs/API_DOCUMENTATION.md'),/Invoice credits and review/);
  assert.match(read('docs/USER_MANUAL.md'),/Request an invoice credit/);
});
