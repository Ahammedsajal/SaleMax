'use strict';
const express=require('express');
const finance=require('./sales-finance');
function createSalesFinanceRouter({pool,origin,canonicalGuard,sessionGuard}){
  const router=express.Router();router.use(express.json({limit:'16kb',strict:true}),sessionGuard||canonicalGuard,(req,res,next)=>{if(req.featureSession)req.businessContext=req.featureSession.context;if(origin&&!['GET','HEAD','OPTIONS'].includes(req.method)&&!require('./request-origin').matches(req,origin))return res.status(403).json({success:false,code:'ORIGIN_DENIED'});res.setHeader('Cache-Control','no-store');next();});
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  async function use(fn){const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}}
  router.post('/invoices',wrap(async(req,res)=>{const data=await use(db=>finance.createInvoice(db,req.businessContext,req.body||{}));res.status(data.repeated?200:201).json({success:true,data});}));
  router.get('/documents/:kind/:id',wrap(async(req,res)=>res.json({success:true,data:await use(db=>finance.document(db,req.businessContext,req.params.kind,req.params.id))})));
  router.get('/overview',wrap(async(req,res)=>res.json({success:true,data:await use(db=>finance.overview(db,req.businessContext))})));
  router.get('/unbilled-sales',wrap(async(req,res)=>res.json({success:true,data:await use(db=>finance.unbilledSales(db,req.businessContext,{limit:req.query.limit}))})));
  router.get('/invoices',wrap(async(req,res)=>res.json({success:true,data:await use(db=>finance.listInvoices(db,req.businessContext,{status:req.query.status||'all',query:req.query.q||'',limit:req.query.limit}))})));
  router.post('/deals/:dealId/invoice',wrap(async(req,res)=>{const data=await use(db=>finance.issueInvoice(db,req.businessContext,req.params.dealId,req.body||{}));res.status(data.repeated?200:201).json({success:true,data});}));
  router.get('/receipts',wrap(async(req,res)=>res.json({success:true,data:await use(db=>finance.listReceipts(db,req.businessContext,{status:req.query.status||'all',limit:req.query.limit}))})));
  router.get('/receipts/:receiptId/allocations',wrap(async(req,res)=>res.json({success:true,data:await use(db=>finance.listAllocations(db,req.businessContext,req.params.receiptId))})));
  router.post('/receipts',wrap(async(req,res)=>{const data=await use(db=>finance.recordReceipt(db,req.businessContext,req.body||{}));res.status(data.repeated?200:201).json({success:true,data});}));
  router.post('/receipts/allocate',wrap(async(req,res)=>{const data=await use(db=>finance.allocateReceipt(db,req.businessContext,req.body||{}));res.status(data.repeated?200:201).json({success:true,data});}));
  router.post('/allocations/:allocationId/reverse',wrap(async(req,res)=>res.json({success:true,data:await use(db=>finance.reverseAllocation(db,req.businessContext,req.params.allocationId,req.body||{}))})));
  router.get('/reports',wrap(async(req,res)=>res.json({success:true,data:await use(db=>finance.report(db,req.businessContext,{from:req.query.from,to:req.query.to}))})));
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);const code=error.code||'';
    const status=['PERMISSION_DENIED','CATEGORY_UNAVAILABLE','ACCOUNT_INACTIVE','TENANT_CONTEXT_REQUIRED','TENANT_CONTEXT_INVALID'].includes(code)?403:
      ['INVALID_SALES_DEAL_ID','INVALID_FINANCE_AMOUNT','INVALID_FINANCE_CURRENCY','INVALID_FINANCE_DATE','INVALID_FINANCE_INPUT','INVALID_FINANCE_FILTER','INVALID_FINANCE_ALLOCATION_ID'].includes(code)?400:
      ['SALES_DEAL_NOT_FOUND','SALES_RECEIPT_NOT_FOUND','SALES_INVOICE_NOT_FOUND','SALES_ALLOCATION_NOT_FOUND'].includes(code)?404:
      ['SALES_DEAL_NOT_APPROVED','FINANCE_CURRENCY_MISMATCH','RECEIPT_OVERALLOCATED','INVOICE_OVERPAID','IDEMPOTENCY_CONFLICT','SALES_RECEIPT_VOID','SALES_INVOICE_VOID','SALES_ALLOCATION_ALREADY_REVERSED','FINANCE_REVERSAL_REASON_REQUIRED','FINANCE_RECEIPT_FUTURE_DATE','FEATURE_UNAVAILABLE'].includes(code)?409:
      error.type==='entity.parse.failed'||error.type==='entity.too.large'?400:503;
    res.status(status).json({success:false,code:status===503?'SALES_FINANCE_UNAVAILABLE':error.type==='entity.parse.failed'?'INVALID_JSON':error.type==='entity.too.large'?'BODY_TOO_LARGE':code});
  });return router;
}
module.exports={createSalesFinanceRouter};
