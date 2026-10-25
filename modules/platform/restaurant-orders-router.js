'use strict';
const express=require('express');
const orders=require('./restaurant-orders');

function createRouter({pool,authenticate}){
  const router=express.Router(),wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  router.use(express.json({limit:'16kb',strict:true}),authenticate);
  const use=async fn=>{const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}};
  router.get('/',wrap(async(req,res)=>res.json({success:true,data:await use(db=>orders.listOrders(db,req.businessContext,req.query))})));
  router.put('/:id',wrap(async(req,res)=>res.json({success:true,data:await use(db=>orders.updateOrder(db,req.businessContext,req.params.id,req.body))})));
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const code=error.type==='entity.parse.failed'?'INVALID_JSON':error.type==='entity.too.large'?'BODY_TOO_LARGE':error.code||'RESTAURANT_ORDER_UNAVAILABLE';
    const status=Number(error.status)||(error.type==='entity.parse.failed'?400:error.type==='entity.too.large'?413:code==='PERMISSION_DENIED'?403:code==='CATEGORY_UNAVAILABLE'?404:['STALE_REVISION','INVALID_ORDER_TRANSITION','RESTAURANT_CLOSED','FULFILLMENT_UNAVAILABLE'].includes(code)?409:code.endsWith('_NOT_FOUND')?404:code.startsWith('INVALID_')||code.endsWith('_REQUIRED')?400:503);
    return res.status(status).json({success:false,code:status>=500?'RESTAURANT_ORDER_UNAVAILABLE':code});
  });
  return router;
}
module.exports={createRouter};
