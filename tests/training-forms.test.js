'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const forms=require('../modules/platform/training-forms');
const {trainingCenter,restaurantFixture}=require('../modules/platform/categories');
const {capabilities}=require('../modules/platform/policy');
const valid={slug:'course-enquiry',nameEn:'Course enquiry',nameAr:'استفسار عن دورة',schema:{titleEn:'Ask about a course',titleAr:'استفسر عن دورة',descriptionEn:'Contact us',descriptionAr:'تواصل معنا',consentTextEn:'Contact me about this enquiry',consentTextAr:'تواصلوا معي بخصوص هذا الاستفسار',fields:[{key:'contact_name',labelEn:'Name',labelAr:'الاسم',required:true},{key:'phone',labelEn:'Phone',labelAr:'الهاتف',required:true},{key:'consent',labelEn:'Contact permission',labelAr:'الموافقة على التواصل',required:true}]}};
test('training enquiry form validates bilingual names, public slug, fields and explicit contact consent',()=>{
  const parsed=forms.formInput(valid);assert.equal(parsed.slug,'course-enquiry');assert.equal(parsed.schema.fields.length,3);assert.equal(parsed.schema.consentTextAr,'تواصلوا معي بخصوص هذا الاستفسار');
  for(const invalid of [{...valid,slug:'../admin'},{...valid,schema:{...valid.schema,fields:[...valid.schema.fields,{key:'tenant_id',labelEn:'Tenant',labelAr:'مستأجر',required:false}]}},{...valid,schema:{...valid.schema,fields:valid.schema.fields.map(f=>f.key==='phone'?{...f,required:false}:f)}},{...valid,schema:{...valid.schema,fields:valid.schema.fields.filter(f=>f.key!=='consent')}},{...valid,schema:{...valid.schema,fields:[...valid.schema.fields,{...valid.schema.fields[0]}]}}])assert.throws(()=>forms.formInput(invalid));
});
test('form access is tenant scoped, category scoped and plan-gated by portal.forms',()=>{
  const ctx={audience:'tenant',identity:{id:'identity'},tenant:{id:'tenant',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'membership',tenantId:'tenant',role:'owner',status:'active'},category:trainingCenter,subscription:{status:'active',capabilities:['portal.forms']}};
  assert.doesNotThrow(()=>forms.formInput(valid));
  assert.equal(require('../modules/platform/policy').decision(ctx,{capability:'portal.forms',permission:'forms.manage'}).allowed,true);
  assert.equal(require('../modules/platform/policy').decision({...ctx,category:restaurantFixture},{capability:'portal.forms',permission:'forms.manage'}).code,'CATEGORY_UNAVAILABLE');
  assert.equal(require('../modules/platform/policy').decision({...ctx,subscription:{status:'active',capabilities:['training.courses']}},{capability:'portal.forms',permission:'forms.manage'}).code,'FEATURE_UNAVAILABLE');
  assert.ok(capabilities['portal.forms'].includes('forms.manage'));
});
test('Lead Forms is mounted into the existing user shell with bilingual draft, preview and publish controls',()=>{
  const root=require('node:path').join(__dirname,'../client/public');
  const html=require('node:fs').readFileSync(require('node:path').join(root,'index.html'),'utf8');
  const screen=require('node:fs').readFileSync(require('node:path').join(root,'training-forms.js'),'utf8');
  const router=require('node:fs').readFileSync(require('node:path').join(__dirname,'../modules/platform/training-form-router.js'),'utf8');
  assert.match(html,/training-forms\.js/);assert.match(html,/training-forms\.css/);assert.match(screen,/Lead Forms/);assert.match(screen,/معاينة/);assert.match(screen,/Publish new version/);assert.match(screen,/\/api\/user\/training\/forms/);assert.match(router,/createPublicTrainingFormRouter/);assert.match(router,/FORM_NOT_FOUND/);
});
