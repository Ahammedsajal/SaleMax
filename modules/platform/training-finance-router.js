'use strict';
const express=require('express');
const fileUpload=require('express-fileupload');
const fs=require('node:fs/promises');
const courses=require('./training-courses');
const policies=require('./training-finance-policies');
const invoices=require('./training-invoices');
const saleReviews=require('./training-sale-reviews');
const receivablesReport=require('./training-receivables-report');
const financeDashboard=require('./training-finance-dashboard');
const payments=require('./training-payments');
const paymentProofs=require('./training-payment-proofs');
const schedules=require('./training-installment-schedules');
const credits=require('./training-credits');
const refunds=require('./training-refunds');
const disputes=require('./training-disputes');
const invoiceGenerator=require('./invoice-generator');
const invoiceEditor=require('./invoice-generator-editor');
const documentGrants=require('./training-document-grants');
const documentDelivery=require('./training-document-delivery');
const reminderPreferences=require('./training-reminder-preferences');
const installmentReminders=require('./training-installment-reminders');
function createTrainingFinanceRouter({pool,origin,userGuard,canonicalGuard,sessionGuard}){
  const router=express.Router();
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
  const withConnection=fn=>async(...args)=>{const db=await pool.getConnection();try{return await fn(db,...args);}finally{db.release();}};
  router.use(express.json({limit:'180kb',strict:true}));
  router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(['GET','HEAD','OPTIONS'].includes(req.method))return next();if(!require('./request-origin').matches(req,origin))return res.status(403).json({success:false,code:'ORIGIN_DENIED'});if(req.is('multipart/form-data'))return next();if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))return res.status(400).json({success:false,code:'INVALID_BODY'});next();});
  const parsePaymentProof=(req,res,next)=>{if(!req.is('multipart/form-data'))return res.status(400).json({success:false,code:'PAYMENT_PROOF_FILE_REQUIRED'});fileUpload({useTempFiles:true,tempFileDir:require('node:os').tmpdir(),limits:{fileSize:paymentProofs.LIMIT,files:1,fields:0},abortOnLimit:false})(req,res,error=>{if(error)return res.status(error.status===413||error.code==='LIMIT_FILE_SIZE'?413:400).json({success:false,code:error.code==='LIMIT_FILE_SIZE'?'PAYMENT_PROOF_TOO_LARGE':'INVALID_PAYMENT_PROOF'});next();});};
  const openPaymentProof=contextName=>wrap(async(req,res,next)=>{const proof=await withConnection(paymentProofs.get)(req[contextName],req.params.id);res.setHeader('Content-Type',proof.mimeType);res.setHeader('Content-Length',String(proof.bytes));res.setHeader('Content-Disposition','inline');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','private, no-store');if(proof.driver==='s3'){const opened=await paymentProofs.openRead(proof);if(opened.contentLength!==proof.bytes){opened.body.destroy?.();throw Object.assign(Error('PAYMENT_PROOF_INTEGRITY'),{code:'PAYMENT_PROOF_INTEGRITY',status:503});}opened.body.on('error',error=>{if(!res.headersSent)next(error);else res.destroy(error);});return opened.body.pipe(res);}return res.sendFile(proof.filePath,{dotfiles:'deny'},error=>{if(error&&!res.headersSent)next(error);});});
  // Role-prefixed URLs are aliases only; every request reaches the same handler.
  router.use((req,res,next)=>{req.url=req.url.replace(/^\/(accountant|canonical)(?=\/|\?|$)/,'')||'/';next();});
  router.use(sessionGuard||((req,res,next)=>{
    if(/^Bearer\s+/i.test(req.get('Authorization')||''))return userGuard(req,res,()=>courses.legacyOwnerContext(pool,req.decode.uid).then(ctx=>{req.financeContext=ctx;next();}).catch(next));
    return canonicalGuard(req,res,()=>{req.financeContext=req.businessContext;next();});
  }));
  router.use(wrap(async(req,res,next)=>{
    req.financeContext=req.featureSession?.context||req.financeContext;
    if(!req.financeContext)throw Object.assign(Error('TENANT_CONTEXT_REQUIRED'),{code:'TENANT_CONTEXT_REQUIRED',status:403});
    const uid=req.featureSession?.ownerUid||await tenantLegacyOwnerUid(req.financeContext.tenant.id);
    req.decode={...(req.decode||{}),uid};next();
  }));
  const invoiceDetailOrGenerated=withConnection(async(db,ctx,id)=>{
    try{return await invoices.detail(db,ctx,id);}
    catch(error){
      // Older cached Finance scripts opened generated PDF IDs through this
      // formal-invoice route. Keep that read path compatible, tenant scoped,
      // and read-only while the browser updates its cached asset.
      if(error.code!=='INVOICE_NOT_FOUND')throw error;
      return require('./generated-invoice-posting').paymentContext(db,ctx,id);
    }
  });
  const tenantLegacyOwnerUid=async tenantId=>(await require('./invoice-customers').owner(pool,tenantId)).uid;
  router.get('/current',wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.get)(req.financeContext)})));
  router.get('/history',wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.history)(req.financeContext)})));
  router.get('/invoices',wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoices.list)(req.financeContext,req.query)})));
  router.get('/invoices/summary',wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoices.summary)(req.financeContext,req.query)})));
  router.get('/sales/approved-for-invoice',wrap(async(req,res)=>res.json({success:true,data:await saleReviews.listApprovedForInvoice(pool,req.financeContext,{uid:req.decode.uid})})));
  router.post("/sales/:leadId/reviews/:reviewId/convert",wrap(async(req,res)=>{const uid=await tenantLegacyOwnerUid(req.financeContext.tenant.id),db=await pool.getConnection();try{const conversion=require('./training-sale-conversion'),data=await conversion.convert(db,req.financeContext,{uid,leadId:req.params.leadId,saleReviewId:req.params.reviewId,requestKey:req.body?.requestKey,actorRole:req.financeContext.membership.role,actorType:'identity',actorId:String(req.financeContext.identity.id)});res.status(data.repeated?200:201).json({success:true,data});}finally{db.release();}}));
  router.get('/invoices/:id',wrap(async(req,res)=>res.json({success:true,data:await invoiceDetailOrGenerated(req.financeContext,req.params.id)})));
  router.get('/generator/settings',wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceGenerator.getSettings)(req.financeContext)})));
  router.put('/generator/settings',wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceGenerator.saveSettings)(req.financeContext,req.body)})));
  router.get('/generator/courses',wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceGenerator.courses)(req.financeContext)})));
  router.get('/generator/customers',wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceGenerator.customers)(req.financeContext,{uid:req.decode.uid,q:req.query.q||''})})));
  router.get('/generator/invoices/:id/payment-context',wrap(async(req,res)=>res.json({success:true,data:await withConnection(require('./generated-invoice-posting').paymentContext)(req.financeContext,req.params.id)})));
  router.post('/generator/invoices/:id/payments',wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(require('./generated-invoice-posting').recordPayment)(req.financeContext,{uid:req.decode.uid,documentId:req.params.id,input:req.body})})));
  router.post('/generator/invoices/:id/post',wrap(async(req,res)=>res.json({success:true,data:await withConnection(require('./generated-invoice-posting').post)(req.financeContext,{uid:req.decode.uid,documentId:req.params.id})})));
  router.get('/generator/invoices/:id/conversion-options',wrap(async(req,res)=>res.json({success:true,data:await invoiceGenerator.conversionOptions(pool,req.financeContext,{uid:req.decode.uid,documentId:req.params.id})})));
  router.post('/generator/invoices/:id/convert',wrap(async(req,res)=>{const db=await pool.getConnection();try{const data=await require('./training-sale-conversion').convert(db,req.financeContext,{uid:req.decode.uid,leadId:req.body?.leadId,saleReviewId:req.body?.saleReviewId,requestKey:req.body?.requestKey,generatedDocumentId:req.params.id,actorRole:req.financeContext.membership.role,actorType:'identity',actorId:String(req.financeContext.identity.id)});res.status(data.repeated?200:201).json({success:true,data});}finally{db.release();}}));
  router.get('/generator/invoices',wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceGenerator.list)(req.financeContext,req.query)})));
  router.get('/generator/invoices/:id',wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceGenerator.detail)(req.financeContext,req.params.id)})));
  router.post('/generator/invoices',wrap(async(req,res)=>{const data=await withConnection(invoiceGenerator.create)(req.financeContext,{uid:req.decode.uid,input:req.body});res.status(data.repeated?200:201).json({success:true,data});}));
  router.put('/generator/invoices/:id',wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceEditor.update)(req.financeContext,{uid:req.decode.uid,id:req.params.id,input:req.body})})));
  router.delete('/generator/invoices/:id',wrap(async(req,res)=>res.json({success:true,data:await withConnection(invoiceEditor.remove)(req.financeContext,{id:req.params.id,input:req.body})})));
  router.get('/reports/receivables-aging',wrap(async(req,res)=>res.json({success:true,data:await withConnection(receivablesReport.list)(req.financeContext,req.query)})));
  router.get('/reports/dashboard',wrap(async(req,res)=>res.json({success:true,data:await withConnection(financeDashboard.report)(req.financeContext,req.query)})));
  {
    const contextKey='financeContext';
    router.get('/reports/schedules',wrap(async(req,res)=>res.json({success:true,data:await withConnection(require('./training-report-schedules').list)(req[contextKey])})));
    router.put('/reports/schedules',wrap(async(req,res)=>res.json({success:true,data:await withConnection(require('./training-report-schedules').save)(req[contextKey],req.body)})));
  }
  router.post('/invoices/:id/schedule-changes',wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(schedules.request)(req.financeContext,req.params.id,req.body)})));
  router.post('/invoices/:id/payments',wrap(async(req,res)=>{
    const data=await withConnection(payments.recordAndPost)(req.financeContext,req.params.id,req.body);res.status(201).json({success:true,data});
  }));
  router.post('/invoices/:id/payments/:paymentId/proof',parsePaymentProof,wrap(async(req,res)=>{const file=req.files?.proof;if(!file||Array.isArray(file))return res.status(400).json({success:false,code:'PAYMENT_PROOF_FILE_REQUIRED'});try{const data=await withConnection(paymentProofs.upload)(req.financeContext,req.params.paymentId,file,{invoiceId:req.params.id});res.status(data.repeated?200:201).json({success:true,data});}finally{if(file.tempFilePath)await fs.rm(file.tempFilePath,{force:true}).catch(()=>{});}}));
  router.get('/payments/:id/proof',openPaymentProof('financeContext'));
  router.get('/payments/pending',wrap(async(req,res)=>{
    const data=await withConnection(payments.pending)(req.financeContext,req.query);res.json({success:true,data});
  }));
  router.get('/schedule-changes/pending',wrap(async(req,res)=>res.json({success:true,data:await withConnection(schedules.pending)(req.financeContext,req.query)})));
  router.post('/schedule-changes/:id/decision',wrap(async(req,res)=>res.json({success:true,data:await withConnection(schedules.decide)(req.financeContext,req.params.id,req.body)})));
  router.post('/payments/:id/verify',wrap(async(req,res)=>{
    const data=await withConnection(payments.verify)(req.financeContext,req.params.id,{reason:req.body?.reason});res.json({success:true,data});
  }));
  router.post("/payments/:id/reject",wrap(async(req,res)=>{
    const data=await withConnection(payments.reject)(req.financeContext,req.params.id,{reason:req.body?.reason});res.json({success:true,data});
  }));
  router.get('/receipts',wrap(async(req,res)=>res.json({success:true,data:await withConnection(payments.listReceipts)(req.financeContext,req.query)})));
  router.get('/receipts/:id',wrap(async(req,res)=>{
    const data=await withConnection(payments.receipt)(req.financeContext,req.params.id);res.json({success:true,data});
  }));
  {
    const ctx=req=>req.financeContext;
    router.post(`/documents/:type/:id/deliveries`,wrap(async(req,res)=>{const data=await withConnection(documentDelivery.deliver)(ctx(req),{type:req.params.type,id:req.params.id,channel:req.body?.channel,requestKey:req.body?.requestKey,origin,env:process.env});res.json({success:true,data});}));
    router.get(`/reminders/settings`,wrap(async(req,res)=>res.json({success:true,data:await withConnection(installmentReminders.getSettings)(ctx(req))})));
    router.put(`/reminders/settings`,wrap(async(req,res)=>res.json({success:true,data:await withConnection(installmentReminders.saveSettings)(ctx(req),req.body)})));
    router.post(`/documents/:type/:id/link`,wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(documentGrants.issue)(ctx(req),req.params.type,req.params.id,{origin})})));
    router.delete(`/documents/:type/:id/link`,wrap(async(req,res)=>res.json({success:true,data:await withConnection(documentGrants.revoke)(ctx(req),req.params.type,req.params.id)})));
    router.post(`/invoices/:id/reminder-preference-link`,wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(reminderPreferences.issue)(ctx(req),req.params.id,{origin})})));
  }
  router.post('/invoices/:id/credits',wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(credits.request)(req.financeContext,req.params.id,req.body)})));
  router.get('/credits/pending',wrap(async(req,res)=>res.json({success:true,data:await withConnection(credits.pending)(req.financeContext,req.query)})));
  router.post('/credits/:id/decision',wrap(async(req,res)=>res.json({success:true,data:await withConnection(credits.decide)(req.financeContext,req.params.id,req.body)})));
  {
    const ctx=req=>req.financeContext;
    router.post(`/payments/:id/refunds`,wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(refunds.request)(ctx(req),req.params.id,req.body)})));
    router.get(`/refunds/queue`,wrap(async(req,res)=>res.json({success:true,data:await withConnection(refunds.queue)(ctx(req),req.query)})));
    router.post(`/refunds/:id/decision`,wrap(async(req,res)=>res.json({success:true,data:await withConnection(refunds.decide)(ctx(req),req.params.id,req.body)})));
    router.post(`/payments/:id/disputes`,wrap(async(req,res)=>res.status(201).json({success:true,data:await withConnection(disputes.record)(ctx(req),req.params.id,req.body)})));
    router.get(`/disputes/queue`,wrap(async(req,res)=>res.json({success:true,data:await withConnection(disputes.queue)(ctx(req),req.query)})));
    router.post(`/disputes/:id/decision`,wrap(async(req,res)=>res.json({success:true,data:await withConnection(disputes.resolve)(ctx(req),req.params.id,req.body)})));
  }
  router.post("/refunds/:id/complete",wrap(async(req,res)=>res.json({success:true,data:await withConnection(refunds.complete)(req.financeContext,req.params.id,req.body)})));
  router.put('/draft',wrap(async(req,res)=>res.status(200).json({success:true,data:await withConnection(policies.saveDraft)(req.financeContext,req.body)})));
  router.post('/:id/submit',wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.submit)(req.financeContext,{id:req.params.id,expectedRevision:req.body?.expectedRevision})})));
  router.post('/:id/decision',wrap(async(req,res)=>res.json({success:true,data:await withConnection(policies.decide)(req.financeContext,{id:req.params.id,expectedRevision:req.body?.expectedRevision,decision:req.body?.decision,reason:req.body?.reason})})));
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);const code=error.code||'FINANCE_POLICY_UNAVAILABLE';
    if(Number.isInteger(error.status)&&error.status>=400&&error.status<500)return res.status(error.status).json({success:false,code});
    const documentStatus={STALE_INVOICE_REVISION:409,STALE_COURSE_PRICE:409,INVOICE_LINKED_READ_ONLY:409,INVOICE_REPLACED_READ_ONLY:409,INVOICE_DELETED:410,DISCOUNT_EXCEEDS_COURSE_PRICE:400};
    if(documentStatus[code])return res.status(documentStatus[code]).json({success:false,code});
    if(code.startsWith('REFUND_'))return res.status(code==='REFUND_NOT_FOUND'?404:409).json({success:false,code});
    if(code.startsWith('DOCUMENT_LINK_')||code.startsWith('REMINDER_LINK_')||code==='DOCUMENT_NOT_FOUND'||code==='DOCUMENT_RECIPIENT_UNAVAILABLE')return res.status(404).json({success:false,code:'DOCUMENT_LINK_UNAVAILABLE'});
    if(code.startsWith('DISPUTE_'))return res.status(code==='DISPUTE_NOT_FOUND'?404:code==='DISPUTE_BALANCE_OUT_OF_SYNC'?503:409).json({success:false,code});
    const status=['TENANT_CONTEXT_REQUIRED','ACCOUNTANT_REQUIRED','PERMISSION_DENIED','INVOICE_ISSUER_ROLE_REQUIRED'].includes(code)?403:['FINANCE_POLICY_NOT_FOUND','VERIFIED_BUSINESS_OWNER_REQUIRED','INVOICE_NOT_FOUND','CUSTOMER_NOT_FOUND','PAYMENT_NOT_FOUND','RECEIPT_NOT_FOUND','SCHEDULE_CHANGE_NOT_FOUND','CREDIT_NOT_FOUND','SALE_REVIEW_NOT_FOUND','LEAD_NOT_FOUND'].includes(code)?404:['STALE_FINANCE_POLICY','STALE_REMINDER_SETTINGS','FINANCE_POLICY_REVIEW_PENDING','FINANCE_POLICY_NOT_DRAFT','FINANCE_POLICY_NOT_PENDING','BUSINESS_LINK_INVALID','INVOICE_NOT_PAYABLE','INVOICE_SETTINGS_REQUIRED','INVOICE_REQUEST_KEY_CONFLICT','COURSE_UNAVAILABLE','PAYMENT_NOT_PENDING','PAYMENT_IDEMPOTENCY_CONFLICT','SECOND_APPROVER_REQUIRED','PAYMENT_BALANCE_OUT_OF_RANGE','INSTALLMENT_BALANCE_OUT_OF_SYNC','INSTALLMENT_SCHEDULE_OUT_OF_SYNC','STALE_INSTALLMENT_SCHEDULE','SCHEDULE_CHANGE_IDEMPOTENCY_CONFLICT','SCHEDULE_CHANGE_ALREADY_PENDING','SCHEDULE_CHANGE_NOT_PENDING','SCHEDULE_SECOND_APPROVER_REQUIRED','PENDING_PAYMENT_BLOCKS_SCHEDULE_CHANGE','CREDIT_IDEMPOTENCY_CONFLICT','CREDIT_ALREADY_PENDING','CREDIT_NOT_PENDING','CREDIT_SECOND_APPROVER_REQUIRED','CREDIT_EXCEEDS_OUTSTANDING','PENDING_PAYMENT_BLOCKS_CREDIT','STALE_LEAD_REVISION','LEAD_NOT_OPEN','SALE_REVIEW_NOT_APPROVED','SALE_REVIEW_ALREADY_CONVERTED','SALE_APPROVAL_IDENTITY_REQUIRED','BATCH_UNAVAILABLE','FINANCE_POLICY_NOT_APPROVED','FINANCE_POLICY_INCOMPLETE','SALE_SCHEDULE_NEEDS_TAX_UPDATE','OFFER_PAYMENT_PLAN_CHANGED','INVOICE_NUMBER_CONFLICT','REMINDER_RECIPIENT_UNAVAILABLE'].includes(code)?409:['AUTH_REQUIRED','IDENTITY_REQUIRED'].includes(code)?401:code.startsWith('INVALID_')||['TAX_RATE_REQUIRED','TAX_RATE_NOT_APPLICABLE','TAX_MODE_REQUIRED','FINANCE_POLICY_INCOMPLETE','FINANCE_POLICY_REJECTION_REASON_REQUIRED','PAYMENT_REJECTION_REASON_REQUIRED','SCHEDULE_REJECTION_REASON_REQUIRED','SCHEDULE_DATES_MUST_BE_FUTURE','NO_FUTURE_UNPAID_INSTALLMENTS','INSTALLMENT_TOTAL_MISMATCH','INVALID_INSTALLMENT_SCHEDULE','INVALID_INSTALLMENT_AMOUNT','INVALID_INSTALLMENT_DATE','PAYMENT_SCHEDULE_TOTAL_MISMATCH'].includes(code)?400:['ACCOUNT_INACTIVE','BUSINESS_INACTIVE','CATEGORY_UNAVAILABLE','FEATURE_UNAVAILABLE'].includes(code)?409:503;
    res.status(status).json({success:false,code:status===503?'FINANCE_POLICY_UNAVAILABLE':code,...(error.details?{details:error.details}:{})});
  });
  return router;
}
function createPublicTrainingDocumentRouter({pool,origin}){
  const router=express.Router();
  router.use(express.json({limit:'2kb',strict:true}));
  router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Pragma','no-cache');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');next();});
  router.post('/resolve',async(req,res)=>{if((req.get('Origin')&&!require('./request-origin').matches(req,origin))||!req.body||typeof req.body.token!=='string'||Object.keys(req.body).some(key=>key!=='token'))return res.status(404).json({success:false,code:'DOCUMENT_LINK_UNAVAILABLE'});const db=await pool.getConnection();try{const data=await documentGrants.resolve(db,req.body.token);res.json({success:true,data});}catch(error){res.status(404).json({success:false,code:'DOCUMENT_LINK_UNAVAILABLE'});}finally{db.release();}});
  return router;
}
function createPublicTrainingReminderRouter({pool,origin}){
  const router=express.Router();
  router.use(express.json({limit:'2kb',strict:true}));
  router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Pragma','no-cache');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');next();});
  router.post('/resolve',async(req,res)=>{if((req.get('Origin')&&!require('./request-origin').matches(req,origin))||!req.body||typeof req.body.token!=='string'||Object.keys(req.body).some(key=>key!=='token'))return res.status(404).json({success:false,code:'REMINDER_LINK_UNAVAILABLE'});const db=await pool.getConnection();try{const data=await reminderPreferences.resolve(db,req.body.token);res.json({success:true,data});}catch{res.status(404).json({success:false,code:'REMINDER_LINK_UNAVAILABLE'});}finally{db.release();}});
  router.post('/update',async(req,res)=>{if(!require('./request-origin').matches(req,origin)||!req.body||typeof req.body.token!=='string'||typeof req.body.optIn!=='boolean'||Object.keys(req.body).some(key=>!['token','optIn'].includes(key)))return res.status(404).json({success:false,code:'REMINDER_LINK_UNAVAILABLE'});const db=await pool.getConnection();try{const data=await reminderPreferences.update(db,req.body.token,req.body.optIn);res.json({success:true,data});}catch{res.status(404).json({success:false,code:'REMINDER_LINK_UNAVAILABLE'});}finally{db.release();}});
  router.post('/update-whatsapp',async(req,res)=>{if(!require('./request-origin').matches(req,origin)||!req.body||typeof req.body.token!=='string'||typeof req.body.optIn!=='boolean'||Object.keys(req.body).some(key=>!['token','optIn'].includes(key)))return res.status(404).json({success:false,code:'REMINDER_LINK_UNAVAILABLE'});const db=await pool.getConnection();try{const data=await reminderPreferences.updateWhatsApp(db,req.body.token,req.body.optIn);res.json({success:true,data});}catch{res.status(404).json({success:false,code:'REMINDER_LINK_UNAVAILABLE'});}finally{db.release();}});
  return router;
}
module.exports={createTrainingFinanceRouter,createPublicTrainingDocumentRouter,createPublicTrainingReminderRouter};
