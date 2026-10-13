'use strict';
const express=require('express');
const policies=require('./sales-commission-policy');
const deals=require('./sales-deals');

function createSalesCommissionRouter({pool,canonicalGuard}){
  const router=express.Router();
  router.use(express.json({limit:'8kb',strict:true}),canonicalGuard,(req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  async function use(fn){const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}}
  router.get('/policies',wrap(async(req,res)=>res.json({success:true,data:await use(db=>policies.list(db,req.businessContext))})));
  router.get('/products',wrap(async(req,res)=>res.json({success:true,data:{products:await use(db=>policies.products(db,req.businessContext))}})));
  router.post('/products',wrap(async(req,res)=>res.status(201).json({success:true,data:await use(db=>policies.createProduct(db,req.businessContext,req.body||{}))})));
  router.patch('/products/:productId',wrap(async(req,res)=>res.json({success:true,data:await use(db=>policies.setProductActive(db,req.businessContext,req.params.productId,req.body?.active))})));
  router.post('/policies',wrap(async(req,res)=>res.status(201).json({success:true,data:await use(db=>policies.createDraft(db,req.businessContext,req.body||{}))})));
  router.post('/policies/:policyId/approve',wrap(async(req,res)=>res.json({success:true,data:await use(db=>policies.approve(db,req.businessContext,req.params.policyId))})));
  router.get('/deals',wrap(async(req,res)=>res.json({success:true,data:await use(db=>deals.listDeals(db,req.businessContext,{status:req.query.status||'all',limit:req.query.limit}))})));
  router.post('/deals',wrap(async(req,res)=>{const data=await use(db=>deals.submit(db,req.businessContext,req.body||{}));res.status(data.repeated?200:201).json({success:true,data});}));
  router.post('/deals/:dealId/decision',wrap(async(req,res)=>res.json({success:true,data:await use(db=>deals.decide(db,req.businessContext,req.params.dealId,req.body||{}))})));
  router.get('/commissions',wrap(async(req,res)=>res.json({success:true,data:await use(db=>deals.listCommissions(db,req.businessContext,{status:req.query.status||'all',limit:req.query.limit}))})));
  router.post('/commissions/:commissionId/approve',wrap(async(req,res)=>res.json({success:true,data:await use(db=>deals.commissionAction(db,req.businessContext,req.params.commissionId,'approve'))})));
  router.post('/commissions/:commissionId/pay',wrap(async(req,res)=>res.json({success:true,data:await use(db=>deals.commissionAction(db,req.businessContext,req.params.commissionId,'pay',req.body||{}))})));
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const code=error.code||'',status=['PERMISSION_DENIED','CATEGORY_UNAVAILABLE','BUSINESS_LINK_INVALID'].includes(code)?403:
      ['INVALID_COMMISSION_POLICY','INVALID_COMMISSION_RATE','COMMISSION_SPLIT_EXCEEDS_SALE','INVALID_COMMISSION_POLICY_ID','INVALID_SALES_PRODUCT','INVALID_SALE_INPUT','INVALID_SALE_AMOUNT','INVALID_SALE_CURRENCY','INVALID_SALE_LEAD','INVALID_SALES_DEAL_ID','INVALID_SALE_DECISION','INVALID_COMMISSION_ID','INVALID_DEAL_FILTER','INVALID_COMMISSION_FILTER'].includes(code)?400:
      ['COMMISSION_POLICY_NOT_FOUND','SALES_PRODUCT_NOT_FOUND','SALE_LEAD_NOT_FOUND','SALES_DEAL_NOT_FOUND','COMMISSION_NOT_FOUND'].includes(code)?404:
      ['COMMISSION_POLICY_NOT_DRAFT','COMMISSION_PRODUCTS_INCOMPLETE','SALES_PRODUCT_CODE_EXISTS','FEATURE_UNAVAILABLE','SALES_PRODUCT_UNAVAILABLE','SALE_LEAD_NOT_ASSIGNED','SALE_LEAD_ASSIGNMENT_INVALID','SALE_LEAD_ASSIGNMENT_CHANGED','SALE_LEAD_NOT_OPEN','SALE_CURRENCY_MISMATCH','SALE_ALREADY_REPORTED','IDEMPOTENCY_CONFLICT','SALES_DEAL_NOT_PENDING','COMMISSION_POLICY_REQUIRED','COMMISSION_PRODUCT_POLICY_REQUIRED','COMMISSION_NOT_DRAFT','COMMISSION_NOT_APPROVED','PAYOUT_REFERENCE_REQUIRED','PAYOUT_SEPARATION_REQUIRED','WON_STAGE_NOT_CONFIGURED'].includes(code)?409:
      error.type==='entity.parse.failed'||error.type==='entity.too.large'?400:503;
    res.status(status).json({success:false,code:status===503?'SALES_COMMISSION_POLICY_UNAVAILABLE':error.type==='entity.parse.failed'?'INVALID_JSON':error.type==='entity.too.large'?'BODY_TOO_LARGE':code});
  });
  return router;
}
module.exports={createSalesCommissionRouter};
