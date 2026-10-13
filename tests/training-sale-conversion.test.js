'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const conversion=require('../modules/platform/training-sale-conversion');
const {trainingCenter}=require('../modules/platform/categories');
test('sale conversion issues the agreed QAR amount without tax or a finance policy',()=>{
  const expected={subtotalMinor:285000,taxMinor:0,totalMinor:285000,taxRateBps:null};
  assert.deepEqual(conversion.totals(285000),expected);
  assert.deepEqual(conversion.totals(285000,{taxMode:'exclusive',taxRateBps:750}),expected,'legacy tax settings do not affect new invoices');
  assert.throws(()=>conversion.totals(0),{code:'INVALID_INVOICE_AMOUNT'});
  assert.throws(()=>conversion.totals(Number.MAX_SAFE_INTEGER+1),{code:'INVALID_INVOICE_AMOUNT'});
});
test('invoice installments keep the exact agreed amount and date order',()=>{
  const schedule=[{dueDate:'2026-11-01',amountMinor:5000},{dueDate:'2026-12-01',amountMinor:5000}];
  assert.deepEqual(conversion.invoiceInstallments(schedule,10000,10000),schedule);
  assert.throws(()=>conversion.invoiceInstallments(schedule,10000,10751),{code:'INVALID_INVOICE_AMOUNT'});
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
test('generated PDF conversion requires an exact approved customer, course, price, currency and installment match',()=>{
  const leadId=crypto.randomUUID(),contactId=crypto.randomUUID(),courseId=crypto.randomUUID(),review={course_id:courseId,currency:'QAR',net_minor:10000,learner_name:'Learner One',payer_name:'Payer One',payer_email:'payer@example.invalid',invoice_email:'billing@example.invalid',payer_phone:'+97450000000',installments:[{dueDate:'2026-11-01',amountMinor:5000},{dueDate:'2026-12-01',amountMinor:5000}]};
  const doc={customer_type:'contact',customer_id:contactId,customer_name:'Payer One',course_id:courseId,amount_minor:10000};
  const snapshot={currency:'QAR',customer:{email:'billing@example.invalid',phone:'+974 5000 0000'},installments:[{dueDate:'2026-11-01',amountMinor:5000},{dueDate:'2026-12-01',amountMinor:5000}]};
  assert.equal(conversion.generatedDocumentMatches(doc,snapshot,{id:leadId,contact_id:contactId},review),true);
  assert.equal(conversion.generatedDocumentMatches({...doc,amount_minor:9999},snapshot,{id:leadId,contact_id:contactId},review),false);
  assert.equal(conversion.generatedDocumentMatches(doc,{...snapshot,currency:'USD'},{id:leadId,contact_id:contactId},review),false);
  assert.equal(conversion.generatedDocumentMatches(doc,{...snapshot,installments:[{dueDate:'2026-11-02',amountMinor:5000},{dueDate:'2026-12-01',amountMinor:5000}]},{id:leadId,contact_id:contactId},review),false);
  assert.equal(conversion.generatedDocumentMatches({...doc,customer_type:'manual',customer_id:null},snapshot,{id:leadId,contact_id:contactId},review),false);
});
