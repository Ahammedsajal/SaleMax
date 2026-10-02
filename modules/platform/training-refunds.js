'use strict';
const crypto = require('node:crypto');
const credits = require('./training-credits');
const payments = require('./training-payments');
const finance = require('./finance-contract');
const outbox = require('./training-outbox');
const fail = code => { throw Object.assign(new Error(code), {code}); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function normalize(paymentId, input) {
  if (!uuid(paymentId) || !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['requestKey','amountMinor','reason'].includes(key)) || !uuid(input.requestKey) || !Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1 || input.amountMinor > 100000000000 || typeof input.reason !== 'string' || input.reason.trim().length < 3 || input.reason.length > 1000) fail('INVALID_REFUND_REQUEST');
  return {paymentId, requestKey:input.requestKey, amountMinor:input.amountMinor, reason:input.reason.trim()};
}
function normalizeCompletion(id, input) {
  if (!uuid(id) || !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['requestKey','method','reference','completedAt'].includes(key)) || !['cash','bank_transfer'].includes(input.method) || typeof input.reference !== 'string' || input.reference.trim().length < 3) fail('INVALID_REFUND_COMPLETION');
  const data = payments.normalizeRecord(id, {requestKey:input.requestKey, method:input.method, amountMinor:1, receivedAt:input.completedAt, reference:input.reference});
  if (data.receivedAt.getTime() > Date.now() + 60000) fail('INVALID_REFUND_DATE');
  return {requestKey:data.requestKey, method:data.method, reference:data.reference, completedAt:data.receivedAt.toISOString()};
}
function shape(row, ctx) {
  return {id:row.id, paymentId:row.payment_id, invoiceId:row.invoice_id, invoiceNumber:row.invoice_number || null, currency:row.currency, amountMinor:Number(row.amount_minor), reason:row.reason, status:row.status, requestedByIdentityId:row.requested_by_identity_id, reviewedByIdentityId:row.reviewed_by_identity_id || null, reviewedAt:row.reviewed_at || null, reviewReason:row.review_reason || null, completedAt:row.completed_at || null, completedByIdentityId:row.completed_by_identity_id || null, method:row.method || null, reference:row.external_reference || null, createdAt:row.created_at, canReview:row.status === 'pending_approval' && row.requested_by_identity_id !== ctx?.identity?.id, canComplete:row.status === 'approved' && ctx?.membership?.role === 'accountant', externalDispatch:false};
}
async function paymentState(db, ctx, paymentId, lock=false) {
  const [[row]] = await db.query(`SELECT * FROM sx_training_payments WHERE tenant_id=? AND id=?${lock?' FOR UPDATE':''}`, [ctx.tenant.id,paymentId]);
  if (!row) fail('PAYMENT_NOT_FOUND');
  if (row.status !== 'posted' || row.currency !== 'QAR') fail('REFUND_REQUIRES_POSTED_QAR_PAYMENT');
  const [[totals]] = await db.query("SELECT COALESCE(SUM(CASE WHEN status='completed' THEN amount_minor ELSE 0 END),0) AS refunded,COALESCE(SUM(CASE WHEN status IN ('pending_approval','approved') THEN amount_minor ELSE 0 END),0) AS reserved FROM sx_training_refunds WHERE tenant_id=? AND payment_id=?", [ctx.tenant.id,paymentId]);
  const [[allocations]] = await db.query('SELECT COALESCE(SUM(amount_minor),0) AS allocated FROM sx_training_payment_allocations WHERE tenant_id=? AND payment_id=?', [ctx.tenant.id,paymentId]);
  const balance = finance.paymentBalance({grossMinor:Number(row.amount_minor), completedRefundMinor:Number(totals.refunded), allocatedMinor:Number(allocations.allocated)});
  if (balance.availableMinor !== Number(row.unapplied_minor)) fail('REFUND_BALANCE_OUT_OF_SYNC');
  return {payment:row, refundedMinor:Number(totals.refunded), reservedMinor:Number(totals.reserved), availableMinor:balance.availableMinor, requestableMinor:balance.availableMinor-Number(totals.reserved)};
}
async function audit(db,ctx,id,action,changes,key) {
  await db.query("INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity',?,'refund',?,?,?)", [crypto.randomUUID(),ctx.tenant.id,ctx.identity.id,action,id,JSON.stringify(changes),key]);
}
async function request(db,ctx,paymentId,input) {
  credits.requireRole(ctx,['owner','accountant']);
  const data=normalize(paymentId,input),requestHash=hash(data);
  await db.beginTransaction();
  try {
    await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[ctx.tenant.id]);
    const [[prior]]=await db.query('SELECT * FROM sx_training_refunds WHERE tenant_id=? AND request_key=? FOR UPDATE',[ctx.tenant.id,data.requestKey]);
    if(prior){if(prior.request_hash!==requestHash)fail('REFUND_IDEMPOTENCY_CONFLICT');await db.commit();return {...shape(prior,ctx),repeated:true};}
    const state=await paymentState(db,ctx,paymentId,true);
    if(data.amountMinor>state.requestableMinor)fail('REFUND_EXCEEDS_UNAPPLIED_FUNDS');
    const id=crypto.randomUUID();
    await db.query('INSERT INTO sx_training_refunds(id,tenant_id,payment_id,invoice_id,request_key,request_hash,currency,amount_minor,reason,requested_by_identity_id) VALUES (?,?,?,?,?,?,?,?,?,?)',[id,ctx.tenant.id,paymentId,state.payment.invoice_id,data.requestKey,requestHash,state.payment.currency,data.amountMinor,data.reason,ctx.identity.id]);
    await audit(db,ctx,id,'training.refund-requested',{paymentId,amountMinor:data.amountMinor,reason:data.reason},data.requestKey);
    const [[row]]=await db.query('SELECT * FROM sx_training_refunds WHERE tenant_id=? AND id=?',[ctx.tenant.id,id]);
    await db.commit();return {...shape(row,ctx),repeated:false};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
async function decide(db,ctx,id,{decision,reason=''}={}) {
  credits.requireRole(ctx,['owner','accountant']);
  if(!uuid(id)||!['approved','rejected'].includes(decision)||typeof reason!=='string'||reason.length>1000||(decision==='rejected'&&reason.trim().length<3))fail('INVALID_REFUND_DECISION');
  await db.beginTransaction();
  try {
    await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[ctx.tenant.id]);
    const [[row]]=await db.query('SELECT * FROM sx_training_refunds WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,id]);
    if(!row)fail('REFUND_NOT_FOUND');
    if(row.status===decision||(decision==='approved'&&row.status==='completed')){await db.commit();return {...shape(row,ctx),repeated:true};}
    if(row.status!=='pending_approval')fail('REFUND_NOT_PENDING');
    if(row.requested_by_identity_id===ctx.identity.id)fail('REFUND_SECOND_APPROVER_REQUIRED');
    if(decision==='approved'){const state=await paymentState(db,ctx,row.payment_id,true);if(state.reservedMinor>state.availableMinor)fail('REFUND_EXCEEDS_UNAPPLIED_FUNDS');}
    await db.query("UPDATE sx_training_refunds SET status=?,reviewed_by_identity_id=?,reviewed_at=UTC_TIMESTAMP(3),review_reason=? WHERE tenant_id=? AND id=? AND status='pending_approval'",[decision,ctx.identity.id,reason.trim()||null,ctx.tenant.id,id]);
    await audit(db,ctx,id,`training.refund-${decision}`,{decision,reason:reason.trim()},row.request_key);
    const [[updated]]=await db.query('SELECT * FROM sx_training_refunds WHERE tenant_id=? AND id=?',[ctx.tenant.id,id]);
    await db.commit();return {...shape(updated,ctx),repeated:false};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
async function complete(db,ctx,id,input) {
  credits.requireRole(ctx,['accountant']);
  const data=normalizeCompletion(id,input),completionHash=hash(data);
  await db.beginTransaction();
  try {
    await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[ctx.tenant.id]);
    const [[row]]=await db.query('SELECT * FROM sx_training_refunds WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,id]);
    if(!row)fail('REFUND_NOT_FOUND');
    if(row.status==='completed'){if(row.completion_key!==data.requestKey||row.completion_hash!==completionHash)fail('REFUND_COMPLETION_CONFLICT');await db.commit();return {...shape(row,ctx),repeated:true};}
    if(row.status!=='approved')fail('REFUND_NOT_APPROVED');
    const state=await paymentState(db,ctx,row.payment_id,true),amount=Number(row.amount_minor);
    if(amount>state.availableMinor||state.reservedMinor>state.availableMinor)fail('REFUND_EXCEEDS_UNAPPLIED_FUNDS');
    const lines=[{currency:row.currency,debitMinor:amount,creditMinor:0},{currency:row.currency,debitMinor:0,creditMinor:amount}];finance.assertBalancedJournal(lines);
    const journalId=crypto.randomUUID(),cashAccount=data.method==='cash'?'cash':'bank';
    await db.query("INSERT INTO sx_training_journal_entries(id,tenant_id,source_type,source_id,entry_type,currency,occurred_at,created_by_identity_id) VALUES (?,?,'manual-refund',?,'refund_posted',?,?,?)",[journalId,ctx.tenant.id,id,row.currency,new Date(data.completedAt),ctx.identity.id]);
    await db.query("INSERT INTO sx_training_journal_lines(tenant_id,entry_id,line_number,account_code,debit_minor,credit_minor) VALUES (?,?,1,'customer_deposits',?,0),(?,?,2,?,0,?)",[ctx.tenant.id,journalId,amount,ctx.tenant.id,journalId,cashAccount,amount]);
    await db.query("UPDATE sx_training_refunds SET status='completed',completion_key=?,completion_hash=?,completed_by_identity_id=?,completed_at=?,method=?,external_reference=? WHERE tenant_id=? AND id=? AND status='approved'",[data.requestKey,completionHash,ctx.identity.id,new Date(data.completedAt),data.method,data.reference,ctx.tenant.id,id]);
    await db.query('UPDATE sx_training_payments SET unapplied_minor=? WHERE tenant_id=? AND id=?',[state.availableMinor-amount,ctx.tenant.id,row.payment_id]);
    await audit(db,ctx,id,'training.refund-completed',{paymentId:row.payment_id,amountMinor:amount,method:data.method,reference:data.reference,completedAt:data.completedAt},data.requestKey);
    await outbox.enqueue(db,ctx,{idempotencyKey:`refund-completed-${id}`,eventType:'finance.refund.completed',resourceType:'refund',resourceId:id,revision:1,correlationId:row.request_key});
    const [[updated]]=await db.query('SELECT * FROM sx_training_refunds WHERE tenant_id=? AND id=?',[ctx.tenant.id,id]);
    await db.commit();return {...shape(updated,ctx),repeated:false};
  }catch(error){try{await db.rollback();}catch{}if(error.code==='ER_DUP_ENTRY')fail('REFUND_COMPLETION_CONFLICT');throw error;}
}
async function queue(db,ctx,{page=1,limit=20}={}) {
  credits.requireRole(ctx,['owner','accountant']);page=Number(page);limit=Number(limit);
  if(!Number.isSafeInteger(page)||page<1||page>10000||!Number.isSafeInteger(limit)||limit<1||limit>50)fail('INVALID_REFUND_PAGE');
  const [[count]]=await db.query("SELECT COUNT(*) AS total FROM sx_training_refunds WHERE tenant_id=? AND status IN ('pending_approval','approved')",[ctx.tenant.id]);
  const [rows]=await db.query("SELECT r.*,i.invoice_number FROM sx_training_refunds r JOIN sx_training_invoices i ON i.tenant_id=r.tenant_id AND i.id=r.invoice_id WHERE r.tenant_id=? AND r.status IN ('pending_approval','approved') ORDER BY r.created_at,r.id LIMIT ? OFFSET ?",[ctx.tenant.id,limit,(page-1)*limit]);
  return {page,limit,total:Number(count.total),pages:Math.ceil(Number(count.total)/limit),items:rows.map(row=>shape(row,ctx))};
}
async function invoiceState(db,ctx,invoiceId) {
  const [rows]=await db.query('SELECT * FROM sx_training_refunds WHERE tenant_id=? AND invoice_id=? ORDER BY created_at DESC,id DESC',[ctx.tenant.id,invoiceId]);
  return rows.map(row=>shape(row,ctx));
}
module.exports={normalize,normalizeCompletion,request,decide,complete,queue,invoiceState,paymentState};
