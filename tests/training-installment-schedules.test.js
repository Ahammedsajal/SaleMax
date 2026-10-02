'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const schedules=require('../modules/platform/training-installment-schedules');
const day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10);
test('installment schedule change request validates future ordered dates and integer QAR totals',()=>{
  const requestKey=crypto.randomUUID(),input={requestKey,expectedVersion:2,reason:'Customer requested new dates.',installments:[{dueDate:day(30),amountMinor:10000},{dueDate:day(60),amountMinor:20000}]};
  assert.deepEqual(schedules.normalize(input),{...input,totalMinor:30000,reason:'Customer requested new dates.'});
  for(const invalid of [{...input,expectedVersion:0},{...input,reason:'ok'},{...input,installments:[]},{...input,installments:[{dueDate:day(-1),amountMinor:30000}]},{...input,installments:[{dueDate:'2027-02-30',amountMinor:30000}]},{...input,installments:[{dueDate:day(30),amountMinor:10.5}]},{...input,installments:[{dueDate:day(60),amountMinor:10000},{dueDate:day(30),amountMinor:20000}]}])assert.throws(()=>schedules.normalize(invalid));
});
test('installment schedule approval requires a different actor',()=>{
  assert.throws(()=>schedules.approvalRule('same-identity','same-identity'),{code:'SCHEDULE_SECOND_APPROVER_REQUIRED'});
  assert.equal(schedules.approvalRule('owner-identity','accountant-identity'),true);
});
test('schedule change is documented and mounted in the existing Finance module',()=>{
  const fs=require('node:fs'),path=require('node:path'),read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  assert.match(read('modules/platform/training-finance-router.js'),/schedule-changes/);
  assert.match(read('modules/platform/training-invoices.js'),/scheduleState/);
  assert.match(read('docs/API_DOCUMENTATION.md'),/Installment schedule rescheduling and approval/);
  assert.match(read('docs/USER_MANUAL.md'),/Change future installment dates/);
});
