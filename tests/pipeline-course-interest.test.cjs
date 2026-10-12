'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const courses=require('../modules/platform/training-courses');

const context={audience:'tenant',identity:{id:'identity-a'},tenant:{id:'tenant-a',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'member-a',tenantId:'tenant-a',role:'owner',status:'active',delegatedPermissions:[]},category:require('../modules/platform/categories').trainingCenter,subscription:{status:'active',capabilities:['training.courses']},runtimeReady:{}};

test('lead intake suggestions return every active course inside the authorized tenant',async()=>{
  let statement,parameters;
  const expected=Array.from({length:137},(_,index)=>({id:`course-${index}`,nameEn:`Course ${index}`,nameAr:`دورة ${index}`}));
  const result=await courses.intakeOptions({query:async(sql,params)=>{statement=sql;parameters=params;return [expected];}},context);
  assert.equal(result.length,137,'the suggestion source does not truncate large catalogues');
  assert.deepEqual(result,expected);
  assert.deepEqual(parameters,['tenant-a']);
  assert.match(statement,/tenant_id=\? AND status='active' AND deleted_at IS NULL/);
  assert.match(statement,/ORDER BY name_en,name_ar,id/);
});

test('lead intake course suggestions respect feature and permission checks before reading data',async()=>{
  let queried=false;
  const db={query:async()=>{queried=true;return [[]];}};
  await assert.rejects(courses.intakeOptions(db,{...context,subscription:{status:'active',capabilities:[]}}),{code:'FEATURE_UNAVAILABLE'});
  assert.equal(queried,false);
});

test('Add Lead offers localized course suggestions while preserving free-form and multi-course input',()=>{
  const route=fs.readFileSync(require.resolve('../routes/pipeline'),'utf8');
  const screen=fs.readFileSync(require.resolve('../client/public/pipeline/pipeline.js'),'utf8');
  assert.match(route,/router\.get\('\/course-options'/);
  assert.match(route,/trainingCourses\.intakeOptions/);
  assert.match(screen,/name="qualification_courseInterest" list="course-interest-catalog" maxlength="180"/);
  assert.match(screen,/api\('\/course-options'\)/);
  assert.match(screen,/escape\(ar\?course\.nameAr:course\.nameEn\)/);
  assert.match(screen,/\$\{courseInterest\(\)\}\$\{textInput\('preferredSchedule'/);
  assert.doesNotMatch(screen,/qualification_courseInterest"[^>]*readonly|qualification_courseInterest"[^>]*required/);
});
