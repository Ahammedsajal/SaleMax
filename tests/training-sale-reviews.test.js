'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const reviews=require('../modules/platform/training-sale-reviews');
const {trainingCenter,restaurantFixture}=require('../modules/platform/categories');
const policy=require('../modules/platform/policy');
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const valid={requestKey:crypto.randomUUID(),courseId:crypto.randomUUID(),offerId:crypto.randomUUID(),batchId:null,priceMinor:300000,discountMinor:15000,learnerName:'Aisha Learner',payerName:'Family Payer',payerEmail:'payer@example.qa',payerPhone:'+97450000123',invoiceEmail:'billing@example.qa',terms:'Payment due in full before the course starts.',installments:[{amountMinor:285000,dueDate:today}],expectedLeadUpdatedAt:new Date().toISOString()};
test('sale-review request validates Qatar QAR snapshots and exact installments without float math',()=>{
  const parsed=reviews.normalize(valid);assert.equal(parsed.priceMinor,300000);assert.equal(parsed.discountMinor,15000);assert.equal(parsed.installments[0].amountMinor,285000);
  assert.equal(reviews.normalize({...valid,invoiceEmail:''}).invoiceEmail,'payer@example.qa');
  for(const input of [{...valid,priceMinor:300000.5},{...valid,discountMinor:300001},{...valid,installments:Array(13).fill({amountMinor:1,dueDate:today})},{...valid,payerEmail:'bad'},{...valid,payerEmail:'',payerPhone:''},{...valid,invoiceEmail:'bad'},{...valid,terms:''},{...valid,tenantId:'foreign-tenant'},{...valid,installments:[{amountMinor:285000,dueDate:'2020-01-01'}]}])assert.throws(()=>reviews.normalize(input));
});
test('sale requests require the training enrollment capability and role permission',()=>{
  const base={audience:'tenant',identity:{id:crypto.randomUUID()},tenant:{id:crypto.randomUUID(),status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:crypto.randomUUID(),tenantId:'',role:'agent',status:'active'},category:trainingCenter,subscription:{status:'active',capabilities:['training.enrollments']}};base.membership.tenantId=base.tenant.id;
  assert.equal(policy.decision(base,{capability:'training.enrollments',permission:'sales.request'}).allowed,true);
  assert.equal(policy.decision(base,{capability:'training.enrollments',permission:'sales.approve'}).code,'PERMISSION_DENIED');
  assert.equal(policy.decision({...base,category:restaurantFixture},{capability:'training.enrollments',permission:'sales.request'}).code,'CATEGORY_UNAVAILABLE');
  assert.equal(policy.decision({...base,subscription:{status:'active',capabilities:[]}},{capability:'training.enrollments',permission:'sales.request'}).code,'FEATURE_UNAVAILABLE');
});
test('sale review API and bilingual screen are integrated into the existing pipeline drawer',()=>{
  const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');const ui=fs.readFileSync(path.join(root,'client/public/pipeline/pipeline.js'),'utf8'),router=fs.readFileSync(path.join(root,'routes/pipeline.js'),'utf8'),css=fs.readFileSync(path.join(root,'client/public/pipeline/pipeline.css'),'utf8');
  assert.match(ui,/sale-review-area/);assert.match(ui,/saleReviewDescription/);assert.match(ui,/مراجعة البيع/);assert.match(ui,/installmentTotalMismatch/);assert.match(ui,/financeBlocker/);assert.match(router,/\/sale-options/);assert.match(router,/sale-reviews\/\:reviewId\/decision/);assert.match(css,/sale-review-form/);
});
