'use strict';
const express=require('express');
const targets=require('./sales-targets');
function createSalesTargetsRouter({pool,canonicalGuard}){
  const router=express.Router();
  router.use(express.json({limit:'8kb',strict:true}),canonicalGuard,(req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  async function use(fn){const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}}
  router.get('/',wrap(async(req,res)=>res.json({success:true,data:await use(db=>targets.list(db,req.businessContext,req.query.period))})));
  router.put('/:membershipId',wrap(async(req,res)=>res.json({success:true,data:await use(db=>targets.save(db,req.businessContext,req.params.membershipId,req.body||{}))})));
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const code=error.code||'',status=['PERMISSION_DENIED','CATEGORY_UNAVAILABLE','FEATURE_UNAVAILABLE','ACCOUNT_INACTIVE'].includes(code)?403:
      code==='TARGET_MEMBER_NOT_FOUND'?404:['INVALID_TARGET_PERIOD','INVALID_TARGET_MEMBER','INVALID_TARGET_METRIC','INVALID_TARGET_VALUE','INVALID_TARGET_CURRENCY'].includes(code)?400:
        error.type==='entity.parse.failed'||error.type==='entity.too.large'?400:503;
    res.status(status).json({success:false,code:status===503?'SALES_TARGETS_UNAVAILABLE':error.type==='entity.parse.failed'?'INVALID_JSON':error.type==='entity.too.large'?'BODY_TOO_LARGE':code});
  });
  return router;
}
module.exports={createSalesTargetsRouter};
