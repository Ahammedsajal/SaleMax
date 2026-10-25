'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {publicBranches}=require('../modules/platform/tenant-storefront-branches');

test('public branch data is tenant-scoped, owner-published and omits private staff routing',async()=>{
  let query='',parameters;
  const db={async query(sql,params){query=sql;parameters=params;return [[{slug:'west',nameEn:'West',nameAr:'الغرب',addressEn:'West Bay',addressAr:'الخليج الغربي',phone:'+97412345678',timezone:'Asia/Qatar',openingHours:'{"monday":[{"open":"09:00","close":"17:00"}]}',preparationMinutes:20,serviceAreas:'["Doha"]',fulfillmentModes:'["in_person"]',bookingMode:'capacity_reserved',routingMembershipId:'private-id'}]];}};
  const rows=await publicBranches(db,'tenant-a');assert.deepEqual(parameters,['tenant-a']);assert.match(query,/b\.tenant_id=\? AND b\.status='active' AND b\.public_enabled=1/);assert.match(query,/CASE WHEN t\.category_key='restaurant_cafe'/);assert.doesNotMatch(query,/routing_membership_id|membership/);assert.equal(rows[0].bookingMode,'request_only');assert.deepEqual(rows[0].openingHours,{monday:[{open:'09:00',close:'17:00'}]});assert.equal(rows[0].preparationMinutes,20);assert.deepEqual(rows[0].serviceAreas,['Doha']);assert.equal(Object.hasOwn(rows[0],'routingMembershipId'),false);
});
