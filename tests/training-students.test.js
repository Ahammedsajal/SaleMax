'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const students=require('../modules/platform/training-students');
const {trainingCenter}=require('../modules/platform/categories');
const context={audience:'tenant',identity:{id:'39bb978e-cf93-4b72-a5f9-211669cc4c67'},tenant:{id:'05cf4e43-7b6f-4dd9-9fa2-e153a7c08358',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'member',tenantId:'05cf4e43-7b6f-4dd9-9fa2-e153a7c08358',role:'owner',status:'active',delegatedPermissions:[]},category:trainingCenter,subscription:{status:'active',capabilities:['training.courses']},runtimeReady:{}};
test('attendance date picker uses Qatar local date at UTC day rollover',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require('node:path').join(__dirname,'../client/public/training-students.js'),'utf8');
  const start=source.indexOf('function todayInQatar()'),end=source.indexOf('\n  function readableData',start),helper=source.slice(start,end).trim();assert.ok(helper.startsWith('function todayInQatar()'),'Qatar-local date helper is present');
  class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-10-11T22:30:00.000Z']));}}
  const result=vm.runInNewContext('(()=>{'+helper+';return todayInQatar();})()',{Intl,Date:FixedDate});
  assert.equal(result,'2026-10-12');
  assert.match(source,/max="\$\{todayInQatar\(\)\}"/);
});
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
test('student profile returns tenant-scoped saved trainer choices for the assignment select',async()=>{
  const id='e4a72fc5-6242-45c6-a363-98fba2e43d9a',queries=[];
  const student={id,leadId:'lead-1',invoiceId:'invoice-1',totalMinor:'100',paidMinor:'0',creditedMinor:'0',subtotalMinor:'100',taxMinor:'0'};
  const db={query:async(sql,params)=>{
    queries.push({sql,params});
    if(sql.includes('FROM sx_training_enrollments e JOIN sx_training_invoices i'))return [[student],[]];
    if(sql.includes('SELECT DISTINCT TRIM(trainer_name)'))return [[{name:'Alex'},{name:'Mina'}],[]];
    if(sql.includes('FROM sx_training_form_submissions fs'))return [[],[]];
    if(sql.includes('FROM sx_training_student_attendance'))return [[],[]];
    if(sql.includes('FROM sx_training_enrollment_events'))return [[],[]];
    if(sql.includes('SELECT (SELECT COALESCE(SUM(x.amount_minor)'))return [[{scheduledMinor:'0',installmentCount:0}],[]];
    if(sql.includes('FROM sx_training_installments'))return [[],[]];
    if(sql.includes('FROM sx_training_payments p'))return [[],[]];
    if(sql.includes('FROM sx_training_invoice_lines'))return [[],[]];
    if(sql.includes('FROM sx_training_receipts'))return [[],[]];
    if(sql.includes('FROM sx_tenants t LEFT JOIN sx_training_center_profiles'))return [[{tenantName:'Training Center'}],[]];
    throw new Error(`Unexpected query: ${sql}`);
  }};
  const result=await students.profile(db,context,id);
  assert.deepEqual(result.trainerNames,['Alex','Mina']);
  const trainerQuery=queries.find(({sql})=>sql.includes('SELECT DISTINCT TRIM(trainer_name)'));
  assert.deepEqual(trainerQuery.params,[context.tenant.id]);
  assert.match(trainerQuery.sql,/tenant_id=\?/);
  const client=require('node:fs').readFileSync(require('node:path').join(__dirname,'../client/public/training-students.js'),'utf8');
  assert.match(client,/name="trainerChoice"/);
  assert.match(client,/__sx_add_trainer__/);
  assert.match(client,/const trainerName=trainerChoice\.value==='__sx_add_trainer__'\?customTrainerInput\.value:trainerChoice\.value/);
});
test('student form hides custom trainer entry and aligns attendance actions across breakpoints',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const client=fs.readFileSync(path.join(__dirname,'../client/public/training-students.js'),'utf8');
  const loader=fs.readFileSync(path.join(__dirname,'../client/public/training-courses.js'),'utf8');
  const tablet=client.slice(client.indexOf('@media(max-width:780px)'),client.indexOf('@media(max-width:440px)'));
  const mobile=client.slice(client.indexOf('@media(max-width:440px)'));
  assert.match(client,/#\$\{rootId\} \[hidden\]\{display:none!important\}/);
  assert.match(client,/#\$\{rootId\}\{position:fixed;z-index:1201;/);
  assert.match(client,/#\$\{rootId\} #sx-st-attendance-form\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/);
  assert.match(client,/#\$\{rootId\} #sx-st-trainer-form\{grid-template-columns:minmax\(0,1fr\) auto\}/);
  assert.match(tablet,/#\$\{rootId\} #sx-st-attendance-form\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(tablet,/#\$\{rootId\} #sx-st-trainer-form\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(mobile,/#\$\{rootId\} #sx-st-attendance-form\{grid-template-columns:1fr\}/);
  assert.match(mobile,/#\$\{rootId\} #sx-st-trainer-form\{grid-template-columns:1fr\}/);
  assert.match(loader,/training-students\.js\?v=20261012-trainer-picker2/);
});
