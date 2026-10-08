'use strict';

const crypto=require('node:crypto');
const courses=require('./training-courses');
const offerPlan=require('./training-offer-plan');
const fail=code=>{const badInput=['PAYER_CONTACT_REQUIRED','INVOICE_EMAIL_REQUIRED','INSTALLMENT_TOTAL_MISMATCH','REJECTION_REASON_REQUIRED'];const missing=['LEAD_NOT_FOUND','SALE_REVIEW_NOT_FOUND'];const forbidden=['PERMISSION_DENIED'];const conflict=['LEAD_NOT_OPEN','STALE_LEAD_REVISION','IDEMPOTENCY_CONFLICT','OFFER_UNAVAILABLE','OFFER_CURRENCY_UNAVAILABLE','OFFER_PRICE_CHANGED','BATCH_UNAVAILABLE','SALE_REVIEW_ALREADY_DECIDED','STALE_REVISION','FEATURE_UNAVAILABLE','CATEGORY_UNAVAILABLE','APPLICATION_LEAD_MISMATCH'];const status=code.startsWith('INVALID_')?400:badInput.includes(code)?400:missing.includes(code)?404:forbidden.includes(code)?403:conflict.includes(code)?409:503;throw Object.assign(new Error(code),{code,status});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const text=(value,max,code)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail(code);return value.trim();};
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function email(value,code){const out=value==null?'':String(value).trim().toLowerCase();if(out.length>254||(out&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out)))fail(code);return out||null;}
function phone(value,code){const out=value==null?'':String(value).replace(/[\s().-]/g,'');if(out&&(!/^\+[1-9]\d{7,14}$/.test(out)))fail(code);return out||null;}
function todayQatar(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function date(value,code){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail(code);const d=new Date(value+'T00:00:00Z');if(Number.isNaN(d.valueOf())||d.toISOString().slice(0,10)!==value||value<todayQatar())fail(code);return value;}
function normalize(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_SALE_REVIEW');
  const allowed=new Set(['requestKey','courseId','offerId','batchId','applicationSubmissionId','priceMinor','discountMinor','learnerName','payerName','payerEmail','payerPhone','invoiceEmail','terms','installments','expectedLeadUpdatedAt']);if(Object.keys(input).some(key=>!allowed.has(key)))fail('INVALID_SALE_REVIEW');
  if(!uuid(input.requestKey)||!uuid(input.courseId)||!uuid(input.offerId)||(input.batchId!=null&&!uuid(input.batchId)))fail('INVALID_SALE_REVIEW');
  if(typeof input.expectedLeadUpdatedAt!=='string'||!Number.isFinite(Date.parse(input.expectedLeadUpdatedAt)))fail('INVALID_LEAD_REVISION');
  for(const key of ['priceMinor','discountMinor'])if(!Number.isSafeInteger(input[key])||input[key]<0||input[key]>100000000000)fail('INVALID_SALE_AMOUNT');
  if(input.discountMinor>input.priceMinor)fail('INVALID_SALE_AMOUNT');
  if(!Array.isArray(input.installments)||input.installments.length<1||input.installments.length>12)fail('INVALID_INSTALLMENTS');
  const installments=input.installments.map(item=>{if(!item||!Number.isSafeInteger(item.amountMinor)||item.amountMinor<1||item.amountMinor>100000000000)fail('INVALID_INSTALLMENTS');return {amountMinor:item.amountMinor,dueDate:date(item.dueDate,'INVALID_INSTALLMENT_DATE')};});
  for(let i=1;i<installments.length;i++)if(installments[i].dueDate<installments[i-1].dueDate)fail('INVALID_INSTALLMENT_ORDER');
  const payerEmail=email(input.payerEmail,'INVALID_EMAIL'),payerPhone=phone(input.payerPhone,'INVALID_PHONE');
  if(!payerEmail&&!payerPhone)fail('PAYER_CONTACT_REQUIRED');
  const invoiceEmail=email(input.invoiceEmail||payerEmail,'INVALID_INVOICE_EMAIL');
  if(!invoiceEmail)fail('INVOICE_EMAIL_REQUIRED');
  const discountMinor=input.discountMinor;
  if(input.applicationSubmissionId!=null&&!uuid(input.applicationSubmissionId))fail('INVALID_APPLICATION_SUBMISSION');
  return {requestKey:input.requestKey,courseId:input.courseId,offerId:input.offerId,batchId:input.batchId||null,applicationSubmissionId:input.applicationSubmissionId||null,priceMinor:input.priceMinor,discountMinor,
    learnerName:text(input.learnerName,255,'INVALID_LEARNER_NAME'),payerName:text(input.payerName,255,'INVALID_PAYER_NAME'),payerEmail,payerPhone,invoiceEmail,
    terms:text(input.terms,2000,'INVALID_SALE_TERMS'),installments,expectedLeadUpdatedAt:input.expectedLeadUpdatedAt};
}
function leadTimestampMatches(dbValue,provided){const actual=dbValue instanceof Date?dbValue.toISOString():new Date(String(dbValue).replace(' ','T')+'Z').toISOString();return actual===new Date(provided).toISOString();}
function publicReview(row,readiness={ready:false,blocker:row.status==='approved'?'INVOICE_SETTINGS_REQUIRED':'SALE_REVIEW_NOT_APPROVED'}){const installments=typeof row.installments==='string'?JSON.parse(row.installments):row.installments;return {...row,revision:Number(row.revision),offerVersion:Number(row.offer_version),priceMinor:Number(row.price_minor),registrationFeeMinor:Number(row.registration_fee_minor),discountMinor:Number(row.discount_minor),netMinor:Number(row.net_minor),installments,conversionReady:readiness.ready===true,conversionBlocker:readiness.ready||readiness.converted?null:readiness.blocker,converted:readiness.converted===true,invoiceNumber:readiness.invoiceNumber||null,invoiceTotalMinor:readiness.invoiceTotalMinor??null};}
async function conversionReadiness(db,ctx,row){
  if(row.status!=='approved')return {ready:false,blocker:'SALE_REVIEW_NOT_APPROVED'};
  const [[converted]]=await db.query(`SELECT i.invoice_number,i.total_minor FROM sx_training_sale_conversions c JOIN sx_training_invoices i ON i.tenant_id=c.tenant_id AND i.id=c.invoice_id WHERE c.tenant_id=? AND c.sale_review_id=? LIMIT 1`,[ctx.tenant.id,row.id]);if(converted)return {ready:false,converted:true,invoiceNumber:converted.invoice_number,invoiceTotalMinor:Number(converted.total_minor)};
  try{const [[profile]]=await db.query('SELECT display_name_en,cr_number,invoice_prefix FROM sx_training_center_profiles WHERE tenant_id=?',[ctx.tenant.id]);if(!profile||!profile.display_name_en.trim()||!profile.invoice_prefix)return {ready:false,blocker:'INVOICE_SETTINGS_REQUIRED'};const policy={taxMode:'no_tax',taxRateBps:null};const agentId=String(ctx.membership.id||'').startsWith('legacy-agent-')?String(ctx.membership.id).slice('legacy-agent-'.length):'',agentApproved=ctx.membership.role==='agent'&&row.decided_by_role==='agent'&&row.decided_by_type==='agent'&&row.submitted_by_type==='agent'&&row.submitted_by_id===agentId&&row.decided_by_id===agentId&&Number(row.discount_minor)===0;if(ctx.membership.role==='agent'&&!agentApproved&&!['owner','manager'].includes(row.decided_by_role))return {ready:false,blocker:'SALE_APPROVAL_IDENTITY_REQUIRED'};const conversion=require('./training-sale-conversion'),amounts=conversion.totals(Number(row.net_minor),policy),installments=typeof row.installments==='string'?JSON.parse(row.installments):row.installments;conversion.invoiceInstallments(installments,Number(row.net_minor),amounts.totalMinor);return {ready:true,invoiceTotalMinor:amounts.totalMinor,taxMinor:amounts.taxMinor};}
  catch(error){return {ready:false,blocker:error.code==='INSTALLMENT_TOTAL_MISMATCH'?'SALE_SCHEDULE_NEEDS_TAX_UPDATE':error.code||'INVOICE_SETTINGS_REQUIRED'};}
}
async function listOptions(pool,ctx){
  const policy=require('./policy');for(const request of [{capability:'training.enrollments',permission:'sales.request'},{capability:'training.courses',permission:'courses.read'}]){const check=policy.decision(ctx,request);if(!check.allowed)fail(check.code);}
  const [rows]=await pool.query(`SELECT c.id AS courseId,c.name_en AS nameEn,c.name_ar AS nameAr,o.id AS offerId,o.version AS offerVersion,o.price_minor AS priceMinor,o.registration_fee_minor AS registrationFeeMinor,o.payment_term_count AS paymentTermCount,o.payment_interval AS paymentInterval,o.currency,b.id AS batchId,b.code AS batchCode,b.starts_on AS startsOn,b.ends_on AS endsOn,b.capacity,b.reserved_seats AS reservedSeats
    FROM sx_training_courses c JOIN sx_training_offers o ON o.tenant_id=c.tenant_id AND o.course_id=c.id AND o.status='active'
    LEFT JOIN sx_training_batches b ON b.tenant_id=c.tenant_id AND b.course_id=c.id AND b.status IN ('scheduled','open') AND b.starts_on>=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'UTC','Asia/Qatar')) AND b.reserved_seats<b.capacity
    WHERE c.tenant_id=? AND c.status='active' AND (o.valid_from IS NULL OR o.valid_from<=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'UTC','Asia/Qatar'))) AND (o.valid_until IS NULL OR o.valid_until>=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'UTC','Asia/Qatar')))
    ORDER BY c.name_en,o.version DESC,b.starts_on,b.code`,[ctx.tenant.id]);
  return rows.map(row=>({...row,priceMinor:Number(row.priceMinor),registrationFeeMinor:Number(row.registrationFeeMinor),paymentTermCount:Number(row.paymentTermCount||1),paymentInterval:row.paymentInterval||'once',capacity:row.capacity==null?null:Number(row.capacity),reservedSeats:row.reservedSeats==null?null:Number(row.reservedSeats)}));
}
async function listForLead(pool,ctx,{leadId,uid,role,agentId}){
  const check=require('./policy').decision(ctx,{capability:'training.enrollments',permission:'sales.request'});if(!check.allowed)fail(check.code);
  const db=await pool.getConnection();try{const [[lead]]=await db.query('SELECT id,owner_agent_id,status FROM pipeline_leads WHERE uid_hash=? AND uid=? AND id=?',[sha(uid),uid,leadId]);if(!lead)fail('LEAD_NOT_FOUND');if(role==='agent'&&Number(lead.owner_agent_id)!==Number(agentId))fail('LEAD_NOT_FOUND');
    const [rows]=await db.query(`SELECT r.id,r.lead_id,r.application_submission_id,s.reference_code AS application_reference_code,r.request_key,r.revision,r.status,r.course_name_en,r.course_name_ar,r.offer_version,r.currency,r.price_minor,r.registration_fee_minor,r.discount_minor,r.net_minor,r.learner_name,r.payer_name,r.payer_email,r.payer_phone,r.invoice_email,r.terms_snapshot,r.installments,r.submitted_by_type,r.submitted_by_id,r.decided_by_type,r.decided_by_role,r.decided_by_id,r.decision_reason,r.decided_at,r.created_at
      FROM sx_training_sale_reviews r LEFT JOIN sx_training_form_submissions s ON s.tenant_id=r.tenant_id AND s.id=r.application_submission_id
      WHERE r.tenant_id=? AND r.lead_id=? ORDER BY r.created_at DESC,r.id`,[ctx.tenant.id,leadId]);return Promise.all(rows.map(async row=>publicReview(row,await conversionReadiness(db,ctx,row))));
  }finally{db.release();}
}
async function listApprovedForInvoice(pool,ctx,{uid}){
  const permission=require('./policy').decision(ctx,{capability:'finance.invoices',permission:'invoices.issue'});if(!permission.allowed)fail(permission.code);
  if(!['owner','accountant'].includes(ctx.membership.role)||typeof uid!=='string'||!uid)fail('PERMISSION_DENIED');
  const db=await pool.getConnection();try{
    const [rows]=await db.query(`SELECT r.id,r.lead_id,r.revision,r.status,r.decided_by_role,r.installments,r.lead_updated_at_snapshot,r.course_name_en,r.course_name_ar,r.currency,r.net_minor,r.learner_name,r.payer_name,r.decided_at,l.updated_at AS lead_updated_at
      FROM sx_training_sale_reviews r JOIN pipeline_leads l ON l.id=r.lead_id AND l.uid_hash=r.legacy_uid_hash AND l.uid=r.legacy_uid
      WHERE r.tenant_id=? AND r.legacy_uid_hash=? AND r.legacy_uid=? AND r.status='approved' AND l.status='open'
        AND NOT EXISTS (SELECT 1 FROM sx_training_sale_conversions c WHERE c.tenant_id=r.tenant_id AND c.sale_review_id=r.id)
      ORDER BY r.decided_at DESC,r.created_at DESC LIMIT 100`,[ctx.tenant.id,sha(uid),uid]);
    return Promise.all(rows.map(async row=>{let readiness=await conversionReadiness(db,ctx,row);if(readiness.ready&&!leadTimestampMatches(row.lead_updated_at,row.lead_updated_at_snapshot))readiness={ready:false,blocker:'STALE_LEAD_REVISION'};return {id:row.id,leadId:row.lead_id,revision:Number(row.revision),courseNameEn:row.course_name_en,courseNameAr:row.course_name_ar,currency:row.currency,netMinor:Number(row.net_minor),learnerName:row.learner_name,payerName:row.payer_name,approvedAt:row.decided_at,leadUpdatedAt:row.lead_updated_at,conversionReady:readiness.ready,conversionBlocker:readiness.blocker||null};}));
  }finally{db.release();}
}
async function create(pool,ctx,{uid,leadId,role,agentId,actorType,actorId,input}){
  const data=normalize(input);const capability=require('./policy').decision(ctx,{capability:'training.enrollments',permission:'sales.request'});if(!capability.allowed)fail(capability.code);
  const db=await pool.getConnection();try{await db.beginTransaction();
    const [[lead]]=await db.query('SELECT id,owner_agent_id,status,stage_key,updated_at FROM pipeline_leads WHERE uid_hash=? AND uid=? AND id=? FOR UPDATE',[sha(uid),uid,leadId]);if(!lead)fail('LEAD_NOT_FOUND');if(role==='agent'&&Number(lead.owner_agent_id)!==Number(agentId))fail('LEAD_NOT_FOUND');if(lead.status!=='open')fail('LEAD_NOT_OPEN');if(!leadTimestampMatches(lead.updated_at,data.expectedLeadUpdatedAt))fail('STALE_LEAD_REVISION');
    if(data.applicationSubmissionId){const [[application]]=await db.query('SELECT id FROM sx_training_form_submissions WHERE tenant_id=? AND id=? AND lead_id=? FOR UPDATE',[ctx.tenant.id,data.applicationSubmissionId,leadId]);if(!application)fail('APPLICATION_LEAD_MISMATCH');}
    const [[replay]]=await db.query('SELECT id,request_hash FROM sx_training_sale_reviews WHERE tenant_id=? AND request_key=? LIMIT 1 FOR UPDATE',[ctx.tenant.id,data.requestKey]);
    const requestBody={...data};delete requestBody.requestKey;delete requestBody.expectedLeadUpdatedAt;const requestHash=sha(JSON.stringify(requestBody));
    if(replay){if(replay.request_hash!==requestHash)fail('IDEMPOTENCY_CONFLICT');const [[row]]=await db.query('SELECT * FROM sx_training_sale_reviews WHERE tenant_id=? AND id=?',[ctx.tenant.id,replay.id]);await db.commit();return {...publicReview(row),repeated:true};}
    const [[offer]]=await db.query(`SELECT c.name_en AS nameEn,c.name_ar AS nameAr,c.status AS courseStatus,o.version,o.currency,o.price_minor AS priceMinor,o.registration_fee_minor AS registrationFeeMinor,o.payment_term_count AS paymentTermCount,o.payment_interval AS paymentInterval,o.status AS offerStatus
      FROM sx_training_courses c JOIN sx_training_offers o ON o.tenant_id=c.tenant_id AND o.course_id=c.id WHERE c.tenant_id=? AND c.id=? AND o.id=? AND o.status='active' AND (o.valid_from IS NULL OR o.valid_from<=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'UTC','Asia/Qatar'))) AND (o.valid_until IS NULL OR o.valid_until>=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'UTC','Asia/Qatar'))) FOR UPDATE`,[ctx.tenant.id,data.courseId,data.offerId]);
    if(!offer||offer.courseStatus!=='active'||offer.offerStatus!=='active')fail('OFFER_UNAVAILABLE');if(offer.currency!=='QAR')fail('OFFER_CURRENCY_UNAVAILABLE');
    const priceMinor=Number(offer.priceMinor),registrationFeeMinor=Number(offer.registrationFeeMinor);if(data.priceMinor!==priceMinor)fail('OFFER_PRICE_CHANGED');if(data.discountMinor>priceMinor)fail('INVALID_SALE_AMOUNT');
    if(data.batchId){const [[batch]]=await db.query("SELECT id FROM sx_training_batches WHERE tenant_id=? AND course_id=? AND id=? AND status IN ('scheduled','open') AND starts_on>=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'UTC','Asia/Qatar')) AND reserved_seats<capacity FOR UPDATE",[ctx.tenant.id,data.courseId,data.batchId]);if(!batch)fail('BATCH_UNAVAILABLE');}
    const netMinor=priceMinor+registrationFeeMinor-data.discountMinor;if(netMinor<1||data.installments.reduce((sum,item)=>sum+item.amountMinor,0)!==netMinor)fail('INSTALLMENT_TOTAL_MISMATCH');const autoApproved=role==='agent'&&data.discountMinor===0&&offerPlan.matchesSchedule(data.installments,netMinor,Number(offer.paymentTermCount||1),offer.paymentInterval||'once');
    const id=crypto.randomUUID();await db.query(`INSERT INTO sx_training_sale_reviews(id,tenant_id,legacy_uid_hash,legacy_uid,lead_id,application_submission_id,request_key,request_hash,course_id,offer_id,batch_id,course_name_en,course_name_ar,offer_version,currency,price_minor,registration_fee_minor,discount_minor,net_minor,learner_name,payer_name,payer_email,payer_phone,invoice_email,terms_snapshot,installments,lead_updated_at_snapshot,submitted_by_type,submitted_by_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,ctx.tenant.id,sha(uid),uid,leadId,data.applicationSubmissionId,data.requestKey,requestHash,data.courseId,data.offerId,data.batchId,offer.nameEn,offer.nameAr,offer.version,offer.currency,priceMinor,registrationFeeMinor,data.discountMinor,netMinor,data.learnerName,data.payerName,data.payerEmail,data.payerPhone,data.invoiceEmail,data.terms,JSON.stringify(data.installments),lead.updated_at,actorType,actorId]);
    if(autoApproved){await db.query("UPDATE sx_training_sale_reviews SET status='approved',revision=2,decided_by_type='agent',decided_by_id=?,decided_by_role='agent',decision_reason='Published full-price course offer and payment plan accepted',decided_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND status='pending'",[actorId,ctx.tenant.id,id]);await db.query("INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,actor_id,activity_type,summary,details) VALUES (?,?,?,?,'sale_review_autoapproved','Published course offer accepted',?)",[sha(uid),leadId,actorType,actorId,JSON.stringify({saleReviewId:id,courseId:data.courseId,offerId:data.offerId,paymentTermCount:offer.paymentTermCount,paymentInterval:offer.paymentInterval})]);}
    await db.query("INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,actor_id,activity_type,summary,details) VALUES (?,?,?,?,'sale_review_requested','Sale review requested',?)",[sha(uid),leadId,actorType,actorId,JSON.stringify({saleReviewId:id,discountMinor:data.discountMinor,courseId:data.courseId})]);
    const [[row]]=await db.query('SELECT * FROM sx_training_sale_reviews WHERE tenant_id=? AND id=?',[ctx.tenant.id,id]);await db.commit();return publicReview(row);
  }catch(error){try{await db.rollback();}catch{}if(error.code==='ER_DUP_ENTRY')fail('IDEMPOTENCY_CONFLICT');throw error;}finally{db.release();}
}
async function decide(pool,ctx,{uid,leadId,reviewId,actorType,actorId,actorRole,expectedRevision,decision,reason}){
  const check=require('./policy').decision(ctx,{capability:'training.enrollments',permission:'sales.approve'});if(!check.allowed)fail(check.code);
  if(!uuid(reviewId)||!Number.isSafeInteger(expectedRevision)||expectedRevision<1||!['approved','rejected'].includes(decision))fail('INVALID_DECISION');
  const note=decision==='rejected'?text(reason,1000,'REJECTION_REASON_REQUIRED'):null;const db=await pool.getConnection();try{await db.beginTransaction();
    await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[ctx.tenant.id]);const [[lead]]=await db.query('SELECT status,updated_at FROM pipeline_leads WHERE uid_hash=? AND uid=? AND id=? FOR UPDATE',[sha(uid),uid,leadId]);if(!lead)fail('LEAD_NOT_FOUND');if(decision==='approved'&&lead.status!=='open')fail('LEAD_NOT_OPEN');
    const [[row]]=await db.query('SELECT * FROM sx_training_sale_reviews WHERE tenant_id=? AND lead_id=? AND id=? FOR UPDATE',[ctx.tenant.id,leadId,reviewId]);if(!row)fail('SALE_REVIEW_NOT_FOUND');if(row.status===decision&&row.decided_by_type===actorType&&String(row.decided_by_id)===String(actorId)&&row.decided_by_role===actorRole&&(decision!=='rejected'||row.decision_reason===reason)){await db.commit();return {...publicReview(row),repeated:true};}if(row.status!=='pending')fail('SALE_REVIEW_ALREADY_DECIDED');if(Number(row.revision)!==expectedRevision)fail('STALE_REVISION');
    if(decision==='approved'){
      if(!leadTimestampMatches(lead.updated_at,row.lead_updated_at_snapshot))fail('STALE_LEAD_REVISION');
      const [[offer]]=await db.query("SELECT o.status,c.status AS course_status FROM sx_training_offers o JOIN sx_training_courses c ON c.tenant_id=o.tenant_id AND c.id=o.course_id WHERE o.tenant_id=? AND o.id=? AND c.id=? FOR UPDATE",[ctx.tenant.id,row.offer_id,row.course_id]);if(!offer||offer.status!=='active'||offer.course_status!=='active')fail('OFFER_UNAVAILABLE');
      if(row.batch_id){const [[batch]]=await db.query("SELECT id FROM sx_training_batches WHERE tenant_id=? AND course_id=? AND id=? AND status IN ('scheduled','open') AND reserved_seats<capacity FOR UPDATE",[ctx.tenant.id,row.course_id,row.batch_id]);if(!batch)fail('BATCH_UNAVAILABLE');}
    }
    await db.query('UPDATE sx_training_sale_reviews SET status=?,revision=revision+1,decided_by_type=?,decided_by_role=?,decided_by_id=?,decision_reason=?,decided_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?',[decision,actorType,actorRole,actorId,note,ctx.tenant.id,reviewId]);
    await db.query("INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,actor_id,activity_type,summary,details) VALUES (?,?,?,?,'sale_review_decided',?,?)",[sha(uid),leadId,actorType,actorId,decision==='approved'?'Sale review approved':'Sale review rejected',JSON.stringify({saleReviewId:reviewId,decision,reason:note})]);
    const [[updated]]=await db.query('SELECT * FROM sx_training_sale_reviews WHERE tenant_id=? AND id=?',[ctx.tenant.id,reviewId]);await db.commit();return publicReview(updated);
  }catch(error){try{await db.rollback();}catch{}throw error;}finally{db.release();}
}
module.exports={listOptions,listForLead,listApprovedForInvoice,create,decide,normalize};
