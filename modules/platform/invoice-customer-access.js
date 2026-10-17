'use strict';
const crypto=require('node:crypto'),seals=require('./training-reminder-preferences');
const state=require('./invoice-communication-state'),plan=require('./invoice-communication-plan');
const fail=()=>{throw Object.assign(Error('CUSTOMER_INVOICE_LINK_UNAVAILABLE'),{code:'CUSTOMER_INVOICE_LINK_UNAVAILABLE',status:404});};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const snapshotHash=snapshot=>crypto.createHash('sha256').update(JSON.stringify(canonical(snapshot))).digest('hex');
function origin(env=process.env){const url=new URL(env.SALEMAX_PUBLIC_BASE_URL||'https://crm.salemax.qa');if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Object.assign(Error('CUSTOMER_INVOICE_ORIGIN_UNAVAILABLE'),{code:'CUSTOMER_INVOICE_ORIGIN_UNAVAILABLE'});return url.origin;}
async function issue(db,tenantId,record,{env=process.env,now=new Date()}={}){
  const d=record.document;if(!plan.active(d))fail();
  const [[existing]]=await db.query('SELECT * FROM sx_invoice_customer_access WHERE tenant_id=? AND document_id=? AND document_revision=? AND expires_at>? FOR UPDATE',[tenantId,d.id,d.revision,now]);
  const digest=snapshotHash(d.snapshot);let token;
  if(existing&&existing.snapshot_hash===digest)token=seals.decryptToken(existing,env);
  else{token=crypto.randomBytes(32).toString('base64url');const sealed=seals.encryptToken(token,env),expires=new Date(new Date(now).getTime()+7*86400000);
    await db.query(`INSERT INTO sx_invoice_customer_access(tenant_id,document_id,document_revision,token_hash,token_ciphertext,token_iv,token_tag,snapshot_hash,expires_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE token_hash=VALUES(token_hash),token_ciphertext=VALUES(token_ciphertext),token_iv=VALUES(token_iv),token_tag=VALUES(token_tag),snapshot_hash=VALUES(snapshot_hash),expires_at=VALUES(expires_at)`,[tenantId,d.id,d.revision,sealed.tokenHash,sealed.ciphertext,sealed.iv,sealed.tag,digest,expires]);
  }
  return {url:origin(env)+'/customer-invoice#'+token};
}
async function resolve(db,token,{now=new Date()}={}){
  let hash;try{hash=seals.tokenHash(token);}catch{fail();}
  const [[grant]]=await db.query('SELECT tenant_id,document_id,document_revision,snapshot_hash FROM sx_invoice_customer_access WHERE token_hash=? AND expires_at>?',[hash,now]);if(!grant)fail();
  const record=await state.load(db,grant.tenant_id,grant.document_id),d=record?.document;
  if(!d||!plan.active(d)||d.revision!==Number(grant.document_revision)||snapshotHash(d.snapshot)!==grant.snapshot_hash)fail();
  return {grant,record};
}
function view(record){
  const d=record.document,s=d.snapshot;
  return {number:d.invoiceNumber,formalInvoiceNumber:d.formalInvoiceNumber||null,issuedAt:s.issuedAt,currency:d.currency,customerName:d.name,
    business:{name:s.businessProfile?.nameEn||s.companyName||s.legalName||'',nameAr:s.businessProfile?.nameAr||'',legalName:s.legalName||'',crNumber:s.crNumber||s.legalRegistrationNumber||'',address:s.legalAddress||'',logoUrl:s.businessProfile?.logoUrl||''},
    lines:(s.lines||[]).map(x=>({descriptionEn:x.descriptionEn,descriptionAr:x.descriptionAr,quantity:x.quantity,unitAmountMinor:String(x.unitAmountMinor),discountMinor:String(x.discountMinor||0),totalMinor:String(x.totalMinor)})),
    totalMinor:d.totalMinor,outstandingMinor:d.outstandingMinor,installments:record.terms.map(x=>({sequence:x.sequence,dueDate:x.dueDate,amountMinor:x.amountMinor,paidMinor:x.paidMinor,creditedMinor:x.creditedMinor,outstandingMinor:x.openMinor,cancelled:Boolean(x.cancelled)})),receipts:record.receipts,remindersEnabled:!d.optedOut,footer:s.footer||''};
}
async function preferences(db,token,enabled,{now=new Date()}={}){
  if(typeof enabled!=='boolean')throw Object.assign(Error('INVALID_REMINDER_PREFERENCE'),{code:'INVALID_REMINDER_PREFERENCE',status:400});
  const {grant}=await resolve(db,token,{now});
  await db.beginTransaction();try{
    const [[tenant]]=await db.query("SELECT id FROM sx_tenants WHERE id=? AND status='active' FOR UPDATE",[grant.tenant_id]);if(!tenant)fail();
    const {record}=await resolve(db,token,{now}),d=record.document;
    await db.query('UPDATE sx_invoice_communication_documents SET reminders_opted_out=?,next_scan_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND document_id=?',[enabled?0:1,grant.tenant_id,grant.document_id]);
    if(d.formalInvoiceId)await db.query(`UPDATE sx_training_reminder_preferences SET status=?,consent_version=?,consented_at=IF(?,UTC_TIMESTAMP(3),NULL),opted_out_at=IF(?,NULL,UTC_TIMESTAMP(3)) WHERE tenant_id=? AND invoice_id=?`,[enabled?'opted_in':'opted_out',enabled?'installment-reminders-v1':null,enabled?1:0,enabled?1:0,grant.tenant_id,d.formalInvoiceId]);
    if(!enabled)await db.query("UPDATE sx_invoice_customer_jobs SET status='suppressed',error_code='CUSTOMER_OPTED_OUT',completed_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND document_id=? AND kind<>'invoice' AND status IN ('queued','retry','blocked')",[grant.tenant_id,grant.document_id]);
    await db.query("INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES(?,?,NULL,'system','invoice.customer-reminder-preference','generated-invoice',?,?,?)",[crypto.randomUUID(),grant.tenant_id,grant.document_id,JSON.stringify({enabled}),crypto.randomUUID()]);
    await db.commit();return {remindersEnabled:enabled};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
module.exports={snapshotHash,origin,issue,resolve,view,preferences};
