'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const plan=require('../modules/platform/invoice-communication-plan'),settings=require('../modules/platform/invoice-communications-settings').defaults();
function document(){return {id:'invoice',revision:1,status:'generated',email:'learner@example.invalid',phone:'50313785',installments:[{id:'term',sequence:1,dueDate:'2026-10-24',amountMinor:'10000'}]};}
test('invoice creation plans one email and WhatsApp document delivery with stable keys',()=>{
  const result=plan.invoice(document(),settings);assert.equal(result.jobs.length,2);assert.equal(result.jobs[1].recipient,'+97450313785');assert.equal(result.jobs[0].idempotencyKey,plan.invoice(document(),settings).jobs[0].idempotencyKey);
  assert.equal(plan.invoice({...document(),email:'',phone:''},settings).skipped.length,2);assert.equal(plan.invoice({...document(),deleted:true},settings).jobs.length,0);
});
test('reminders are due exactly 7, 3 and 1 day before payment and on the payment date',()=>{
  for(const day of ['2026-10-17','2026-10-21','2026-10-23','2026-10-24'])assert.equal(plan.reminders(document(),settings,day).jobs.length,2);
  for(const day of ['2026-10-16','2026-10-18','2026-10-22'])assert.equal(plan.reminders(document(),settings,day).jobs.length,0);
});
test('missed payments get distinct daily plans with no 90-day cutoff',()=>{
  const first=plan.reminders(document(),settings,'2026-10-25').jobs[0],second=plan.reminders(document(),settings,'2026-10-26').jobs[0];assert.notEqual(first.idempotencyKey,second.idempotencyKey);
  assert.equal(plan.reminders(document(),settings,'2030-01-01').jobs.length,2);assert.equal(plan.reminders(document(),{...settings,dailyOverdue:false},'2026-10-25').jobs.length,0);
});
test('only posted payments with issued receipts reduce the amount; partial receipts retain the remainder',()=>{
  const allocations=[{installmentId:'term',status:'pending_verification',receiptId:null,amountMinor:10000},{installmentId:'term',status:'posted',receiptId:null,amountMinor:10000},{installmentId:'term',status:'posted',receiptId:'receipt',amountMinor:4000,reversedMinor:1000}];
  const result=plan.reminders(document(),settings,'2026-10-25',{allocations});assert.equal(result.jobs[0].amountMinor,'7000');
  allocations.push({installmentId:'term',status:'posted',receiptId:'receipt-2',amountMinor:7000});assert.equal(plan.reminders(document(),settings,'2026-10-25',{allocations}).jobs.length,0);
});
test('dispatch rechecks payment, recipient, revision, cancellation and current balance',()=>{
  const doc=document(),job=plan.reminders(doc,settings,'2026-10-25').jobs[0];
  for(const changed of [{...doc,revision:2},{...doc,deleted:true},{...doc,replaced:true},{...doc,optedOut:true},{...doc,disputed:true},{...doc,email:'other@example.invalid'}])assert.equal(plan.recheck(job,changed,settings,'2026-10-25').status,'suppressed');
  assert.equal(plan.recheck(job,doc,settings,'2026-10-26').status,'suppressed');
  const partial=plan.recheck(job,doc,settings,'2026-10-25',{allocations:[{installmentId:'term',status:'posted',receiptId:'r',amountMinor:2000}]});assert.equal(partial.job.amountMinor,'8000');
});
test('reminder arithmetic is exact and refuses inconsistent amounts',()=>{
  assert.equal(plan.balance({id:'term',amountMinor:'90071992547409931234'}).openMinor,'90071992547409931234');
  assert.throws(()=>plan.balance({id:'term',amountMinor:100},[{installmentId:'term',receiptId:'r',status:'posted',amountMinor:101}]));
  assert.throws(()=>plan.reminders(document(),settings,'2026-02-30'));
});
