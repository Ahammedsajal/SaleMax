'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const catalogue=require('../modules/platform/tenant-storefront-catalogue');
const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function entitlement(overrides={}){return {id:'assignment-a',status:'active',role_limits:JSON.stringify({owner:1,accountant:0,manager:0,agent:0}),capabilities:JSON.stringify(['training.courses']),category_key:'training_center',category_version:1,current_period:1,...overrides};}
test('public course catalogue requires an active Training Center course entitlement and returns only safe active offer data',async()=>{
  const calls=[];const db={async query(sql,params){calls.push({sql,params});if(sql.includes('FROM sx_plan_assignments'))return [[entitlement()]];if(sql.includes('FROM sx_training_batches'))return [[{courseId:'course-a',startsOn:'2027-01-10',endsOn:'2027-01-12',language:'en'}]];return [[{id:'course-a',nameEn:'First Aid',nameAr:'الإسعافات الأولية',descriptionEn:'Safety',descriptionAr:'السلامة',durationValue:2,durationUnit:'days',deliveryMode:'in_person',outcomesEn:'',outcomesAr:'',prerequisitesEn:'',prerequisitesAr:'',currency:'QAR',priceMinor:'10000',registrationFeeMinor:'500',inclusions:'["Workbook"]',brochureMediaId:'media-a',brochureName:'first-aid.pdf'}]];}};
  const rows=await catalogue.trainingCourses(db,tenantId);assert.equal(rows.length,1);assert.equal(rows[0].priceMinor,10000);assert.deepEqual(rows[0].inclusions,['Workbook']);assert.equal(rows[0].publicId,'course-a');assert.equal(Object.hasOwn(rows[0],'id'),false);assert.equal(rows[0].brochureName,'first-aid.pdf');assert.equal(rows[0].brochureUrl,'/courses/course-a/brochure');assert.deepEqual(rows[0].batches,[{startsOn:'2027-01-10',endsOn:'2027-01-12',language:'en'}]);assert.match(calls[1].sql,/c\.tenant_id=\?/);assert.match(calls[1].sql,/c\.status='active'/);assert.match(calls[1].sql,/o\.status='active'/);assert.match(calls[1].sql,/brochure\.mime_type='application\/pdf'/);assert.equal(calls[1].params[0],tenantId);assert.match(calls[2].sql,/status IN \('scheduled','open'\)/);assert.doesNotMatch(calls[2].sql,/reserved_seats|capacity/);
});
test('public course catalogue fails closed without the current course entitlement',async()=>{
  let courseQuery=false;const db={async query(sql){if(sql.includes('FROM sx_plan_assignments'))return [[entitlement({status:'expired',current_period:0})]];courseQuery=true;return [[]];}};
  assert.deepEqual(await catalogue.trainingCourses(db,tenantId),[]);assert.equal(courseQuery,false);
});
