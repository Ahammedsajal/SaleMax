'use strict';
const express=require('express');
const courses=require('./training-courses');
const policies=require('./training-finance-policies');
const invoices=require('./training-invoices');
const saleReviews=require('./training-sale-reviews');
const receivablesReport=require('./training-receivables-report');
const payments=require('./training-payments');
const schedules=require('./training-installment-schedules');
const credits=require('./training-credits');
const refunds=require('./training-refunds');
const disputes=require('./training-disputes');
const invoiceGenerator=require('./invoice-generator');
const documentGrants=require('./training-document-grants');
const reminderPreferences=require('./training-reminder-preferences');
const installmentReminders=require('./training-installment-reminders');
function createTrainingFinanceRouter({pool,origin,userGuard,canonicalGuard}){
  const router=express.Router();
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  const withConnection=fn=>async(...args)=>{const db=await pool.getConnection();try{return await fn(db,...args);}finally{db.release();}};
  router.use(express.json({limit:'180kb',strict:true}));
  router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)&&(req.get('Origin')!==origin||!req.body||typeof req.body!=='object'||Array.isArray(req.body)))return res.status(req.get('Origin')!==origin?403:400).json({success:false,code:req.get('Origin')!==origin?'ORIGIN_DENIED':'INVALID_BODY'});next();});
  const ownerContext=(req,res,next)=>courses.legacyOwnerContext(pool,req.decode.uid).then(ctx=>{req.financeContext=ctx;next();}).catch(next);
  const tenantLegacyOwnerUid=async tenantId=>{const [rows]=await pool.query(`SELECT u.uid FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR) WHERE o.tenant_id=? ORDER BY u.id LIMIT 2`,[tenantId]);if(rows.length!==1)throw Object.assign(new Error('BUSINESS_LINK_INVALID'),{code:'BUSINESS_LINK_INVALID'});return rows[0].uid;};
  router.get('/current',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.get)(req.financeContext)})));
  router.get('/history',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.history)(req.financeContext)})));
  router.get('/accountant/current',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.get)(req.businessContext)})));
  router.get('/accountant/history',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.history)(req.businessContext)})));
  router.get('/canonical/current',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.get)(req.businessContext)})));
  router.get('/canonical/history',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.history)(req.businessContext)})));
  router.put('/canonical/draft',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.saveDraft)(req.businessContext,req.body)})));
  router.post('/canonical/:id/submit',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.submit)(req.businessContext,{id:req.params.id,expectedRevision:req.body?.expectedRevision})})));
  router.get('/invoices',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoices.list)(req.financeContext,req.query)})));
  router.get('/sales/approved-for-invoice',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await saleReviews.listApprovedForInvoice(pool,req.financeContext,{uid:req.decode.uid})})));
  router.get('/accountant/sales/approved-for-invoice',canonicalGuard,wrap(async(req,res)=>{const uid=await tenantLegacyOwnerUid(req.businessContext.tenant.id);res.json({success:true,data:await saleReviews.listApprovedForInvoice(pool,req.businessContext,{uid})});}));
  router.post('/accountant/sales/:leadId/reviews/:reviewId/convert',canonicalGuard,wrap(async(req,res)=>{const uid=await tenantLegacyOwnerUid(req.businessContext.tenant.id),db=await pool.getConnection();try{const conversion=require('./training-sale-conversion'),data=await conversion.convert(db,req.businessContext,{uid,leadId:req.params.leadId,saleReviewId:req.params.reviewId,requestKey:req.body?.requestKey,actorRole:req.businessContext.membership.role,actorType:'identity',actorId:String(req.businessContext.identity.id)});res.status(data.repeated?200:201).json({success:true,data});}finally{db.release();}}));
  router.get('/invoices/:id',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoices.detail)(req.financeContext,req.params.id)})));
  router.get('/generator/settings',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceGenerator.getSettings)(req.financeContext)})));
  router.put('/generator/settings',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceGenerator.saveSettings)(req.financeContext,req.body)})));
  router.get('/generator/courses',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceGenerator.courses)(req.financeContext)})));
  router.get('/generator/customers',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceGenerator.customers)(req.financeContext,{uid:req.decode.uid,q:req.query.q||''})})));
  router.get('/generator/invoices',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceGenerator.list)(req.financeContext)})));
  router.get('/generator/invoices/:id',userGuard,ownerContext,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceGenerator.detail)(req.financeContext,req.params.id)})));
  router.post('/generator/invoices',userGuard,ownerContext,wrap(async(req,res)=>{const data=await withConnection(invoiceGenerator.create)(req.financeContext,{uid:req.decode.uid,input:req.body});res.status(data.repeated?200:201).json({success:true,data});}));
  router.get('/accountant/invoices',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoices.list)(req.businessContext,req.query)})));
  router.get('/accountant/invoices/:id',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoices.detail)(req.businessContext,req.params.id)})));
  const canonicalGeneratorUid=async req=>tenantLegacyOwnerUid(req.businessContext.tenant.id);
  router.get('/accountant/generator/settings',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceGenerator.getSettings)(req.businessContext)})));
  router.put('/accountant/generator/settings',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceGenerator.saveSettings)(req.businessContext,req.body)})));
  router.get('/accountant/generator/courses',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceGenerator.courses)(req.businessContext)})));
  router.get('/accountant/generator/customers',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceGenerator.customers)(req.businessContext,{uid:await canonicalGeneratorUid(req),q:req.query.q||''})})));
  router.get('/accountant/generator/invoices',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceGenerator.list)(req.businessContext)})));
  router.get('/accountant/generator/invoices/:id',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceGenerator.detail)(req.businessContext,req.params.id)})));
  router.post('/accountant/generator/invoices',canonicalGuard,wrap(async(req,res)=>{const uid=await canonicalGeneratorUid(req),data=await withConnection(invoiceGenerator.create)(req.businessContext,{uid,input:req.body});res.status(data.repeated?200:201).json({success:true,data});}));
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
  for(const canonical of [false,true]){
    const prefix=canonical?'/accountant':'',guards=canonical?[canonicalGuard]:[userGuard,ownerContext],ctx=req=>canonical?req.businessContext:req.financeContext;
    router.get(`${prefix}/reminders/settings`,...guards,wrap(async(req,res)=>res.json({success:true,data:await withConnection(installmentReminders.getSettings)(ctx(req))})));
    router.put(`${prefix}/reminders/settings`,...guards,wrap(async(req,res)=>res.json({success:true,data:await withConnection(installmentReminders.saveSettings)(ctx(req),req.body)})));
    router.post(`${prefix}/documents/:type/:id/link`,...guards,wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(documentGrants.issue)(ctx(req),req.params.type,req.params.id,{origin})})));
    router.delete(`${prefix}/documents/:type/:id/link`,...guards,wrap(async(req,res)=>res.json({success:true,data:await withConnection(documentGrants.revoke)(ctx(req),req.params.type,req.params.id)})));
    router.post(`${prefix}/invoices/:id/reminder-preference-link`,...guards,wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(reminderPreferences.issue)(ctx(req),req.params.id,{origin})})));
  }
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
    if(code.startsWith('DOCUMENT_LINK_')||code.startsWith('REMINDER_LINK_')||code==='DOCUMENT_NOT_FOUND'||code==='DOCUMENT_RECIPIENT_UNAVAILABLE')return res.status(404).json({success:false,code:'DOCUMENT_LINK_UNAVAILABLE'});
    if(code.startsWith('DISPUTE_'))return res.status(code==='DISPUTE_NOT_FOUND'?404:code==='DISPUTE_BALANCE_OUT_OF_SYNC'?503:409).json({success:false,code});
    const status=['ACCOUNTANT_REQUIRED','PERMISSION_DENIED','INVOICE_ISSUER_ROLE_REQUIRED'].includes(code)?403:['FINANCE_POLICY_NOT_FOUND','VERIFIED_BUSINESS_OWNER_REQUIRED','INVOICE_NOT_FOUND','CUSTOMER_NOT_FOUND','PAYMENT_NOT_FOUND','RECEIPT_NOT_FOUND','SCHEDULE_CHANGE_NOT_FOUND','CREDIT_NOT_FOUND','SALE_REVIEW_NOT_FOUND','LEAD_NOT_FOUND'].includes(code)?404:['STALE_FINANCE_POLICY','STALE_REMINDER_SETTINGS','FINANCE_POLICY_REVIEW_PENDING','FINANCE_POLICY_NOT_DRAFT','FINANCE_POLICY_NOT_PENDING','BUSINESS_LINK_INVALID','INVOICE_NOT_PAYABLE','INVOICE_SETTINGS_REQUIRED','INVOICE_REQUEST_KEY_CONFLICT','COURSE_UNAVAILABLE','PAYMENT_NOT_PENDING','PAYMENT_IDEMPOTENCY_CONFLICT','SECOND_APPROVER_REQUIRED','PAYMENT_BALANCE_OUT_OF_RANGE','INSTALLMENT_BALANCE_OUT_OF_SYNC','INSTALLMENT_SCHEDULE_OUT_OF_SYNC','STALE_INSTALLMENT_SCHEDULE','SCHEDULE_CHANGE_IDEMPOTENCY_CONFLICT','SCHEDULE_CHANGE_ALREADY_PENDING','SCHEDULE_CHANGE_NOT_PENDING','SCHEDULE_SECOND_APPROVER_REQUIRED','PENDING_PAYMENT_BLOCKS_SCHEDULE_CHANGE','CREDIT_IDEMPOTENCY_CONFLICT','CREDIT_ALREADY_PENDING','CREDIT_NOT_PENDING','CREDIT_SECOND_APPROVER_REQUIRED','CREDIT_EXCEEDS_OUTSTANDING','PENDING_PAYMENT_BLOCKS_CREDIT','STALE_LEAD_REVISION','LEAD_NOT_OPEN','SALE_REVIEW_NOT_APPROVED','SALE_REVIEW_ALREADY_CONVERTED','SALE_APPROVAL_IDENTITY_REQUIRED','BATCH_UNAVAILABLE','FINANCE_POLICY_NOT_APPROVED','FINANCE_POLICY_INCOMPLETE','SALE_SCHEDULE_NEEDS_TAX_UPDATE','OFFER_PAYMENT_PLAN_CHANGED','INVOICE_NUMBER_CONFLICT','REMINDER_RECIPIENT_UNAVAILABLE'].includes(code)?409:['AUTH_REQUIRED','IDENTITY_REQUIRED'].includes(code)?401:code.startsWith('INVALID_')||['TAX_RATE_REQUIRED','TAX_RATE_NOT_APPLICABLE','TAX_MODE_REQUIRED','FINANCE_POLICY_INCOMPLETE','FINANCE_POLICY_REJECTION_REASON_REQUIRED','PAYMENT_REJECTION_REASON_REQUIRED','SCHEDULE_REJECTION_REASON_REQUIRED','SCHEDULE_DATES_MUST_BE_FUTURE','NO_FUTURE_UNPAID_INSTALLMENTS','INSTALLMENT_TOTAL_MISMATCH','INVALID_INSTALLMENT_SCHEDULE','INVALID_INSTALLMENT_AMOUNT','INVALID_INSTALLMENT_DATE','PAYMENT_SCHEDULE_TOTAL_MISMATCH'].includes(code)?400:['ACCOUNT_INACTIVE','BUSINESS_INACTIVE','CATEGORY_UNAVAILABLE','FEATURE_UNAVAILABLE'].includes(code)?409:503;
    res.status(status).json({success:false,code:status===503?'FINANCE_POLICY_UNAVAILABLE':code,...(error.details?{details:error.details}:{})});
  });
  return router;
}
function createPublicTrainingDocumentRouter({pool,origin}){
  const router=express.Router();
  router.use(express.json({limit:'2kb',strict:true}));
  router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Pragma','no-cache');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');next();});
  router.post('/resolve',async(req,res)=>{if((req.get('Origin')&&req.get('Origin')!==origin)||!req.body||typeof req.body.token!=='string'||Object.keys(req.body).some(key=>key!=='token'))return res.status(404).json({success:false,code:'DOCUMENT_LINK_UNAVAILABLE'});const db=await pool.getConnection();try{const data=await documentGrants.resolve(db,req.body.token);res.json({success:true,data});}catch(error){res.status(404).json({success:false,code:'DOCUMENT_LINK_UNAVAILABLE'});}finally{db.release();}});
  return router;
}
function createPublicTrainingReminderRouter({pool,origin}){
  const router=express.Router();
  router.use(express.json({limit:'2kb',strict:true}));
  router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Pragma','no-cache');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');next();});
  router.post('/resolve',async(req,res)=>{if((req.get('Origin')&&req.get('Origin')!==origin)||!req.body||typeof req.body.token!=='string'||Object.keys(req.body).some(key=>key!=='token'))return res.status(404).json({success:false,code:'REMINDER_LINK_UNAVAILABLE'});const db=await pool.getConnection();try{const data=await reminderPreferences.resolve(db,req.body.token);res.json({success:true,data});}catch{res.status(404).json({success:false,code:'REMINDER_LINK_UNAVAILABLE'});}finally{db.release();}});
  router.post('/update',async(req,res)=>{if(req.get('Origin')!==origin||!req.body||typeof req.body.token!=='string'||typeof req.body.optIn!=='boolean'||Object.keys(req.body).some(key=>!['token','optIn'].includes(key)))return res.status(404).json({success:false,code:'REMINDER_LINK_UNAVAILABLE'});const db=await pool.getConnection();try{const data=await reminderPreferences.update(db,req.body.token,req.body.optIn);res.json({success:true,data});}catch{res.status(404).json({success:false,code:'REMINDER_LINK_UNAVAILABLE'});}finally{db.release();}});
  return router;
}
module.exports={createTrainingFinanceRouter,createPublicTrainingDocumentRouter,createPublicTrainingReminderRouter};
