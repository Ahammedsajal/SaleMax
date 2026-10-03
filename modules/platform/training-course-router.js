'use strict';
const express=require('express');
const courses=require('./training-courses');
const enrollmentProgress=require('./training-enrollment-progress');
function createTrainingCourseRouter({pool,origin,userGuard}){
  const router=express.Router();
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  const withConnection=fn=>async(...args)=>{const db=await pool.getConnection();try{return await fn(db,...args);}finally{db.release();}};
  router.use(express.json({limit:'24kb',strict:true}));
  router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)&&(req.get('Origin')!==origin||!req.body||typeof req.body!=='object'||Array.isArray(req.body)))return res.status(req.get('Origin')!==origin?403:400).json({success:false,code:req.get('Origin')!==origin?'ORIGIN_DENIED':'INVALID_BODY'});next();});
  router.use(userGuard);
  router.use((req,res,next)=>courses.legacyOwnerContext(pool,req.decode.uid).then(ctx=>{req.courseContext=ctx;next();}).catch(next));
  const contextGuard=(req,res,next)=>req.courseContext?next():res.status(401).json({success:false,code:'AUTH_REQUIRED'});
  router.get('/',contextGuard,wrap(async(req,res)=>res.json({success:true,data:await courses.list(pool,req.courseContext,{page:req.query.page===undefined?1:Number(req.query.page),limit:req.query.limit===undefined?20:Number(req.query.limit),search:req.query.search||'',status:req.query.status||''})})));
  router.get('/enrollments',contextGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(enrollmentProgress.list)(req.courseContext,req.query)})));
  router.post('/enrollments/:id/progress',contextGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(enrollmentProgress.transition)(req.courseContext,req.params.id,req.body)})));
  router.post('/',contextGuard,wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(courses.create)(req.courseContext,req.body)})));
  router.put('/:id',contextGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(courses.update)(req.courseContext,req.params.id,req.body.expectedRevision,req.body)})));
  router.get('/:id/offers',contextGuard,wrap(async(req,res)=>res.json({success:true,data:await courses.offers(pool,req.courseContext,req.params.id)})));
  router.post('/:id/offers',contextGuard,wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(courses.addOffer)(req.courseContext,req.params.id,req.body)})));
  router.get('/:id/batches',contextGuard,wrap(async(req,res)=>res.json({success:true,data:await courses.batches(pool,req.courseContext,req.params.id)})));
  router.post('/:id/batches',contextGuard,wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(courses.addBatch)(req.courseContext,req.params.id,req.body)})));
  router.put('/:id/batches/:batchId',contextGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(courses.updateBatch)(req.courseContext,req.params.id,req.params.batchId,req.body)})));
  router.post('/:id/publish',contextGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(courses.publish)(req.courseContext,req.params.id,req.body.expectedRevision)})));
  router.post('/:id/retire',contextGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(courses.retire)(req.courseContext,req.params.id,req.body.expectedRevision)})));
  router.use((error,req,res,next)=>{if(res.headersSent)return next(error);const code=error.code||'TRAINING_CATALOGUE_UNAVAILABLE';const status=Number.isInteger(error.status)?error.status:code==='PERMISSION_DENIED'?403:['VERIFIED_BUSINESS_OWNER_REQUIRED','BUSINESS_LINK_INVALID','COURSE_NOT_FOUND','BATCH_NOT_FOUND','ENROLLMENT_NOT_FOUND'].includes(code)?404:['STALE_REVISION','COURSE_RETIRED','ACTIVE_OFFER_REQUIRED','BATCH_HAS_RESERVATIONS','CAPACITY_BELOW_RESERVED','ER_DUP_ENTRY','FULL_PAYMENT_REQUIRED','ENROLLMENT_CANNOT_START','ENROLLMENT_MUST_BE_STARTED','ENROLLMENT_MUST_BE_COMPLETED'].includes(code)?409:code.startsWith('INVALID_')?400:['ACCOUNT_INACTIVE','CATEGORY_UNAVAILABLE','FEATURE_UNAVAILABLE'].includes(code)?409:503;res.status(status).json({success:false,code:status===503?'TRAINING_CATALOGUE_UNAVAILABLE':code==='ER_DUP_ENTRY'?'CATALOGUE_CODE_EXISTS':code});});
  return router;
}
module.exports={createTrainingCourseRouter};
