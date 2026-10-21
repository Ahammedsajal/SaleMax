'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),express=require('express'),jwt=require('jsonwebtoken');
const media=require('../modules/platform/training-course-media');
const {getCategory}=require('../modules/platform/categories');

test('course and product stream routes reject each other\'s signed grants before database access',async t=>{
 const prior=process.env.JWTKEY;process.env.JWTKEY=crypto.randomBytes(32).toString('hex');
 const tenantId=crypto.randomUUID(),resourceId=crypto.randomUUID(),mediaId=crypto.randomUUID();
 const context=categoryKey=>({audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey,categoryVersion:1},category:getCategory(categoryKey,1)});
 const courseToken=media.accessToken(context('training_center'),resourceId,mediaId),productToken=media.accessToken(context('7network_sales'),resourceId,mediaId);
 const pool={getConnection:async()=>{throw Error('unexpected database access for cross-catalogue token');}};
 const app=express(),router=require('../modules/platform/training-course-router').createTrainingCourseRouter;
 app.use('/courses',router({pool,origin:'http://localhost',sessionGuard:(req,res,next)=>next()}));
 app.use('/products',router({pool,origin:'http://localhost',sessionGuard:(req,res,next)=>next(),products:true}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));if(prior===undefined)delete process.env.JWTKEY;else process.env.JWTKEY=prior;});
 const base=`http://127.0.0.1:${server.address().port}`,cookieId=mediaId.replace(/-/g,'');
 for(const [route,cookieResource,token] of [['courses','courses',productToken],['products','products',courseToken]]){
  const response=await fetch(`${base}/${route}/${resourceId}/media/${mediaId}/stream`,{headers:{Cookie:`sx_${cookieResource}_media_${cookieId}=${token}`}});
  assert.equal(response.status,401,`${cookieResource} stream must reject the other catalogue token`);
  assert.equal((await response.json()).code,'COURSE_MEDIA_ACCESS_REQUIRED');
 }
 const legacyToken=jwt.sign({aud:'salemax-course-media',tenantId,courseId:resourceId,mediaId},process.env.JWTKEY,{expiresIn:60});
 const legacyResponse=await fetch(`${base}/courses/${resourceId}/media/${mediaId}/stream`,{headers:{Cookie:`sx_course_media_${cookieId}=${legacyToken}`}});
 assert.equal(legacyResponse.status,503,'an old course cookie and token remain accepted through their short expiry window');
});
