'use strict';
const express=require('express');
const crypto=require('node:crypto');
const net=require('node:net');
const path=require('node:path');
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
  router.use((error,req,res,next)=>{if(res.headersSent)return next(error);const code=error.code||'TRAINING_FORM_UNAVAILABLE';const status=error.type==='entity.too.large'?413:error instanceof SyntaxError&&error.status===400?400:code==='PERMISSION_DENIED'?403:['FORM_NOT_FOUND','VERIFIED_BUSINESS_OWNER_REQUIRED','BUSINESS_LINK_INVALID'].includes(code)?404:['STALE_REVISION','FORM_SLUG_EXISTS'].includes(code)?409:code.startsWith('INVALID_')||code==='FORM_REQUIRED_FIELDS_MISSING'?400:['BUSINESS_INACTIVE','CATEGORY_UNAVAILABLE','FEATURE_UNAVAILABLE'].includes(code)?409:503;res.status(status).json({success:false,code:error.type==='entity.too.large'?'PAYLOAD_TOO_LARGE':status===503?'TRAINING_FORM_UNAVAILABLE':code==='ER_DUP_ENTRY'?'FORM_SLUG_EXISTS':code});});
  return router;
}
function createPublicTrainingFormRouter({app,pool,rateKey,origin}){
  const router=express.Router();router.use(express.json({limit:'16kb',strict:true}));
  app.get('/p/:tenantSlug/forms/:formSlug',(req,res)=>res.sendFile(path.resolve(__dirname,'../../client/public/training-form.html')));
  router.get('/:tenantSlug/:formSlug',async(req,res,next)=>{res.setHeader('Cache-Control','no-store');try{const data=await forms.publicForm(pool,req.params.tenantSlug,req.params.formSlug);if(!data)return res.status(404).json({success:false,code:'FORM_NOT_FOUND'});return res.json({success:true,data});}catch(error){return next(error);}});
  router.post('/:tenantSlug/:formSlug/submissions',async(req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.get('Origin')!==origin)return res.status(403).json({success:false,code:'ORIGIN_DENIED'});
    try{
      if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).some(key=>!['submissionToken','values','website'].includes(key)))return res.status(400).json({success:false,code:'INVALID_SUBMISSION'});
      if(typeof req.body.website==='string'&&req.body.website.trim())return res.status(201).json({success:true,data:{referenceCode:crypto.randomBytes(6).toString('hex').toUpperCase()}});
      const remote=req.socket.remoteAddress||'';let clientIp=null;
      if(['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)){const chain=(req.get('X-Forwarded-For')||'').split(',').map(value=>value.trim()).filter(Boolean);const last=chain.at(-1);if(last&&net.isIP(last))clientIp=last;}
      const visitorHash=crypto.createHmac('sha256',rateKey).update(clientIp||crypto.randomBytes(32)).digest('hex');
      const result=await forms.submitPublic(pool,{tenantSlug:req.params.tenantSlug,formSlug:req.params.formSlug,submissionToken:req.body.submissionToken,values:req.body.values,visitorHash});
      return res.status(result.repeated?200:201).json({success:true,data:{referenceCode:result.referenceCode,repeated:result.repeated}});
    }catch(error){return next(error);}
  });
  router.use((error,req,res,next)=>{if(res.headersSent)return next(error);const code=error.code||'PUBLIC_FORM_UNAVAILABLE';const status=error.type==='entity.too.large'?413:error instanceof SyntaxError&&error.status===400?400:code==='FORM_NOT_FOUND'?404:code==='FORM_RATE_LIMITED'?429:['INVALID_SUBMISSION','INVALID_PHONE','INVALID_EMAIL','INVALID_COURSE','INVALID_PREFERRED_DATE','REQUIRED_FIELD_MISSING','CONSENT_REQUIRED'].includes(code)?400:code==='BUSINESS_LINK_INVALID'?409:503;res.status(status).json({success:false,code:error.type==='entity.too.large'?'PAYLOAD_TOO_LARGE':status===503?'PUBLIC_FORM_UNAVAILABLE':code});});
  return router;
}
module.exports={createTrainingFormRouter,createPublicTrainingFormRouter};
