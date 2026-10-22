'use strict';
const express=require('express');
const icp=require('./sales-icp');
function createSalesIcpRouter({pool,sessionGuard}){
  const router=express.Router();router.use(express.json({limit:'32kb',strict:true}),sessionGuard,(req,res,next)=>{if(req.featureSession)req.businessContext=req.featureSession.context;res.setHeader('Cache-Control','private, no-store, max-age=0');next();});
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  async function use(fn){const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}}
  router.get('/profiles',wrap(async(req,res)=>res.json({success:true,data:await use(db=>icp.list(db,req.businessContext))})));
  router.post('/profiles',wrap(async(req,res)=>res.status(201).json({success:true,data:await use(db=>icp.create(db,req.businessContext,req.body||{}))})));
  router.put('/profiles/:id',wrap(async(req,res)=>res.json({success:true,data:await use(db=>icp.update(db,req.businessContext,req.params.id,req.body||{}))})));
  router.use((error,req,res,next)=>{if(res.headersSent)return next(error);const code=error.code||'',status=['PERMISSION_DENIED','CATEGORY_UNAVAILABLE','ACCOUNT_INACTIVE','FEATURE_UNAVAILABLE'].includes(code)?403:['INVALID_ICP_DOCUMENT','INVALID_ICP_INPUT','INVALID_ICP_TITLE','INVALID_ICP_SUMMARY','INVALID_ICP_ID','INVALID_ICP_REVISION'].includes(code)||error.type==='entity.parse.failed'||error.type==='entity.too.large'?400:code==='ICP_PROFILE_NOT_FOUND'?404:code==='STALE_ICP_PROFILE'?409:503;res.status(status).json({success:false,code:status===503?'ICP_UNAVAILABLE':error.type==='entity.parse.failed'?'INVALID_JSON':error.type==='entity.too.large'?'BODY_TOO_LARGE':code});});
  return router;
}
module.exports={createSalesIcpRouter};
