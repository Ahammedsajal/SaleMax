'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const workflow=require('../modules/platform/training-registration-workflow'),schema=require('../modules/platform/training-registration-schema');
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
