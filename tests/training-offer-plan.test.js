'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const plans=require('../modules/platform/training-offer-plan');

test('manager-configured monthly and weekly plans produce exact integer schedules',()=>{
  assert.deepEqual(plans.expectedSchedule(200000,4,'monthly','2026-01-31'),[
    {dueDate:'2026-01-31',amountMinor:50000},{dueDate:'2026-02-28',amountMinor:50000},{dueDate:'2026-03-31',amountMinor:50000},{dueDate:'2026-04-30',amountMinor:50000},
  ]);
  assert.deepEqual(plans.expectedSchedule(10001,2,'weekly','2026-11-01'),[
    {dueDate:'2026-11-01',amountMinor:5000},{dueDate:'2026-11-08',amountMinor:5001},
  ]);
});

test('only the published full-price offer plan qualifies for agent auto-approval',()=>{
  const approved=plans.expectedSchedule(200000,4,'monthly','2026-11-01');
  assert.equal(plans.matchesSchedule(approved,200000,4,'monthly'),true);
  assert.equal(plans.matchesSchedule(approved,199000,4,'monthly'),false);
  assert.equal(plans.matchesSchedule(approved,200000,3,'monthly'),false);
  assert.equal(plans.matchesSchedule(approved,200000,4,'weekly'),false);
});
