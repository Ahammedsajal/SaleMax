'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const conversion=require('../modules/platform/training-sale-conversion');
const {trainingCenter}=require('../modules/platform/categories');
test('sale conversion requires an approved tax policy and calculates the agreed QAR amount',()=>{
  const expected={subtotalMinor:285000,taxMinor:0,totalMinor:285000,taxRateBps:null};
  assert.deepEqual(conversion.totals(285000,{taxMode:'no_tax',taxRateBps:null}),expected);
  assert.deepEqual(conversion.totals(285000,{taxMode:'exclusive',taxRateBps:750}),{subtotalMinor:285000,taxMinor:21375,totalMinor:306375,taxRateBps:750});
  assert.throws(()=>conversion.totals(285000),{code:'FINANCE_POLICY_INCOMPLETE'});
  assert.throws(()=>conversion.totals(285000,{taxMode:'exclusive',taxRateBps:NaN}),{code:'FINANCE_POLICY_INCOMPLETE'});
  assert.throws(()=>conversion.totals(0),{code:'INVALID_INVOICE_AMOUNT'});
  assert.throws(()=>conversion.totals(Number.MAX_SAFE_INTEGER+1),{code:'INVALID_INVOICE_AMOUNT'});
});
test('invoice installments keep the exact agreed amount and date order',()=>{
  const schedule=[{dueDate:'2026-11-01',amountMinor:5000},{dueDate:'2026-12-01',amountMinor:5000}];
  assert.deepEqual(conversion.invoiceInstallments(schedule,10000,10000),schedule);
  assert.deepEqual(conversion.invoiceInstallments(schedule,10000,10751),[{dueDate:'2026-11-01',amountMinor:5376},{dueDate:'2026-12-01',amountMinor:5375}]);
});
test('invoice issue requires current tenant finance authority and selected issuer role',()=>{
  const tenantId=crypto.randomUUID(),ctx={audience:'tenant',identity:{id:crypto.randomUUID()},tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:crypto.randomUUID(),tenantId,role:'owner',status:'active'},category:trainingCenter,subscription:{status:'active',capabilities:['training.enrollments','finance.invoices']}};
  assert.doesNotThrow(()=>conversion.requireIssue(ctx,'owner'));
  assert.throws(()=>conversion.requireIssue(ctx,'accountant'),{code:'PERMISSION_DENIED'});
  assert.throws(()=>conversion.requireIssue({...ctx,subscription:{status:'active',capabilities:['training.enrollments']}},'owner'),{code:'FEATURE_UNAVAILABLE'});
  const agentContext={...ctx,membership:{...ctx.membership,role:'agent',id:'legacy-agent-17'},subscription:{status:'active',capabilities:['training.enrollments']}};
  assert.doesNotThrow(()=>conversion.requireIssue(agentContext,'agent'),'agents may complete a previously approved assigned sale');
  assert.throws(()=>conversion.requireIssue({...agentContext,subscription:{status:'active',capabilities:[]}},'agent'),{code:'FEATURE_UNAVAILABLE'});
});
test('invoice conversion is exposed by the existing pipeline and documented as a real contract',()=>{
  const fs=require('node:fs'),path=require('node:path'),read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
  assert.match(read('routes/pipeline.js'),/sale-reviews\/\:reviewId\/convert/);
  assert.match(read('database/migrations/20261012_training_finance_postings.sql'),/uq_training_invoice_sale_review/);
  assert.match(read('docs/API_DOCUMENTATION.md'),/Transactional sale conversion and invoices/);
  assert.match(read('client/public/pipeline/pipeline.js'),/convertApprovedSale/);
});
