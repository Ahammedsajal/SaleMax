'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const forms=require('../modules/platform/training-forms');
const {trainingCenter,restaurantFixture}=require('../modules/platform/categories');
const {capabilities}=require('../modules/platform/policy');
const valid={slug:'course-enquiry',nameEn:'Course enquiry',nameAr:'استفسار عن دورة',schema:{titleEn:'Ask about a course',titleAr:'استفسر عن دورة',descriptionEn:'Contact us',descriptionAr:'تواصل معنا',consentTextEn:'Contact me about this enquiry',consentTextAr:'تواصلوا معي بخصوص هذا الاستفسار',fields:[{key:'contact_name',labelEn:'Name',labelAr:'الاسم',required:true},{key:'phone',labelEn:'Phone',labelAr:'الهاتف',required:true},{key:'consent',labelEn:'Contact permission',labelAr:'الموافقة على التواصل',required:true}]}};
test('training enquiry form validates bilingual names, public slug, fields and explicit contact consent',()=>{
  const parsed=forms.formInput(valid);assert.equal(parsed.slug,'course-enquiry');assert.equal(parsed.schema.fields.length,3);assert.equal(parsed.schema.consentTextAr,'تواصلوا معي بخصوص هذا الاستفسار');
  assert.deepEqual(forms.cleanSubmission(parsed.schema,{contact_name:' Learner ',phone:'+97450000102',consent:true}),{contact_name:'Learner',phone:'+97450000102',consent:true});
  for(const invalidValues of [{contact_name:'Learner',phone:'+97450000102',consent:false},{contact_name:'Learner',phone:'+97450000102',consent:true,tenant_id:'another-tenant'},{contact_name:'Learner',phone:'bad',consent:true}])assert.throws(()=>forms.cleanSubmission(parsed.schema,invalidValues));
  for(const invalid of [{...valid,slug:'../admin'},{...valid,schema:{...valid.schema,fields:[...valid.schema.fields,{key:'tenant_id',labelEn:'Tenant',labelAr:'مستأجر',required:false}]}},{...valid,schema:{...valid.schema,fields:valid.schema.fields.map(f=>f.key==='phone'?{...f,required:false}:f)}},{...valid,schema:{...valid.schema,fields:valid.schema.fields.filter(f=>f.key!=='consent')}},{...valid,schema:{...valid.schema,fields:[...valid.schema.fields,{...valid.schema.fields[0]}]}}])assert.throws(()=>forms.formInput(invalid));
});
test('public campaign attribution accepts bounded UTM values and strips URL query parameters',()=>{
  assert.deepEqual(forms.cleanCampaignAttribution({utmSource:' newsletter ',utmCampaign:'october',landingPage:'https://crm.salemax.qa/p/tenant/forms/enquiry?email=private@example.invalid&utm_campaign=october',referrer:'https://example.invalid/ad?click_id=secret#top',ignored:'discard'}),{utmSource:'newsletter',utmCampaign:'october',landingPage:'https://crm.salemax.qa/p/tenant/forms/enquiry',referrer:'https://example.invalid/ad'});
  assert.equal(forms.cleanCampaignAttribution({}),null);
  assert.throws(()=>forms.cleanCampaignAttribution({utmSource:'x'.repeat(121)}),{code:'INVALID_ATTRIBUTION'});
  assert.throws(()=>forms.cleanCampaignAttribution({landingPage:'javascript:alert(1)'}),{code:'INVALID_ATTRIBUTION'});
});
test('optional nationality is validated and retained in submitted application details',()=>{
  const form={...valid,schema:{...valid.schema,fields:[...valid.schema.fields,{key:'nationality',labelEn:'Nationality',labelAr:'الجنسية',required:false}]}};
  const parsed=forms.formInput(form);
  assert.deepEqual(forms.cleanSubmission(parsed.schema,{contact_name:'Learner',phone:'+97450000102',nationality:'Qatari',consent:true}),{contact_name:'Learner',phone:'+97450000102',nationality:'Qatari',consent:true});
  assert.throws(()=>forms.cleanSubmission(parsed.schema,{contact_name:'Learner',phone:'+97450000102',nationality:'x'.repeat(121),consent:true}));
});
test('ProCatalyst registration template accepts all supplied columns and keeps the course and payment tables bounded',()=>{
  const keys=['contact_name','certificate_name','address','city','nationality','local_address','city_state','birth_date','gender','student_id','qid','phone_res','phone','email','social_contact','emergency_phone','graduated','source','referral_name','courses','tuition_qar','student_signature','student_signature_date','representative_signature','representative_signature_date','payment_plan','consent'];
  const form={...valid,slug:'student-registration',nameEn:'Student Registration Form',nameAr:'استمارة تسجيل الطالب',schema:{...valid.schema,templateKey:'procatalyst-registration-v1',consentTextEn:'I agree to the student agreement',consentTextAr:'أوافق على اتفاقية الطالب',fields:keys.map(key=>({key,labelEn:key,labelAr:key,required:['contact_name','phone','consent'].includes(key)}))}};
  const parsed=forms.formInput(form);assert.equal(parsed.schema.templateKey,'procatalyst-registration-v1');assert.equal(parsed.schema.fields.length,keys.length);
  const data={contact_name:'Learner',phone:'+97450000102',consent:true,courses:[{courseName:'English',level:'Beginner',classDay:'Sun',timing:'Evening',terms:'QAR 500'}],payment_plan:[{date:'2026-10-06',billNo:'INV-1',amount:'250',officeSignature:'Staff',studentSignature:'Learner'}]};
  assert.deepEqual(forms.cleanSubmission(parsed.schema,data),{...data,phone:'+97450000102'});
  assert.throws(()=>forms.cleanSubmission(parsed.schema,{...data,courses:Array(5).fill(data.courses[0])}));
  assert.throws(()=>forms.cleanSubmission(parsed.schema,{...data,payment_plan:[{...data.payment_plan[0],unexpected:'value'}]}));
});
test('submitted application search and Qatar-local date bounds stay tenant scoped and paginated',async()=>{
  const ctx={audience:'tenant',identity:{id:'identity'},tenant:{id:'tenant-1',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'membership',tenantId:'tenant-1',role:'owner',status:'active'},category:trainingCenter,subscription:{status:'active',capabilities:['portal.forms']}};
  const calls=[];const db={query:async(sql,params)=>{calls.push({sql,params});if(sql.includes('SELECT t.name AS tenantName'))return [[{tenantName:'Tenant',nameEn:'Center EN',nameAr:'Center AR',logoUrl:'/media/center.png'}]];if(sql.includes('SELECT COUNT(*) total'))return [[{total:1}]];return [[{submissionData:'{"contact_name":"A User","phone":"+97450000102"}',attributionJson:'{"utmSource":"newsletter","utmCampaign":"october"}',schemaJson:'{"templateKey":"procatalyst-registration-v1"}',referenceCode:'ABC123'}]];}};
  const result=await forms.submissions(db,ctx,{search:'5000',from:'2026-10-01',to:'2026-10-06',page:'1',limit:'25'});
  assert.equal(result.total,1);assert.equal(result.items[0].submissionData.contact_name,'A User');assert.deepEqual(result.items[0].attribution,{utmSource:'newsletter',utmCampaign:'october'});assert.deepEqual(result.businessProfile,{nameEn:'Center EN',nameAr:'Center AR',logoUrl:'/media/center.png'});assert.ok(calls.every(c=>c.params.includes('tenant-1')));assert.match(calls[1].sql,/TIMESTAMPADD\(HOUR,-3/);assert.match(calls[2].sql,/s\.attribution_json AS attributionJson/);assert.equal(result.page,1);
  const submissionId=require('node:crypto').randomUUID();await forms.submissions(db,ctx,{submissionId});const detailQuery=calls.find(call=>call.sql.includes('SELECT s.id')&&call.sql.includes('FROM sx_training_form_submissions s')&&call.params.includes(submissionId));assert.ok(detailQuery,'direct application lookup is constrained by tenant and exact submission ID');assert.match(detailQuery.sql,/r2\.application_submission_id=s\.id/);
  await assert.rejects(()=>forms.submissions(db,ctx,{from:'2026-10-07',to:'2026-10-06'}),{code:'INVALID_DATE_RANGE'});
});
test('form access is tenant scoped, category scoped and plan-gated by portal.forms',()=>{
  const ctx={audience:'tenant',identity:{id:'identity'},tenant:{id:'tenant',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'membership',tenantId:'tenant',role:'owner',status:'active'},category:trainingCenter,subscription:{status:'active',capabilities:['portal.forms']}};
  assert.doesNotThrow(()=>forms.formInput(valid));
  assert.equal(require('../modules/platform/policy').decision(ctx,{capability:'portal.forms',permission:'forms.manage'}).allowed,true);
  assert.equal(require('../modules/platform/policy').decision({...ctx,category:restaurantFixture},{capability:'portal.forms',permission:'forms.manage'}).code,'CATEGORY_UNAVAILABLE');
  assert.equal(require('../modules/platform/policy').decision({...ctx,subscription:{status:'active',capabilities:['training.courses']}},{capability:'portal.forms',permission:'forms.manage'}).code,'FEATURE_UNAVAILABLE');
  assert.equal(require('../modules/platform/policy').decision({...ctx,membership:{...ctx.membership,role:'agent'}},{capability:'portal.forms',permission:'forms.capture'}).allowed,true);
  assert.equal(require('../modules/platform/policy').decision({...ctx,membership:{...ctx.membership,role:'accountant'}},{capability:'portal.forms',permission:'forms.capture'}).code,'PERMISSION_DENIED');
  assert.ok(capabilities['portal.forms'].includes('forms.manage'));assert.ok(capabilities['portal.forms'].includes('forms.capture'));
});
test('Lead Forms is mounted into the existing user shell with bilingual draft, preview and publish controls',()=>{
  const root=require('node:path').join(__dirname,'../client/public');
  const html=require('node:fs').readFileSync(require('node:path').join(root,'index.html'),'utf8');
  const screen=require('node:fs').readFileSync(require('node:path').join(root,'training-forms.js'),'utf8');
  const router=require('node:fs').readFileSync(require('node:path').join(__dirname,'../modules/platform/training-form-router.js'),'utf8');const pipelineRouter=require('node:fs').readFileSync(require('node:path').join(__dirname,'../routes/pipeline.js'),'utf8');
  const publicHtml=require('node:fs').readFileSync(require('node:path').join(root,'training-form.html'),'utf8');
  const publicScreen=require('node:fs').readFileSync(require('node:path').join(root,'training-public-form.js'),'utf8');
  const pipelineScreen=require('node:fs').readFileSync(require('node:path').join(root,'pipeline/pipeline.js'),'utf8');
  const pipelineHtml=require('node:fs').readFileSync(require('node:path').join(root,'pipeline/index.html'),'utf8');
  const students=require('node:fs').readFileSync(require('node:path').join(root,'training-students.js'),'utf8');
  const registration=require('node:fs').readFileSync(require('node:path').join(root,'training-registration.js'),'utf8');
  const registrationStyles=require('node:fs').readFileSync(require('node:path').join(root,'training-registration.css'),'utf8'),publicStyles=require('node:fs').readFileSync(require('node:path').join(root,'training-public-form.css'),'utf8');assert.match(registration,/profile\.logoUrl/);assert.match(registration,/profile\.nameEn/);assert.match(registration,/class="reg-center-logo"/);assert.match(registration,/function capture\(schema,lang,staff,businessProfile=\{\}\)\{\s*const ar=.*centerName=/);assert.match(publicScreen,/outerBrand = isRegistration \? ''/);assert.match(publicScreen,/form-header-registration/);assert.match(publicScreen,/capture\(schema, language, staffCapture, data\.tenant\)/);assert.match(students,/businessProfile/);assert.match(screen,/businessProfile/);assert.match(screen,/submissionId/);assert.match(screen,/Open linked lead/);assert.match(screen,/saleReviewStatus/);assert.match(html,/training-forms\.js\?v=20261008-contact-consent2/);assert.match(html,/training-registration\.js\?v=20261006-registration-brand3/);assert.match(html,/training-registration\.css\?v=20261006-registration-brand3/);assert.match(html,/training-forms\.css\?v=20261008-mobile-cards1/);assert.match(publicHtml,/training-public-form\.js\?v=20261008-attribution1/);assert.match(publicHtml,/training-public-form\.css\?v=20261007-lead-prefill1/);assert.match(publicStyles,/form-header-registration/);assert.match(publicStyles,/brand-logo/);assert.match(registrationStyles,/reg-center-logo/);assert.match(registrationStyles,/@media print/);assert.match(router,/createPublicTrainingFormRouter/);assert.match(router,/campaignAttribution/);assert.match(publicScreen,/function campaignAttribution\(\)/);assert.match(router,/Cache-Control','no-store, private/);assert.match(router,/FORM_NOT_FOUND/);assert.match(router,/submissions/);assert.match(publicScreen,/query\.get\('mode'\) === 'staff'/);assert.match(publicScreen,/api\/pipeline\/training-forms/);assert.match(publicScreen,/Find existing lead by name, phone or email/);assert.match(publicScreen,/selectedLeadId:selectedLead\.id/);assert.match(pipelineRouter,/training-forms\/:formSlug\/leads/);assert.match(pipelineRouter,/trainingForms\.searchStaffLeads/);assert.match(pipelineScreen,/lead\.source_type==='staff_form'/);assert.match(pipelineScreen,/View submitted snapshot/);assert.match(pipelineScreen,/applicationSubmissionId:application\?\.id/);assert.match(pipelineHtml,/pipeline\.js\?v=22/);
});
