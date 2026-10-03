'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const courses=require('../modules/platform/training-courses');
const {trainingCenter,restaurantFixture}=require('../modules/platform/categories');
const {capabilities}=require('../modules/platform/policy');
const valid={code:'CS-101',nameEn:'Customer service',nameAr:'خدمة العملاء',descriptionEn:'',descriptionAr:'',durationValue:4,durationUnit:'weeks',deliveryMode:'hybrid',offer:{priceMinor:125000,registrationFeeMinor:5000}};
test('course and QAR offer inputs reject malformed duration, code, money and dates',()=>{
  assert.equal(courses.courseInput(valid).code,'CS-101');
  assert.equal(courses.courseInput(valid).difficultyLevel,'all_levels');
  assert.equal(courses.courseInput({...valid,difficultyLevel:'advanced',outcomesEn:'Use customer-service tools'}).outcomesEn,'Use customer-service tools');
  assert.equal(courses.offerInput(valid.offer).price,125000);
  for(const patch of [{code:'A'},{durationValue:0},{durationUnit:'years'},{deliveryMode:'unknown'},{difficultyLevel:'expert'},{outcomesAr:'x'.repeat(5001)},{prerequisitesEn:12}])assert.throws(()=>courses.courseInput({...valid,...patch}));
  for(const offer of [{priceMinor:1.2},{priceMinor:-1},{priceMinor:0,validFrom:'2026-02-30'},{priceMinor:0,validFrom:'2026-12-31',validUntil:'2026-01-01'}])assert.throws(()=>courses.offerInput(offer));
});
test('course access requires the matching training category, active plan and role permission',async()=>{
  const context={audience:'tenant',identity:{id:'identity-a'},tenant:{id:'tenant-a',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'member-a',tenantId:'tenant-a',role:'owner',status:'active',delegatedPermissions:[]},category:trainingCenter,subscription:{status:'active',capabilities:['training.courses']},runtimeReady:{}};
  await assert.doesNotReject(courses.list({query:async()=>[[{n:0}],[]]},context));
  const noFeature={...context,subscription:{status:'active',capabilities:[]}};
  await assert.rejects(courses.list({query:async()=>{throw Error('must deny before query')}},noFeature),{code:'FEATURE_UNAVAILABLE'});
  const restaurant={...context,tenant:{...context.tenant,categoryKey:restaurantFixture.key},category:restaurantFixture};
  await assert.rejects(courses.list({query:async()=>{throw Error('must deny before query')}},restaurant),{code:'CATEGORY_UNAVAILABLE'});
  const accountant={...context,membership:{...context.membership,role:'accountant'}};
  await assert.rejects(courses.create({beginTransaction(){throw Error('must deny before transaction')}},accountant,valid),{code:'PERMISSION_DENIED'});
});
test('new course workflow is mounted in existing user shell with bilingual screen and API documentation',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
  const html=read('client/public/index.html'),screen=read('client/public/training-courses.js'),mount=read('modules/platform/mount-existing-upgrade.js');
  assert.match(html,/training-courses\.js\?v=/);assert.match(screen,/\?page=courses/);assert.match(screen,/الدورات/);assert.match(screen,/priceMinor/);assert.match(screen,/Publish course/);assert.match(screen,/Schedule a batch/);assert.match(screen,/Retire course/);assert.match(screen,/data-edit-batch/);
  assert.match(screen,/Learning outcomes/);assert.match(screen,/Prerequisites/);assert.match(screen,/addLearningInfo/);
  assert.match(screen,/business-auth\/me/);assert.match(screen,/canonicalCsrf/);assert.match(mount,/canonicalGuard:businessBoundary\.guard/);
  assert.match(mount,/\/api\/user\/training\/courses/);assert.match(read('docs/API_DOCUMENTATION.md'),/Training-center course catalogue/);assert.match(read('docs/USER_MANUAL.md'),/Training courses/);
});
