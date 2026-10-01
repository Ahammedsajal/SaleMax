const test=require('node:test');
const assert=require('node:assert/strict');
const {input,state,createHandler}=require('../modules/platform/legacy-plan-assignment');
test('existing assignment validates identifiers and stale-state tokens without coercion',()=>{
  const valid={uid:'business',plan:{id:'7'}};
  assert.equal(input(valid,'admin').planId,7);
  for(const body of [null,[],{}, {...valid,uid:' business '},{...valid,plan:{id:true}},{...valid,plan:{id:'7x'}},{...valid,plan:{id:1.5}},{...valid,requestId:'invalid'},{...valid,expectedState:'invalid'}])assert.throws(()=>input(body,'admin'));
  assert.throws(()=>input(valid,''),{code:'ADMIN_REQUIRED'});
  assert.notEqual(state({plan:'{}',plan_expire:'1'}),state({plan:'{}',plan_expire:'2'}));
});
test('invalid assignment handlers cannot acquire a connection and errors remain bounded',async()=>{
  let response,calls=0;
  const handler=createHandler({getConnection:async()=>{calls++;throw Error('private credentials');}});
  const res={json:body=>{response=body;}};
  await handler({body:{uid:'business',plan:{id:1}}},res);assert.equal(response.code,'ADMIN_REQUIRED');assert.equal(calls,0);
  await handler({body:{uid:'business',plan:{id:1}},decode:{uid:'admin'}},res);assert.equal(response.code,'ASSIGNMENT_FAILED');assert.ok(!JSON.stringify(response).includes('private'));
});
