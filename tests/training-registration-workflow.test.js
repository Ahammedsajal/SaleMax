'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const workflow=require('../modules/platform/training-registration-workflow'),schema=require('../modules/platform/training-registration-schema');
const selections=require('../modules/platform/training-registration-selections');
const crypto=require('node:crypto');
test('digital signature rejects empty, tiny, malformed and out-of-bounds drawings',()=>{
 for(const input of ['Student name','[]','[[[0,0]]]','[[[0,0],[2,1]]]','[[["x",0]]]'])assert.throws(()=>workflow.signature(input),{code:'INVALID_SIGNATURE'});
 const signature=JSON.stringify([Array.from({length:12},(_,i)=>[i/15,0.2+i/20])]);assert.equal(workflow.signature(signature),signature);
});
test('upgraded registration requires the commercial selections and a digital signature',()=>{
 const upgraded=schema.upgrade({fields:[{key:'contact_name'}],consentTextEn:'Agreement'});
 for(const key of ['course_id','payment_plan_id','source','email','student_signature','consent'])assert.equal(upgraded.fields.find(f=>f.key===key).required,true);
 assert.equal(upgraded.fields.find(f=>f.key==='qid').required,false);assert.ok(!upgraded.fields.some(f=>f.key==='student_id'));
});
test('provisional notification contains installment amounts without identity or signature disclosure',()=>{
 const message=require('../modules/platform/training-registration-delivery').content({studentNumber:'ENG-2026-000001',provisionalInvoiceNumber:'PF-ENG-2026-000001',courseNameEn:'English',totalMinor:10001,installments:[{dueDate:'2026-10-09',amountMinor:10001}]},{contact_name:'Synthetic candidate',qid:'private-id',student_signature:'private-signature'});
 assert.match(message,/QAR 100.01/);assert.match(message,/pending approval/);assert.ok(!message.includes('private-id'));assert.ok(!message.includes('private-signature'));
});
test('course selections preserve per-course plans and reject duplicates, malformed rows and oversized combos',()=>{
 const a={course_id:crypto.randomUUID(),payment_plan_id:'full'},b={course_id:crypto.randomUUID(),payment_plan_id:'offer:'+crypto.randomUUID(),class_day:'weekends'};
 assert.equal(selections.normalize({course_selections:[a,b]})[1].class_day,'weekends');
 assert.equal(selections.normalize(a)[0].payment_plan_id,'full');
 for(const rows of [[],Array(11).fill(a),[a,a],[{...a,extra:'injected'}],[{...a,payment_plan_id:''}]])assert.throws(()=>selections.normalize({course_selections:rows}));
 const values=require('../modules/platform/training-forms').cleanSubmission(schema.upgrade({}),{contact_name:'Synthetic',phone:'+97450000999',email:'test@example.invalid',source:'Walk-In',course_selections:[a,b],student_signature:JSON.stringify([Array.from({length:12},(_,i)=>[i/15,0.2+i/20])]),consent:true});
 assert.equal(values.course_id,a.course_id);assert.equal(values.course_selections.length,2);
});
test('a multi-course response includes every separate registration and the exact aggregate payment amounts',()=>{
 const item=n=>({studentNumber:'COURSE-'+n,courseNameEn:'Course '+n,courseNameAr:'دورة '+n,provisionalInvoiceNumber:'PF-'+n,totalMinor:n*10001,installments:[{dueDate:'2026-10-11',amountMinor:n*10001}]});
 const result=selections.summary([item(1),item(2)]);assert.equal(result.totalMinor,30003);assert.equal(result.registrations.length,2);assert.equal(result.installments.reduce((n,p)=>n+p.amountMinor,0),30003);assert.equal(result.installments[1].billNo,'PF-2');
});
test('enquiry applications accept multiple course interests without requiring registration payment plans',()=>{
 const forms=require('../modules/platform/training-forms'),ids=[crypto.randomUUID(),crypto.randomUUID()],fields=['contact_name','phone','consent','course_id'].map(key=>({key,required:true}));
 const result=forms.cleanSubmission({fields},{contact_name:'Synthetic',phone:'+97450000999',consent:true,course_ids:ids});assert.deepEqual(result.course_ids,ids);assert.equal(result.course_id,ids[0]);assert.throws(()=>forms.cleanSubmission({fields},{contact_name:'Synthetic',phone:'+97450000999',consent:true,course_ids:[ids[0],ids[0]]}),{code:'INVALID_COURSE_SELECTIONS'});
});
