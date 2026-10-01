'use strict';
const express=require('express');
const forms=require('./training-forms');
const courses=require('./training-courses');
function createTrainingFormRouter({pool,origin,userGuard}){
  const router=express.Router();const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  router.use(express.json({limit:'32kb',strict:true}));
  router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)&&(req.get('Origin')!==origin||!req.body||typeof req.body!=='object'||Array.isArray(req.body)))return res.status(req.get('Origin')!==origin?403:400).json({success:false,code:req.get('Origin')!==origin?'ORIGIN_DENIED':'INVALID_BODY'});next();});
  router.use(userGuard);
  router.use((req,res,next)=>courses.legacyOwnerContext(pool,req.decode.uid).then(ctx=>{req.formContext=ctx;next();}).catch(next));
  const connection=fn=>async(...args)=>{const db=await pool.getConnection();try{return await fn(db,...args);}finally{db.release();}};
  router.get('/',wrap(async(req,res)=>res.json({success:true,data:await connection(forms.list)(req.formContext)})));
  router.post('/',wrap(async(req,res)=>res.status(201).json({success:true,data:await connection(forms.create)(req.formContext,req.body)})));
  router.put('/:id',wrap(async(req,res)=>res.json({success:true,data:await connection(forms.update)(req.formContext,req.params.id,req.body.expectedRevision,req.body)})));
  router.post('/:id/publish',wrap(async(req,res)=>res.json({success:true,data:await connection(forms.publish)(req.formContext,req.params.id,req.body.expectedRevision)})));
  router.use((error,req,res,next)=>{if(res.headersSent)return next(error);const code=error.code||'TRAINING_FORM_UNAVAILABLE';const status=code==='PERMISSION_DENIED'?403:['FORM_NOT_FOUND','VERIFIED_BUSINESS_OWNER_REQUIRED','BUSINESS_LINK_INVALID'].includes(code)?404:['STALE_REVISION','FORM_SLUG_EXISTS'].includes(code)?409:code.startsWith('INVALID_')||code==='FORM_REQUIRED_FIELDS_MISSING'?400:['BUSINESS_INACTIVE','CATEGORY_UNAVAILABLE','FEATURE_UNAVAILABLE'].includes(code)?409:503;res.status(status).json({success:false,code:status===503?'TRAINING_FORM_UNAVAILABLE':code==='ER_DUP_ENTRY'?'FORM_SLUG_EXISTS':code});});
  return router;
}
function createPublicTrainingFormRouter({pool}){
  const router=express.Router();router.use(express.json({limit:'4kb',strict:true}));
  router.get('/:tenantSlug/:formSlug',async(req,res,next)=>{res.setHeader('Cache-Control','no-store');try{const data=await forms.publicForm(pool,req.params.tenantSlug,req.params.formSlug);if(!data)return res.status(404).json({success:false,code:'FORM_NOT_FOUND'});return res.json({success:true,data});}catch(error){return next(error);}});
  return router;
}
module.exports={createTrainingFormRouter,createPublicTrainingFormRouter};
