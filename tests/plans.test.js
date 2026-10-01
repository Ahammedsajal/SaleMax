const test=require('node:test');
const assert=require('node:assert/strict');
const {definition,limits}=require('../modules/platform/plans');
const {trainingCenter}=require('../modules/platform/categories');
const valid=()=>({categoryKey:trainingCenter.key,categoryVersion:1,capabilities:['team.members','training.courses'],roleLimits:{owner:1,accountant:1,manager:1,agent:7}});
test('plan definitions require trusted category capabilities and exact nonnegative role limits',()=>{
  assert.equal(definition(valid()).roleLimits.agent,7);
  for(const value of [null,[],{owner:1},{owner:2,accountant:1,manager:1,agent:7},{owner:1,accountant:1,manager:1,agent:-1},{owner:1,accountant:1,manager:1,agent:1.5}])assert.throws(()=>limits(value));
  for(const capabilities of [[],['invented'],['team.members','team.members'],'team.members'])assert.throws(()=>definition({...valid(),capabilities}),{code:'INVALID_CAPABILITIES'});
  assert.throws(()=>definition({...valid(),categoryKey:'restaurant_fixture'}),{code:'CATEGORY_UNAVAILABLE'});
});
