'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {rates,calculate}=require('../modules/platform/sales-commission-calculator');

test('commission policy accepts explicit role rates and rejects an overallocated split',()=>{
  assert.deepEqual(rates({agentRateBps:500,teamLeaderRateBps:200,managerRateBps:100}),{agent:500,teamLeader:200,manager:100});
  assert.throws(()=>rates({agentRateBps:8000,teamLeaderRateBps:2000,managerRateBps:1}),error=>error.code==='COMMISSION_SPLIT_EXCEEDS_SALE');
  assert.throws(()=>rates({agentRateBps:1.5,teamLeaderRateBps:0,managerRateBps:0}),error=>error.code==='INVALID_COMMISSION_RATE');
});

test('commission amount calculation uses integer minor units and half-up basis-point rounding',()=>{
  assert.deepEqual(calculate('10001',{agentRateBps:333,teamLeaderRateBps:111,managerRateBps:56}),{
    grossMinor:'10001',commissionMinor:'500',rows:[
      {role:'agent',rateBps:333,amountMinor:'333'},
      {role:'teamLeader',rateBps:111,amountMinor:'111'},
      {role:'manager',rateBps:56,amountMinor:'56'},
    ],
  });
  assert.throws(()=>calculate('0',{agentRateBps:0,teamLeaderRateBps:0,managerRateBps:0}),error=>error.code==='INVALID_SALE_AMOUNT');
});
