'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const progress=require('../modules/platform/training-enrollment-progress');
const {trainingCenter}=require('../modules/platform/categories');
const context=(role='owner')=>({audience:'tenant',identity:{id:'11111111-1111-4111-8111-111111111111'},tenant:{id:'22222222-2222-4222-8222-222222222222',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'33333333-3333-4333-8333-333333333333',tenantId:'22222222-2222-4222-8222-222222222222',role,status:'active'},category:trainingCenter,subscription:{status:'active',capabilities:['training.courses']}});
const enrollment='44444444-4444-4444-8444-444444444444';

test('enrollment progress is manager/owner scoped to active training course capability',()=>{
  assert.doesNotThrow(()=>progress.authorize(context('owner')));
  assert.doesNotThrow(()=>progress.authorize(context('manager')));
  assert.throws(()=>progress.authorize(context('accountant')),{code:'PERMISSION_DENIED'});
  assert.throws(()=>progress.authorize({...context(),subscription:{status:'active',capabilities:[]}}),{code:'FEATURE_UNAVAILABLE'});
});

test('a course cannot be completed or certified until the full invoice is paid',async()=>{
  const db={async beginTransaction(){},async commit(){},async rollback(){},async query(sql){
    if(sql.includes('SELECT t.name AS tenantName'))return [[{tenantName:'Training',nameEn:'Center English',nameAr:'مركز عربي',logoUrl:'/media/logo.png'}]];
    if(sql.includes('FROM sx_tenants'))return [[]];
    if(sql.includes('FROM sx_training_enrollments e JOIN sx_training_invoices'))return [[{id:enrollment,status:'started',learner_name:'Learner',course_id:'course',started_at:new Date(),completed_at:null,invoice_id:'invoice',total_minor:'200000',name_en:'Course',name_ar:'دورة'}]];
    if(sql.includes('AS paid_minor'))return [[{paid_minor:'199999'}]];
    throw Error(`Unexpected query: ${sql}`);
  }};
  await assert.rejects(progress.transition(db,context(),enrollment,{action:'complete'}),{code:'FULL_PAYMENT_REQUIRED'});
  await assert.rejects(progress.transition(db,context(),enrollment,{action:'issue_certificate'}),{code:'FULL_PAYMENT_REQUIRED'});
});

test('starting a reserved enrollment is recorded once as a tenant-scoped event',async()=>{
  const calls=[];const db={async beginTransaction(){calls.push('begin')},async commit(){calls.push('commit')},async rollback(){calls.push('rollback')},async query(sql,params){calls.push({sql,params});
    if(sql.includes('FROM sx_training_enrollments e JOIN sx_training_invoices'))return [[{id:enrollment,status:'reserved',learner_name:'Learner',course_id:'course',invoice_id:'invoice',total_minor:'200000',name_en:'Course',name_ar:'دورة'}]];
    return [[]];
  }};
  const result=await progress.transition(db,context(),enrollment,{action:'start'});
  assert.equal(result.status,'started');assert.equal(result.repeated,false);
  assert.ok(calls.some(call=>typeof call==='object'&&call.sql.includes("'course_started'")));
  assert.equal(calls.at(-1),'commit');
});

test('certificate issue requires completed status and returns no external dispatch claim',async()=>{
  const calls=[];const db={async beginTransaction(){},async commit(){},async rollback(){},async query(sql,params){calls.push({sql,params});
    if(sql.includes('FROM sx_training_enrollments e JOIN sx_training_invoices'))return [[{id:enrollment,status:'completed',learner_name:'Learner',course_id:'course',invoice_id:'invoice',total_minor:'200000',name_en:'Course',name_ar:'دورة'}]];
    if(sql.includes('AS paid_minor'))return [[{paid_minor:'200000'}]];
    if(sql.includes('FROM sx_training_certificates'))return [[]];
    if(sql.includes('SELECT last_value'))return [[{last_value:12}]];
    return [[]];
  }};
  const result=await progress.transition(db,context(),enrollment,{action:'issue_certificate'});
  assert.equal(result.certificate.certificateNumber.startsWith('CERT-'),true);assert.equal(result.certificate.externalDispatch,false);
  assert.ok(calls.some(call=>call.sql.includes('INSERT INTO sx_training_certificates')));
  assert.ok(calls.some(call=>call.sql.includes("'certificate_issued'")));
});
