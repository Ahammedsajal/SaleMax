'use strict';
const express=require('express');
const courses=require('./training-courses');
const policies=require('./training-finance-policies');
function createTrainingFinanceRouter({pool,origin,userGuard,canonicalGuard}){
  const router=express.Router();
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  const withConnection=fn=>async(...args)=>{const db=await pool.getConnection();try{return await fn(db,...args);}finally{db.release();}};
  router.use(express.json({limit:'16kb',strict:true}));
  router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)&&(req.get('Origin')!==origin||!req.body||typeof req.body!=='object'||Array.isArray(req.body)))return res.status(req.get('Origin')!==origin?403:400).json({success:false,code:req.get('Origin')!==origin?'ORIGIN_DENIED':'INVALID_BODY'});next();});
  const ownerContext=(req,res,next)=>courses.legacyOwnerContext(pool,req.decode.uid).then(ctx=>{req.financeContext=ctx;next();}).catch(next);
  router.get('/current',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.get)(req.financeContext)})));
  router.get('/history',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.history)(req.financeContext)})));
  router.get('/accountant/current',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.get)(req.businessContext)})));
  router.get('/accountant/history',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.history)(req.businessContext)})));
  router.put('/draft',userGuard,ownerContext,wrap(async(req,res)=>res.status(200).json({success:true,data:await withConnection(policies.saveDraft)(req.financeContext,req.body)})));
  router.post('/:id/submit',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.submit)(req.financeContext,{id:req.params.id,expectedRevision:req.body?.expectedRevision})})));
  router.post('/:id/decision',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.decide)(req.businessContext,{id:req.params.id,expectedRevision:req.body?.expectedRevision,decision:req.body?.decision,reason:req.body?.reason})})));
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);const code=error.code||'FINANCE_POLICY_UNAVAILABLE';
    const status=code==='ACCOUNTANT_REQUIRED'||code==='PERMISSION_DENIED'?403:['FINANCE_POLICY_NOT_FOUND','VERIFIED_BUSINESS_OWNER_REQUIRED'].includes(code)?404:['STALE_FINANCE_POLICY','FINANCE_POLICY_REVIEW_PENDING','FINANCE_POLICY_NOT_DRAFT','FINANCE_POLICY_NOT_PENDING','BUSINESS_LINK_INVALID'].includes(code)?409:['AUTH_REQUIRED','IDENTITY_REQUIRED'].includes(code)?401:code.startsWith('INVALID_')||['TAX_RATE_REQUIRED','TAX_RATE_NOT_APPLICABLE','TAX_MODE_REQUIRED','FINANCE_POLICY_INCOMPLETE','FINANCE_POLICY_REJECTION_REASON_REQUIRED'].includes(code)?400:['ACCOUNT_INACTIVE','BUSINESS_INACTIVE','CATEGORY_UNAVAILABLE','FEATURE_UNAVAILABLE'].includes(code)?409:503;
    res.status(status).json({success:false,code:status===503?'FINANCE_POLICY_UNAVAILABLE':code,...(error.details?{details:error.details}:{})});
  });
  return router;
}
module.exports={createTrainingFinanceRouter};
