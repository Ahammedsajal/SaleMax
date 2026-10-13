'use strict';
const express=require('express');
const audit=require('./sales-audit');
function createSalesAuditRouter({pool,canonicalGuard}){
  const router=express.Router();
  router.use(express.json({limit:'8kb',strict:true}),canonicalGuard,(req,res,next)=>{res.setHeader('Cache-Control','private, no-store, max-age=0');next()});
  router.get('/events',async(req,res,next)=>{
    try{
      const db=await pool.getConnection();let data;
      try{data=await audit.list(db,req.businessContext,{from:req.query.from,to:req.query.to,action:req.query.action,limit:req.query.limit===undefined?50:Number(req.query.limit),before:req.query.before})}
      finally{db.release()}
      res.json({success:true,data});
    }catch(error){next(error)}
  });
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const code=error.code||'';
    const status=['PERMISSION_DENIED','CATEGORY_UNAVAILABLE','ACCOUNT_INACTIVE'].includes(code)?403:
      ['INVALID_AUDIT_FILTER','INVALID_AUDIT_CURSOR'].includes(code)?400:503;
    res.status(status).json({success:false,code:status===503?'SALES_AUDIT_UNAVAILABLE':code});
  });
  return router;
}
module.exports={createSalesAuditRouter};
