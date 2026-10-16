'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const routing=require('../helper/pipeline/openingRouting');
test('opening routing normalizes English/Arabic phrases and respects priority, exact matching and disabled rules',()=>{
  const rules=[{id:'off',enabled:0,keywords:['nursing'],matchMode:'contains'},{id:'exact',enabled:1,keywords:['nursing'],matchMode:'exact'},{id:'contains',enabled:1,keywords:['NURSING','تمريض'],matchMode:'contains'}];
  assert.equal(routing.matchRule('  NURSING  ',rules).rule.id,'exact');
  assert.equal(routing.matchRule('Tell me about nursing',rules).rule.id,'contains');
  assert.equal(routing.matchRule('أريد معلومات عن التمريض',rules).keyword,'تمريض');
  assert.equal(routing.matchRule('hello',rules),null);
  assert.equal(routing.matchRule('',rules),null);
  assert.equal(routing.matchRule('a.b',[{enabled:1,keywords:['a.b'],matchMode:'exact'}]).keyword,'a.b');
  assert.equal(routing.matchRule('axb',[{enabled:1,keywords:['a.b'],matchMode:'exact'}]),null);
});
test('routing input validates finite choices, normalizes duplicate keywords and caps configuration',()=>{
  const good={name:'Nursing interest',keywords:[' Nursing ','nursing','تمريض'],phonebookId:1,agentId:2,position:5,enabled:true};
  assert.deepEqual(routing.input(good).keywords,['nursing','تمريض']);
  for(const invalid of [{...good,agentId:0},{...good,phonebookId:NaN},{...good,keywords:[]},{...good,keywords:Array(31).fill('x')},{...good,matchMode:'regex'},{...good,enabled:'false'},{...good,name:' '},{...good,position:0}])assert.throws(()=>routing.input(invalid));
});
test('later messages, paused leads and closed leads never run opening rules',async()=>{
  const db={query:()=>{throw Error('No query should run');}};
  for(const fields of [{isOpening:false,lead:{}},{isOpening:true,lead:{automation_paused:1}},{isOpening:true,lead:{status:'won'}}])assert.equal(await routing.applyOpening(db,fields),null);
});
