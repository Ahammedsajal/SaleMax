'use strict';
const express=require('express');
const courses=require('./training-courses');
const students=require('./training-students');
function createTrainingStudentsRouter({pool,origin,userGuard,canonicalGuard}){
  const router=express.Router(),wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  const withConnection=fn=>async(...args)=>{const db=await pool.getConnection();try{return await fn(db,...args);}finally{db.release();}};
  router.use(express.json({limit:'24kb',strict:true}));
  router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)&&(req.get('Origin')!==origin||!req.body||typeof req.body!=='object'||Array.isArray(req.body)))return res.status(req.get('Origin')!==origin?403:400).json({success:false,code:req.get('Origin')!==origin?'ORIGIN_DENIED':'INVALID_BODY'});next();});
  router.use((req,res,next)=>{const authorization=req.get('Authorization')||'';if(/^Bearer\s+/i.test(authorization))return userGuard(req,res,()=>courses.legacyOwnerContext(pool,req.decode.uid).then(ctx=>{req.studentContext=ctx;next();}).catch(next));return canonicalGuard(req,res,()=>{req.studentContext=req.businessContext;next();});});
  router.get('/',wrap(async(req,res)=>res.json({success:true,data:await withConnection(students.list)(req.studentContext,req.query)})));
  router.get('/registrations',wrap(async(req,res)=>res.json({success:true,data:await withConnection(require('./training-registration-directory').list)(req.studentContext,req.query)})));
  router.get('/:id',wrap(async(req,res)=>res.json({success:true,data:await withConnection(students.profile)(req.studentContext,req.params.id)})));
  router.put('/:id/trainer',wrap(async(req,res)=>res.json({success:true,data:await withConnection(students.setTrainer)(req.studentContext,req.params.id,req.body.trainerName)})));
  router.post('/:id/attendance',wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(students.markAttendance)(req.studentContext,req.params.id,req.body)})));
  router.use((error,req,res,next)=>{if(res.headersSent)return next(error);const code=error.code||'STUDENT_DIRECTORY_UNAVAILABLE';const status=Number.isInteger(error.status)?error.status:['AUTH_REQUIRED','IDENTITY_REQUIRED'].includes(code)?401:['PERMISSION_DENIED'].includes(code)?403:['STUDENT_NOT_FOUND'].includes(code)?404:code.startsWith('INVALID_')||code==='ATTENDANCE_DATE_IN_FUTURE'?400:['FEATURE_UNAVAILABLE','CATEGORY_UNAVAILABLE','ACCOUNT_INACTIVE','BUSINESS_INACTIVE'].includes(code)?409:503;res.status(status).json({success:false,code:status>=500?'STUDENT_DIRECTORY_UNAVAILABLE':code});});
  return router;
}
module.exports={createTrainingStudentsRouter};
