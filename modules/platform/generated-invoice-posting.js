'use strict';
const crypto=require('node:crypto');
const generator=require('./invoice-generator');
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
const uuid=()=>crypto.randomUUID();
const decode=value=>typeof value==='string'?JSON.parse(value):value;
function snapshotInput(document){
 let s;try{s=decode(document.snapshot);}catch{fail('GENERATED_INVOICE_DATA_INVALID');}
 if(!s||s.currency!=='QAR'||!Array.isArray(s.lines)||!s.lines.length||s.lines.length>10||Number(s.taxMinor||0)!==0)fail('GENERATED_INVOICE_DATA_INVALID');
 let total=0;
 for(const l of s.lines){if(!/^[0-9a-f-]{36}$/i.test(l.courseId||'')||!Number.isSafeInteger(l.offerVersion)||l.offerVersion<1||l.quantity!==1||![l.unitAmountMinor,l.discountMinor,l.totalMinor].every(v=>Number.isSafeInteger(v)&&v>=0)||l.unitAmountMinor-l.discountMinor!==l.totalMinor||Number(l.taxMinor||0)!==0)fail('GENERATED_INVOICE_DATA_INVALID');total+=l.totalMinor;}
 if(!Number.isSafeInteger(total)||total<1||total!==Number(document.amount_minor)||total!==Number(s.totalMinor))fail('GENERATED_INVOICE_DATA_INVALID');
 generator.scheduleFor(total,null,s.installments);
 if(typeof s.customer?.name!=='string'||!s.customer.name.trim()||!s.legalName||!document.invoice_number||!Number.isFinite(Date.parse(s.issuedAt)))fail('GENERATED_INVOICE_DATA_INVALID');
 return s;
}
async function post(db,ctx,{uid,documentId}){
 generator.requireRole(ctx,true);
 if(typeof uid!=='string'||!uid||typeof documentId!=='string'||!/^[0-9a-f-]{36}$/i.test(documentId))fail('INVALID_GENERATED_INVOICE',400);
 await db.beginTransaction();
 try{
  const [[tenant]]=await db.query("SELECT id FROM sx_tenants WHERE id=? AND status='active' FOR UPDATE",[ctx.tenant.id]);if(!tenant)fail('BUSINESS_INACTIVE');
  const [[doc]]=await db.query('SELECT d.* FROM sx_invoice_generator_documents d LEFT JOIN sx_invoice_generator_document_state st ON st.tenant_id=d.tenant_id AND st.document_id=d.id WHERE d.tenant_id=? AND d.id=? AND st.deleted_at IS NULL FOR UPDATE',[ctx.tenant.id,documentId]);if(!doc)fail('INVOICE_NOT_FOUND',404);
  const [[link]]=await db.query('SELECT l.invoice_id,i.invoice_number FROM sx_training_generated_invoice_links l JOIN sx_training_invoices i ON i.tenant_id=l.tenant_id AND i.id=l.invoice_id WHERE l.tenant_id=? AND l.generated_document_id=?',[ctx.tenant.id,documentId]);
  if(link){await db.commit();return {invoiceId:link.invoice_id,invoiceNumber:link.invoice_number,repeated:true};}
  const [[replaced]]=await db.query('SELECT replacement_invoice_id FROM sx_invoice_generator_replacements WHERE tenant_id=? AND prior_invoice_id=?',[ctx.tenant.id,documentId]);if(replaced)fail('GENERATED_INVOICE_REPLACED');
  const s=snapshotInput(doc),offers=[];
  // Historical invoice prices remain authoritative even when today's course price changes.
  for(const line of s.lines){const [[offer]]=await db.query('SELECT id FROM sx_training_offers WHERE tenant_id=? AND course_id=? AND version=? LIMIT 1',[ctx.tenant.id,line.courseId,line.offerVersion]);if(!offer)fail('GENERATED_INVOICE_DATA_INVALID');offers.push(offer.id);}
  const [[collision]]=await db.query('SELECT id FROM sx_training_invoices WHERE tenant_id=? AND invoice_number=?',[ctx.tenant.id,doc.invoice_number]);if(collision)fail('INVOICE_NUMBER_CONFLICT');
  let leadId=null;
  const owner=await require('./invoice-customers').owner(db,ctx.tenant.id);uid=owner.uid;
  const uidHash=crypto.createHash('sha256').update(uid).digest('hex');
  if(doc.customer_type==='lead'){const [[lead]]=await db.query('SELECT id FROM pipeline_leads WHERE uid_hash=? AND uid=? AND id=?',[uidHash,uid,doc.customer_id]);if(!lead)fail('CUSTOMER_NOT_FOUND',404);leadId=lead.id;}
  const enrollmentId=uuid(),invoiceId=uuid(),first=s.lines[0],issuedAt=new Date(s.issuedAt);
  await db.query(`INSERT INTO sx_training_enrollments(id,tenant_id,sale_review_id,legacy_uid_hash,legacy_uid,lead_id,course_id,offer_id,offer_version,batch_id,status,learner_name,payer_name,payer_email,payer_phone,created_by_identity_id) VALUES (?,?,NULL,?,?,?,?,?,?,NULL,'requested',?,?,?,?,?)`,[enrollmentId,ctx.tenant.id,uidHash,uid,leadId,first.courseId,offers[0],first.offerVersion,s.customer.name,s.customer.name,s.customer.email||null,s.customer.phone||null,ctx.identity.id]);
  await db.query(`INSERT INTO sx_training_invoices(id,tenant_id,enrollment_id,sale_review_id,conversion_key,invoice_number,status,currency,legal_name_snapshot,legal_registration_snapshot,legal_address_snapshot,finance_policy_id,finance_policy_version,finance_policy_approved_by_identity_id,invoice_prefix_snapshot,tax_mode_snapshot,tax_rate_bps_snapshot,revenue_method_snapshot,issued_by_identity_id,issued_at,subtotal_minor,tax_minor,total_minor,invoice_email,terms_snapshot) VALUES (?,?,?,NULL,?,?,'issued','QAR',?,?,?,NULL,NULL,NULL,?,'no_tax',NULL,'deferred_until_delivery',?,?,?,0,?,?,?)`,[invoiceId,ctx.tenant.id,enrollmentId,documentId,doc.invoice_number,s.legalName,s.legalRegistrationNumber||s.crNumber||null,s.legalAddress||null,s.invoicePrefix||'INV',ctx.identity.id,issuedAt,s.totalMinor,s.totalMinor,s.customer.email||'',s.footer||'']);
  for(let index=0;index<s.lines.length;index++){const l=s.lines[index];await db.query(`INSERT INTO sx_training_invoice_lines(id,tenant_id,invoice_id,line_number,description_en,description_ar,course_id,offer_id,offer_version,quantity,unit_amount_minor,discount_minor,contract_amount_minor,taxable_base_minor,tax_minor,total_minor) VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?,?,0,?)`,[uuid(),ctx.tenant.id,invoiceId,index+1,l.descriptionEn||doc.course_name,l.descriptionAr||l.descriptionEn||doc.course_name,l.courseId,offers[index],l.offerVersion,l.unitAmountMinor,l.discountMinor,l.totalMinor,l.totalMinor,l.totalMinor]);}
  for(let index=0;index<s.installments.length;index++){const p=s.installments[index];await db.query('INSERT INTO sx_training_installments(id,tenant_id,invoice_id,sequence_number,due_date,amount_minor) VALUES (?,?,?,?,?,?)',[uuid(),ctx.tenant.id,invoiceId,index+1,p.dueDate,p.amountMinor]);}
  const journal=uuid();await db.query("INSERT INTO sx_training_journal_entries(id,tenant_id,source_type,source_id,entry_type,currency,occurred_at,created_by_identity_id) VALUES (?,?,'invoice',?,'invoice_issued','QAR',?,?)",[journal,ctx.tenant.id,invoiceId,issuedAt,ctx.identity.id]);
  for(const [number,account,debit,credit] of [[1,'accounts_receivable',s.totalMinor,0],[2,'deferred_revenue',0,s.totalMinor]])await db.query('INSERT INTO sx_training_journal_lines(tenant_id,entry_id,line_number,account_code,debit_minor,credit_minor) VALUES (?,?,?,?,?,?)',[ctx.tenant.id,journal,number,account,debit,credit]);
  await db.query('INSERT INTO sx_training_generated_invoice_links(tenant_id,generated_document_id,sale_review_id,invoice_id,linked_by_identity_id) VALUES (?,?,NULL,?,?)',[ctx.tenant.id,documentId,invoiceId,ctx.identity.id]);
  await db.query("INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','training.generated-invoice-posted','invoice',?,?,?)",[uuid(),ctx.tenant.id,ctx.identity.id,invoiceId,JSON.stringify({generatedDocumentId:documentId,invoiceNumber:doc.invoice_number,totalMinor:s.totalMinor,actorRole:ctx.membership.role,saleApprovalRequired:false}),documentId]);
  const serial=/^(.*)-(\d{4})-(\d+)$/.exec(doc.invoice_number);
  if(serial&&Number.isSafeInteger(Number(serial[3])))await db.query('INSERT INTO sx_training_number_sequences(tenant_id,prefix,period_year,last_value) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE last_value=GREATEST(last_value,VALUES(last_value))',[ctx.tenant.id,serial[1],Number(serial[2]),Number(serial[3])]);
  await db.commit();return {invoiceId,invoiceNumber:doc.invoice_number,repeated:false};
 }catch(e){await db.rollback();throw e;}
}
module.exports={post,snapshotInput};
