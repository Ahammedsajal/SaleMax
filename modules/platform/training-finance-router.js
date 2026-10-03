'use strict';
const express=require('express');
const courses=require('./training-courses');
const policies=require('./training-finance-policies');
const invoices=require('./training-invoices');
const receivablesReport=require('./training-receivables-report');
const payments=require('./training-payments');
const schedules=require('./training-installment-schedules');
const credits=require('./training-credits');
const refunds=require('./training-refunds');
const disputes=require('./training-disputes');
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
  router.get('/invoices',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoices.list)(req.financeContext,req.query)})));
  router.get('/invoices/:id',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoices.detail)(req.financeContext,req.params.id)})));
  router.get('/accountant/invoices',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoices.list)(req.businessContext,req.query)})));
  router.get('/accountant/invoices/:id',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoices.detail)(req.businessContext,req.params.id)})));
  router.get('/reports/receivables-aging',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(receivablesReport.list)(req.financeContext,req.query)})));
  router.get('/accountant/reports/receivables-aging',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(receivablesReport.list)(req.businessContext,req.query)})));
  router.post('/invoices/:id/schedule-changes',userGuard,ownerContext,wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(schedules.request)(req.financeContext,req.params.id,req.body)})));
  router.post('/accountant/invoices/:id/schedule-changes',canonicalGuard,wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(schedules.request)(req.businessContext,req.params.id,req.body)})));
  router.post('/invoices/:id/payments',userGuard,ownerContext,wrap(async(req,res)=>{
    const data=await withConnection(payments.record)(req.financeContext,req.params.id,req.body);res.status(201).json({success:true,data});
  }));
  router.post('/accountant/invoices/:id/payments',canonicalGuard,wrap(async(req,res)=>{
    const data=await withConnection(payments.record)(req.businessContext,req.params.id,req.body);res.status(201).json({success:true,data});
  }));
  router.get('/accountant/payments/pending',canonicalGuard,wrap(async(req,res)=>{
    const data=await withConnection(payments.pending)(req.businessContext,req.query);res.json({success:true,data});
  }));
  router.get('/payments/pending',userGuard,ownerContext,wrap(async(req,res)=>{
    const data=await withConnection(payments.pending)(req.financeContext,req.query);res.json({success:true,data});
  }));
  router.get('/accountant/schedule-changes/pending',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(schedules.pending)(req.businessContext,req.query)})));
  router.get('/schedule-changes/pending',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(schedules.pending)(req.financeContext,req.query)})));
  router.post('/accountant/schedule-changes/:id/decision',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(schedules.decide)(req.businessContext,req.params.id,req.body)})));
  router.post('/schedule-changes/:id/decision',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(schedules.decide)(req.financeContext,req.params.id,req.body)})));
  router.post('/accountant/payments/:id/verify',canonicalGuard,wrap(async(req,res)=>{
    const data=await withConnection(payments.verify)(req.businessContext,req.params.id,{reason:req.body?.reason});res.json({success:true,data});
  }));
  router.post('/payments/:id/verify',userGuard,ownerContext,wrap(async(req,res)=>{
    const data=await withConnection(payments.verify)(req.financeContext,req.params.id,{reason:req.body?.reason});res.json({success:true,data});
  }));
  router.post('/accountant/payments/:id/reject',canonicalGuard,wrap(async(req,res)=>{
    const data=await withConnection(payments.reject)(req.businessContext,req.params.id,{reason:req.body?.reason});res.json({success:true,data});
  }));
  router.get('/receipts/:id',userGuard,ownerContext,wrap(async(req,res)=>{
    const data=await withConnection(payments.receipt)(req.financeContext,req.params.id);res.json({success:true,data});
  }));
  router.get('/accountant/receipts/:id',canonicalGuard,wrap(async(req,res)=>{
    const data=await withConnection(payments.receipt)(req.businessContext,req.params.id);res.json({success:true,data});
  }));
  router.post('/invoices/:id/credits',userGuard,ownerContext,wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(credits.request)(req.financeContext,req.params.id,req.body)})));
  router.post('/accountant/invoices/:id/credits',canonicalGuard,wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(credits.request)(req.businessContext,req.params.id,req.body)})));
  router.get('/credits/pending',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(credits.pending)(req.financeContext,req.query)})));
  router.get('/accountant/credits/pending',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(credits.pending)(req.businessContext,req.query)})));
  router.post('/credits/:id/decision',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(credits.decide)(req.financeContext,req.params.id,req.body)})));
  router.post('/accountant/credits/:id/decision',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(credits.decide)(req.businessContext,req.params.id,req.body)})));
  for(const canonical of [false,true]){
    const prefix=canonical?'/accountant':'',guards=canonical?[canonicalGuard]:[userGuard,ownerContext],ctx=req=>canonical?req.businessContext:req.financeContext;
    router.post(`${prefix}/payments/:id/refunds`,...guards,wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(refunds.request)(ctx(req),req.params.id,req.body)})));
    router.get(`${prefix}/refunds/queue`,...guards,wrap(async(req,res)=>res.json({success:true,data:await withConnection(refunds.queue)(ctx(req),req.query)})));
    router.post(`${prefix}/refunds/:id/decision`,...guards,wrap(async(req,res)=>res.json({success:true,data:await withConnection(refunds.decide)(ctx(req),req.params.id,req.body)})));
    router.post(`${prefix}/payments/:id/disputes`,...guards,wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(disputes.record)(ctx(req),req.params.id,req.body)})));
    router.get(`${prefix}/disputes/queue`,...guards,wrap(async(req,res)=>res.json({success:true,data:await withConnection(disputes.queue)(ctx(req),req.query)})));
    router.post(`${prefix}/disputes/:id/decision`,...guards,wrap(async(req,res)=>res.json({success:true,data:await withConnection(disputes.resolve)(ctx(req),req.params.id,req.body)})));
  }
  router.post('/accountant/refunds/:id/complete',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(refunds.complete)(req.businessContext,req.params.id,req.body)})));
  router.put('/draft',userGuard,ownerContext,wrap(async(req,res)=>res.status(200).json({success:true,data:await withConnection(policies.saveDraft)(req.financeContext,req.body)})));
  router.post('/:id/submit',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.submit)(req.financeContext,{id:req.params.id,expectedRevision:req.body?.expectedRevision})})));
  router.post('/:id/decision',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.decide)(req.businessContext,{id:req.params.id,expectedRevision:req.body?.expectedRevision,decision:req.body?.decision,reason:req.body?.reason})})));
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);const code=error.code||'FINANCE_POLICY_UNAVAILABLE';
    if(code.startsWith('REFUND_'))return res.status(code==='REFUND_NOT_FOUND'?404:409).json({success:false,code});
    if(code.startsWith('DISPUTE_'))return res.status(code==='DISPUTE_NOT_FOUND'?404:code==='DISPUTE_BALANCE_OUT_OF_SYNC'?503:409).json({success:false,code});
    const status=code==='ACCOUNTANT_REQUIRED'||code==='PERMISSION_DENIED'?403:['FINANCE_POLICY_NOT_FOUND','VERIFIED_BUSINESS_OWNER_REQUIRED','INVOICE_NOT_FOUND','PAYMENT_NOT_FOUND','RECEIPT_NOT_FOUND','SCHEDULE_CHANGE_NOT_FOUND','CREDIT_NOT_FOUND'].includes(code)?404:['STALE_FINANCE_POLICY','FINANCE_POLICY_REVIEW_PENDING','FINANCE_POLICY_NOT_DRAFT','FINANCE_POLICY_NOT_PENDING','BUSINESS_LINK_INVALID','INVOICE_NOT_PAYABLE','PAYMENT_NOT_PENDING','PAYMENT_IDEMPOTENCY_CONFLICT','SECOND_APPROVER_REQUIRED','PAYMENT_BALANCE_OUT_OF_RANGE','INSTALLMENT_BALANCE_OUT_OF_RANGE','INSTALLMENT_SCHEDULE_OUT_OF_SYNC','STALE_INSTALLMENT_SCHEDULE','SCHEDULE_CHANGE_IDEMPOTENCY_CONFLICT','SCHEDULE_CHANGE_ALREADY_PENDING','SCHEDULE_CHANGE_NOT_PENDING','SCHEDULE_SECOND_APPROVER_REQUIRED','PENDING_PAYMENT_BLOCKS_SCHEDULE_CHANGE','CREDIT_IDEMPOTENCY_CONFLICT','CREDIT_ALREADY_PENDING','CREDIT_NOT_PENDING','CREDIT_SECOND_APPROVER_REQUIRED','CREDIT_EXCEEDS_OUTSTANDING','PENDING_PAYMENT_BLOCKS_CREDIT'].includes(code)?409:['AUTH_REQUIRED','IDENTITY_REQUIRED'].includes(code)?401:code.startsWith('INVALID_')||['TAX_RATE_REQUIRED','TAX_RATE_NOT_APPLICABLE','TAX_MODE_REQUIRED','FINANCE_POLICY_INCOMPLETE','FINANCE_POLICY_REJECTION_REASON_REQUIRED','PAYMENT_REJECTION_REASON_REQUIRED','SCHEDULE_REJECTION_REASON_REQUIRED','SCHEDULE_DATES_MUST_BE_FUTURE','NO_FUTURE_UNPAID_INSTALLMENTS','INSTALLMENT_TOTAL_MISMATCH','INVALID_INSTALLMENT_SCHEDULE','INVALID_INSTALLMENT_AMOUNT','INVALID_INSTALLMENT_DATE'].includes(code)?400:['ACCOUNT_INACTIVE','BUSINESS_INACTIVE','CATEGORY_UNAVAILABLE','FEATURE_UNAVAILABLE'].includes(code)?409:503;
    res.status(status).json({success:false,code:status===503?'FINANCE_POLICY_UNAVAILABLE':code,...(error.details?{details:error.details}:{})});
  });
  return router;
}
module.exports={createTrainingFinanceRouter};
