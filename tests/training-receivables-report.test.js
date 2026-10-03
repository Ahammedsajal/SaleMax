'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const report=require('../modules/platform/training-receivables-report');

test('receivables report bounds paging and accepts only defined aging filters',()=>{
  assert.deepEqual(report.inputShape({page:'2',limit:'50',bucket:'31-60',q:'Aisha',from:'2026-10-01',to:'2026-10-31'}),{page:2,limit:50,bucket:'31-60',q:'Aisha',from:'2026-10-01',to:'2026-10-31'});
  assert.deepEqual(report.inputShape(),{page:1,limit:25,bucket:'all',q:'',from:'',to:''});
  for(const input of [{bucket:'future'},{page:0},{limit:101},{q:'x'.repeat(81)},{from:'2026-02-30'},{from:'2026-10-11',to:'2026-10-10'}])assert.throws(()=>report.inputShape(input));
});

test('receivables report uses a Qatar-local ISO report date',()=>{
  assert.match(report.todayQatar(),/^\d{4}-\d{2}-\d{2}$/);
});
