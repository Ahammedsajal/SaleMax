'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),jwt=require('jsonwebtoken');
const {getCategory}=require('../modules/platform/categories');
const media=require('../modules/platform/training-course-media');

test('media grants are bound to the category catalogue and use separate cookies',()=>{
 const prior=process.env.JWTKEY;process.env.JWTKEY=crypto.randomBytes(32).toString('hex');
 try{
  const tenantId=crypto.randomUUID(),mediaId=crypto.randomUUID(),resourceId=crypto.randomUUID();
  const context=categoryKey=>({tenant:{id:tenantId,categoryKey,categoryVersion:1},category:getCategory(categoryKey,1)});
  const courseToken=media.accessToken(context('training_center'),resourceId,mediaId);
  const productToken=media.accessToken(context('7network_sales'),resourceId,mediaId);
  assert.equal(media.verifyAccessToken(courseToken).resourceType,'courses');
  assert.equal(media.verifyAccessToken(productToken).resourceType,'products');
  assert.notEqual(media.cookieName('courses',mediaId),media.cookieName('products',mediaId));
  assert.throws(()=>media.accessToken({tenant:{id:tenantId},category:null},resourceId,mediaId),{code:'CATEGORY_UNAVAILABLE'});
 }finally{if(prior===undefined)delete process.env.JWTKEY;else process.env.JWTKEY=prior;}
});

test('a valid legacy media grant is interpreted as a Training Center resource',()=>{
 const prior=process.env.JWTKEY;process.env.JWTKEY=crypto.randomBytes(32).toString('hex');
 try{
  const token=jwt.sign({aud:'salemax-course-media',tenantId:crypto.randomUUID(),courseId:crypto.randomUUID(),mediaId:crypto.randomUUID()},process.env.JWTKEY,{expiresIn:60});
  assert.equal(media.verifyAccessToken(token).resourceType,'courses');
 }finally{if(prior===undefined)delete process.env.JWTKEY;else process.env.JWTKEY=prior;}
});
