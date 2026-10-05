'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const students=require('../modules/platform/training-students');
const {trainingCenter}=require('../modules/platform/categories');
const context={audience:'tenant',identity:{id:'39bb978e-cf93-4b72-a5f9-211669cc4c67'},tenant:{id:'05cf4e43-7b6f-4dd9-9fa2-e153a7c08358',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'member',tenantId:'05cf4e43-7b6f-4dd9-9fa2-e153a7c08358',role:'owner',status:'active',delegatedPermissions:[]},category:trainingCenter,subscription:{status:'active',capabilities:['training.courses']},runtimeReady:{}};
test('student directory bounds pagination, search and status filters',()=>{
  assert.deepEqual(students.input({page:'2',limit:'40',search:'  +974 555  ','status':'started'}),{page:2,limit:40,search:'+974 555',status:'started'});
  assert.throws(()=>students.input({page:'-1'}),{code:'INVALID_STUDENT_PAGE'});
  assert.throws(()=>students.input({limit:'1000'}),{code:'INVALID_STUDENT_PAGE'});
  assert.throws(()=>students.input({status:'unknown'}),{code:'INVALID_STUDENT_STATUS'});
});
test('student directory queries are tenant scoped and bounded',async()=>{
  const queries=[],db={query:async(sql,params)=>{queries.push({sql,params});if(sql.includes('COUNT(*) total'))return [[{total:0}],[]];return [[],[]];}};
  const result=await students.list(db,context,{page:'1',limit:'24',search:'learner@example.qa'});
  assert.equal(result.total,0);assert.equal(queries.length,3);
  assert.ok(queries.every(({sql})=>sql.includes('tenant_id=?')));
  assert.ok(queries[1].sql.includes('JSON_EXTRACT'));
  assert.deepEqual(queries[1].params.slice(-2),[24,0]);
});
test('student profile rejects invalid IDs before querying',async()=>{
  let called=false;await assert.rejects(()=>students.profile({query:async()=>{called=true;}},context,'not-an-id'),{code:'INVALID_STUDENT_ID'});assert.equal(called,false);
});
