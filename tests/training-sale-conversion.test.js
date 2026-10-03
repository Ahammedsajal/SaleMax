'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const conversion=require('../modules/platform/training-sale-conversion');
const {trainingCenter}=require('../modules/platform/categories');
const basePolicy={taxMode:'no_tax',taxRateBps:null};
test('sale conversion computes deterministic QAR minor-unit tax totals',()=>{
  assert.deepEqual(conversion.totals(285000,{...basePolicy}),{subtotalMinor:285000,taxMinor:0,totalMinor:285000,taxRateBps:null});
  assert.deepEqual(conversion.totals(10001,{taxMode:'exclusive',taxRateBps:750}),{subtotalMinor:10001,taxMinor:750,totalMinor:10751,taxRateBps:750});
  assert.deepEqual(conversion.totals(10751,{taxMode:'inclusive',taxRateBps:750}),{subtotalMinor:10001,taxMinor:750,totalMinor:10751,taxRateBps:750});
  assert.throws(()=>conversion.totals(Number.MAX_SAFE_INTEGER,{taxMode:'exclusive',taxRateBps:10000}),{code:'INVALID_INVOICE_AMOUNT'});
  assert.throws(()=>conversion.totals(100,{taxMode:'unset',taxRateBps:null}),{code:'FINANCE_POLICY_INCOMPLETE'});
});
test('tax is apportioned across installments without changing their date order',()=>{
  const schedule=conversion.invoiceInstallments([{dueDate:'2026-11-01',amountMinor:5000},{dueDate:'2026-12-01',amountMinor:5000}],10000,10751);
  assert.deepEqual(schedule,[{dueDate:'2026-11-01',amountMinor:5376},{dueDate:'2026-12-01',amountMinor:5375}]);
  assert.equal(schedule.reduce((sum,row)=>sum+row.amountMinor,0),10751);
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
