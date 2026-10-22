'use strict';

const express=require('express');
const inventory=require('./retail-inventory');

function createRouter({pool,authenticate}){
  const router=express.Router(),wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  router.use(express.json({limit:'16kb',strict:true}));
  router.use(authenticate);
  const withDb=fn=>wrap(async(req,res)=>{const db=await pool.getConnection();try{return await fn(db,req,res);}finally{db.release();}});

  router.get('/locations',withDb(async(db,req,res)=>res.json({success:true,data:await inventory.listLocations(db,req.businessContext)})));
  router.post('/locations',withDb(async(db,req,res)=>res.status(201).json({success:true,data:await inventory.createLocation(db,req.businessContext,req.body)})));
  router.get('/stock',withDb(async(db,req,res)=>res.json({success:true,data:await inventory.listStock(db,req.businessContext,{locationId:req.query.locationId,search:req.query.search,page:req.query.page,limit:req.query.limit})})));
  router.post('/adjustments',withDb(async(db,req,res)=>res.status(201).json({success:true,data:await inventory.adjust(db,req.businessContext,req.body)})));
  router.get('/movements',withDb(async(db,req,res)=>res.json({success:true,data:await inventory.listMovements(db,req.businessContext,{locationId:req.query.locationId,productId:req.query.productId,page:req.query.page,limit:req.query.limit})})));

  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const code=typeof error?.code==='string'?error.code:'INVENTORY_SERVICE_UNAVAILABLE';
    const status=Number(error?.status)||(['PERMISSION_DENIED'].includes(code)?403:['INVENTORY_LOCATION_NOT_FOUND','PRODUCT_NOT_FOUND'].includes(code)?404:['FEATURE_UNAVAILABLE','STALE_INVENTORY_REVISION','INVENTORY_REVISION_LIMIT','OPENING_BALANCE_ALREADY_SET','INSUFFICIENT_STOCK','IDEMPOTENCY_CONFLICT','LOCATION_CODE_EXISTS'].includes(code)?409:code.startsWith('INVALID_')||code==='STOCK_QUANTITY_LIMIT'?400:503);
    res.status(status).json({success:false,code:status>=500?'INVENTORY_SERVICE_UNAVAILABLE':code});
  });
  return router;
}

module.exports={createRouter};
