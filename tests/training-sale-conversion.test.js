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
test('invoice issue requires current tenant finance authority and selected issuer role',()=>{
  const tenantId=crypto.randomUUID(),ctx={audience:'tenant',identity:{id:crypto.randomUUID()},tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:crypto.randomUUID(),tenantId,role:'owner',status:'active'},category:trainingCenter,subscription:{status:'active',capabilities:['training.enrollments','finance.invoices']}};
  assert.doesNotThrow(()=>conversion.requireIssue(ctx,'owner'));
  assert.throws(()=>conversion.requireIssue(ctx,'accountant'),{code:'PERMISSION_DENIED'});
  assert.throws(()=>conversion.requireIssue({...ctx,subscription:{status:'active',capabilities:['training.enrollments']}},'owner'),{code:'FEATURE_UNAVAILABLE'});
  assert.throws(()=>conversion.requireIssue({...ctx,membership:{...ctx.membership,role:'agent'}},'agent'),{code:'PERMISSION_DENIED'});
});
test('invoice conversion is exposed by the existing pipeline and documented as a real contract',()=>{
  const fs=require('node:fs'),path=require('node:path'),read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
  assert.match(read('routes/pipeline.js'),/sale-reviews\/\:reviewId\/convert/);
  assert.match(read('database/migrations/20261012_training_finance_postings.sql'),/uq_training_invoice_sale_review/);
  assert.match(read('docs/API_DOCUMENTATION.md'),/Transactional sale conversion and invoices/);
  assert.match(read('client/public/pipeline/pipeline.js'),/convertApprovedSale/);
});
