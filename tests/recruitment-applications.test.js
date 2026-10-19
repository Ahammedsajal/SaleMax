'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {getCategory}=require('../modules/platform/categories');
const recruitment=require('../modules/platform/recruitment-applications');
const {decision}=require('../modules/platform/policy');

const owner={audience:'tenant',tenant:{id:'11111111-1111-4111-8111-111111111111',status:'active',categoryKey:'salemax_sales',categoryVersion:1},membership:{id:'22222222-2222-4222-8222-222222222222',tenantId:'11111111-1111-4111-8111-111111111111',role:'owner',status:'active'},category:getCategory('salemax_sales',1),subscription:{status:'active',capabilities:['hr.recruitment']}};
const valid={submissionToken:'33333333-3333-4333-8333-333333333333',fullName:'Asha Candidate',mobile:'+91 98765 43210',email:'asha@example.in',englishLevel:'proficient',hindiLevel:'conversational',experienceYears:'4',crmSaasExperience:'Four years in SaaS and CRM sales.',availability:'either',consent:'on'};

test('recruitment form validates and normalizes applicant details',()=>{
  const result=recruitment.cleanApplication(valid);
  assert.equal(result.fullName,'Asha Candidate');assert.equal(result.normalizedMobile,'+919876543210');assert.equal(result.email,'asha@example.in');assert.equal(result.experienceYears,4);assert.equal(result.sourceChannel,'public_form');
});
test('recruitment requires explicit consent and valid English/Hindi levels',()=>{
  assert.throws(()=>recruitment.cleanApplication({...valid,consent:''}),{code:'CONSENT_REQUIRED'});
  assert.throws(()=>recruitment.cleanApplication({...valid,englishLevel:'fluent'}),{code:'INVALID_ENGLISH_LEVEL'});
  assert.throws(()=>recruitment.cleanApplication({...valid,hindiLevel:'native'}),{code:'INVALID_HINDI_LEVEL'});
  assert.throws(()=>recruitment.cleanApplication({...valid,mobile:'123'}),{code:'INVALID_MOBILE'});
});
test('recruitment CV signature is checked rather than trusting the file extension',()=>{
  assert.deepEqual(recruitment.detectCv(Buffer.from('%PDF-1.7')), {mime:'application/pdf',ext:'pdf'});
  assert.deepEqual(recruitment.detectCv(Buffer.from([0x50,0x4b,0x03,0x04])), {mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',ext:'docx'});
  assert.equal(recruitment.detectCv(Buffer.from('not a pdf')),null);
});
test('only an active SaleMaX Sales owner can review hiring records',()=>{
  assert.equal(recruitment.authorize(owner),owner);
  assert.throws(()=>recruitment.authorize({...owner,membership:{...owner.membership,role:'manager'}}),{code:'PERMISSION_DENIED'});
  assert.throws(()=>recruitment.authorize({...owner,tenant:{...owner.tenant,categoryKey:'training_center'},category:getCategory('training_center',1)}),{code:'CATEGORY_UNAVAILABLE'});
});
test('recruitment CV storage requires a private absolute path',()=>{
  assert.equal(recruitment.storageRoot({SALEMAX_RECRUITMENT_CV_ROOT:'/private/salemax/cv'}),'/private/salemax/cv');
  assert.throws(()=>recruitment.storageRoot({}),{code:'RECRUITMENT_STORAGE_NOT_CONFIGURED'});
});

test('internal SaleMaX owner recruitment does not change the published plan entitlement',()=>{
  const withoutFeature={...owner,subscription:{status:'active',capabilities:[]}};
  assert.equal(decision(withoutFeature,{capability:'hr.recruitment',permission:'recruitment.manage'}).allowed,true);
  assert.equal(decision({...withoutFeature,membership:{...owner.membership,role:'manager'}},{capability:'hr.recruitment',permission:'recruitment.manage'}).allowed,false);
});
