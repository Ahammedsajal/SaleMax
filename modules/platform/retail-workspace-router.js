'use strict';
const express=require('express');
const retail=require('./retail-orders');

function createRouter({pool,authenticate}){
  const router=express.Router(),wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  router.use(express.json({limit:'16kb',strict:true}));
  router.use(authenticate);
  const use=async fn=>{const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}};
  router.get('/variants',wrap(async(req,res)=>res.json({success:true,data:{items:await use(db=>retail.listVariants(db,req.businessContext))}})));
  router.post('/variants',wrap(async(req,res)=>res.status(201).json({success:true,data:await use(db=>retail.createVariant(db,req.businessContext,req.body))})));
  router.put('/variants/:id',wrap(async(req,res)=>res.json({success:true,data:await use(db=>retail.updateVariant(db,req.businessContext,req.params.id,req.body))})));
  router.put('/variants/:variantId/branches/:branchId/stock',wrap(async(req,res)=>res.json({success:true,data:await use(db=>retail.setStock(db,req.businessContext,req.params.variantId,req.params.branchId,req.body))})));
  router.get('/orders',wrap(async(req,res)=>res.json({success:true,data:await use(db=>retail.listOrders(db,req.businessContext,req.query))})));
  router.put('/orders/:id',wrap(async(req,res)=>res.json({success:true,data:await use(db=>retail.updateOrder(db,req.businessContext,req.params.id,req.body))})));
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const code=error.type==='entity.parse.failed'?'INVALID_JSON':error.type==='entity.too.large'?'BODY_TOO_LARGE':error.code||'RETAIL_WORKSPACE_UNAVAILABLE';
    const status=Number(error.status)||(error.type==='entity.too.large'?413:error.type==='entity.parse.failed'?400:code==='PERMISSION_DENIED'?403:code==='CATEGORY_UNAVAILABLE'?404:['STALE_REVISION','INVALID_ORDER_TRANSITION','RETAIL_STOCK_LEDGER_INVALID','STOCK_BELOW_RESERVED','RETAIL_BRANCH_UNAVAILABLE'].includes(code)?409:code==='RETAIL_ORDER_NOT_FOUND'||code==='RETAIL_VARIANT_NOT_FOUND'?404:code.startsWith('INVALID_')?400:503);
    res.status(status).json({success:false,code:status>=500?'RETAIL_WORKSPACE_UNAVAILABLE':code});
  });
  return router;
}
module.exports={createRouter};
