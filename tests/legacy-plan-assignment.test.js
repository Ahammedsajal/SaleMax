const test=require('node:test');
const assert=require('node:assert/strict');
const {input,state,createHandler,preview}=require('../modules/platform/legacy-plan-assignment');
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
test('mapped businesses keep the canonical-assignment code and never write through the legacy handler',async()=>{
  let response,writes=0,rolledBack=false,released=false;
  const db={
    async query(sql){
      if(sql.includes('TABLE_NAME,ENGINE'))return [[{TABLE_NAME:'user',ENGINE:'InnoDB'},{TABLE_NAME:'plan',ENGINE:'InnoDB'},{TABLE_NAME:'sx_legacy_plan_assignments',ENGINE:'InnoDB'}],[]];
      if(sql.includes("TABLE_NAME='sx_legacy_ownership'"))return [[{ENGINE:'InnoDB'}],[]];
      if(sql.startsWith('SELECT id,uid,plan,plan_expire'))return [[{id:7,uid:'synthetic-business',plan:'{}',plan_expire:'123'}],[]];
      if(sql.startsWith('SELECT owner_uid,actor_uid'))return [[],[]];
      if(sql.startsWith('SELECT tenant_id FROM sx_legacy_ownership'))return [[{tenant_id:'synthetic-tenant'}],[]];
      writes++;return [{affectedRows:1},[]];
    },beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rolledBack=true;}
  };
  const handler=createHandler({getConnection:async()=>({ ...db, release:()=>{released=true;} })});
  await handler({body:{uid:'synthetic-business',plan:{id:1}},decode:{uid:'synthetic-admin'}},{json:body=>{response=body;}});
  assert.equal(response.code,'CANONICAL_ASSIGNMENT_REQUIRED');
  assert.match(response.msg,/reviewed training-center contract/);
  assert.equal(writes,0);assert.equal(rolledBack,true);assert.equal(released,true);
});
test('legacy assignment preview redirects mapped businesses before reading catalogue terms',async()=>{
  let planRead=false,rolledBack=false;
  const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rolledBack=true;},async query(sql){
    if(sql.startsWith('SELECT id,uid,plan,plan_expire'))return [[{id:7,uid:'synthetic-business',plan:'{}',plan_expire:'123'}],[]];
    if(sql.includes("TABLE_NAME='sx_legacy_ownership'"))return [[{ENGINE:'InnoDB'}],[]];
    if(sql.startsWith('SELECT tenant_id FROM sx_legacy_ownership'))return [[{tenant_id:'synthetic-tenant'}],[]];
    if(sql.startsWith('SELECT * FROM plan')){planRead=true;return [[{id:1,plan_duration_in_days:30}],[]];}
    throw new Error('Unexpected query');
  }};
  await assert.rejects(preview(db,'synthetic-admin',{uid:'synthetic-business',plan:{id:1}}),{code:'CANONICAL_ASSIGNMENT_REQUIRED'});
  assert.equal(planRead,false);assert.equal(rolledBack,true);
});
