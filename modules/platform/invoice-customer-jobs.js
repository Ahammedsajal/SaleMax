'use strict';
const crypto=require('node:crypto'),moment=require('moment-timezone');
const settings=require('./invoice-communications-settings'),plan=require('./invoice-communication-plan'),state=require('./invoice-communication-state');
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
function worker(value){if(typeof value!=='string'||!/^[A-Za-z0-9._:-]{3,100}$/.test(value))fail('INVALID_INVOICE_COMMUNICATION_WORKER');return value;}
function clock(now=new Date()){const time=moment.utc(now).tz('Asia/Qatar');if(!time.isValid())fail('INVALID_INVOICE_COMMUNICATION_DATE');return {today:time.format('YYYY-MM-DD'),time:time.format('HH:mm'),utc:time.clone().utc().format('YYYY-MM-DD HH:mm:ss.SSS'),local:time};}
async function config(db,tenantId){const [[row]]=await db.query('SELECT * FROM sx_invoice_customer_communications WHERE tenant_id=?',[tenantId]);return settings.shape(row);}
async function enqueue(db,tenantId,job,availableAt){
  const id=crypto.randomUUID();
  try{await db.query(`INSERT INTO sx_invoice_customer_jobs(id,tenant_id,document_id,document_revision,idempotency_key,kind,channel,recipient_hash,installment_id,sequence_number,scheduled_date,due_date,amount_minor,available_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,tenantId,job.documentId,job.documentRevision,job.idempotencyKey,job.kind,job.channel,hash(job.recipient),job.installmentId||null,job.sequence||null,job.scheduledDate||null,job.dueDate||null,job.amountMinor||null,availableAt]);return true;}
  catch(error){if(error.code==='ER_DUP_ENTRY')return false;throw error;}
}
// Caller holds the generator's tenant transaction. Tracking and jobs commit with
// the invoice, so a retried invoice request never creates a second send.
async function created(db,ctx,snapshot,{now=new Date()}={}){
  const tenantId=ctx.tenant.id,at=clock(now);
  await db.query('INSERT INTO sx_invoice_communication_documents(tenant_id,document_id,generated_document_id,created_by_identity_id) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE document_id=document_id',[tenantId,snapshot.id,snapshot.id,ctx.identity.id]);
  const current=await config(db,tenantId),delivery=plan.invoice(state.fromSnapshot(snapshot),current);let queued=0;
  for(const job of delivery.jobs)if(await enqueue(db,tenantId,job,at.utc))queued++;
  return {queued,missingRecipients:delivery.skipped};
}
async function changed(db,ctx,snapshot,{now=new Date()}={}){
  const [[tracked]]=await db.query('SELECT document_id FROM sx_invoice_communication_documents WHERE tenant_id=? AND document_id=? FOR UPDATE',[ctx.tenant.id,snapshot.id]);if(!tracked)return;
  await db.query("UPDATE sx_invoice_customer_jobs SET status='suppressed',error_code='DOCUMENT_REVISION_CHANGED',completed_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND document_id=? AND status IN ('queued','retry','blocked')",[ctx.tenant.id,snapshot.id]);
  await db.query('UPDATE sx_invoice_communication_documents SET next_scan_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND document_id=?',[ctx.tenant.id,snapshot.id]);
  if(!snapshot.deleted)await created(db,ctx,snapshot,{now});
}
async function issued(db,ctx,invoiceId,generatedDocumentId=null,{now=new Date()}={}){
  // Conversion of a tracked PDF keeps the same job identity and daily cadence.
  if(generatedDocumentId){const [[tracked]]=await db.query('SELECT document_id FROM sx_invoice_communication_documents WHERE tenant_id=? AND generated_document_id=?',[ctx.tenant.id,generatedDocumentId]);if(tracked)return {documentId:tracked.document_id,queued:0};}
  const record=await state.load(db,ctx.tenant.id,invoiceId);if(!record||!plan.active(record.document))fail('CUSTOMER_INVOICE_UNAVAILABLE');
  await db.query("INSERT INTO sx_invoice_communication_documents(tenant_id,document_id,document_type,formal_invoice_id,created_by_identity_id) VALUES(?,?,'formal',?,?) ON DUPLICATE KEY UPDATE document_id=document_id",[ctx.tenant.id,invoiceId,invoiceId,ctx.identity.id]);
  const current=await config(db,ctx.tenant.id),delivery=plan.invoice(record.document,current);let queued=0;
  for(const job of delivery.jobs)if(await enqueue(db,ctx.tenant.id,job,clock(now).utc))queued++;
  return {documentId:invoiceId,queued};
}
async function scan(pool,{now=new Date(),limit=50}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>200)fail('INVALID_INVOICE_COMMUNICATION_LIMIT');
  const at=clock(now);let scanned=0,queued=0,scanFailed=0;
  for(let i=0;i<limit;i++){
    const db=await pool.getConnection();let item,added=0;try{await db.beginTransaction();
      [[item]]=await db.query('SELECT tenant_id,document_id FROM sx_invoice_communication_documents WHERE next_scan_at<=? ORDER BY next_scan_at,tenant_id,document_id LIMIT 1 FOR UPDATE SKIP LOCKED',[at.utc]);if(!item){await db.commit();break;}
      const current=await config(db,item.tenant_id),record=await state.load(db,item.tenant_id,item.document_id);
      let next=at.local.clone().hour(Number(current.localTime.slice(0,2))).minute(Number(current.localTime.slice(3,5))).second(0).millisecond(0);
      if(at.time>=current.localTime){if(record){const planned=plan.reminders(record.document,current,at.today,record);for(const job of planned.jobs)if(await enqueue(db,item.tenant_id,job,at.utc))added++;}next.add(1,'day');}
      await db.query('UPDATE sx_invoice_communication_documents SET next_scan_at=?,scan_error_code=NULL WHERE tenant_id=? AND document_id=?',[next.utc().format('YYYY-MM-DD HH:mm:ss.SSS'),item.tenant_id,item.document_id]);
      await db.commit();scanned++;queued+=added;
     }catch(error){
      try{await db.rollback();}catch{}
      if(!item)throw error;
      const code=/^[A-Z0-9_]{1,100}$/.test(error.code||'')?error.code:'CUSTOMER_INVOICE_SCAN_FAILED';
      await db.query('UPDATE sx_invoice_communication_documents SET scan_error_code=?,next_scan_at=DATE_ADD(?,INTERVAL 300 SECOND) WHERE tenant_id=? AND document_id=? AND next_scan_at<=?',[code,at.utc,item.tenant_id,item.document_id,at.utc]);scanFailed++;
    }finally{db.release();}
  }
  return {scanned,queued,scanFailed};
}
async function claim(db,{workerId,now=new Date(),leaseSeconds=120}={}){
  worker(workerId);if(!Number.isSafeInteger(leaseSeconds)||leaseSeconds<60||leaseSeconds>300)fail('INVALID_INVOICE_COMMUNICATION_LEASE');const at=clock(now);
  await db.beginTransaction();try{
    const [[row]]=await db.query(`SELECT * FROM sx_invoice_customer_jobs WHERE
      (status IN ('queued','retry','blocked') AND available_at<=?) OR (status='processing' AND lease_expires_at<=?)
      ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,[at.utc,at.utc]);
    if(!row){await db.commit();return null;}
    if(row.status==='processing'&&row.send_started_at){await db.query("UPDATE sx_invoice_customer_jobs SET status='unknown',error_code='DELIVERY_WORKER_LOST_AFTER_SEND_STARTED',lease_owner=NULL,lease_expires_at=NULL,completed_at=? WHERE tenant_id=? AND id=?",[at.utc,row.tenant_id,row.id]);await db.commit();return {recoveredUnknown:true};}
    if(Number(row.attempts)>=8){await db.query("UPDATE sx_invoice_customer_jobs SET status='failed',error_code='DELIVERY_MAX_ATTEMPTS',completed_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE tenant_id=? AND id=?",[at.utc,row.tenant_id,row.id]);await db.commit();return {exhausted:true};}
    await db.query("UPDATE sx_invoice_customer_jobs SET status='processing',lease_owner=?,lease_expires_at=DATE_ADD(?,INTERVAL ? SECOND),send_started_at=NULL,error_code=NULL WHERE tenant_id=? AND id=?",[workerId,at.utc,leaseSeconds,row.tenant_id,row.id]);
    await db.commit();return row;
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
async function finish(db,{job,workerId,outcome,now=new Date()}={}){
  worker(workerId);if(!['accepted','failed','retry','blocked','unknown','suppressed'].includes(outcome?.status))fail('INVALID_INVOICE_DELIVERY_OUTCOME');
  const at=clock(now),delay=outcome.status==='blocked'?300:Math.min(3600,30*2**Math.min(Number(job.attempts||0),7));
  const [result]=await db.query(`UPDATE sx_invoice_customer_jobs SET status=?,provider_message_id=?,error_code=?,completed_at=CASE WHEN ? IN ('accepted','failed','unknown','suppressed') THEN ? ELSE NULL END,
    attempts=CASE WHEN ?='blocked' AND send_started_at IS NOT NULL THEN GREATEST(attempts-1,0) ELSE attempts END,available_at=DATE_ADD(?,INTERVAL ? SECOND),lease_owner=NULL,lease_expires_at=NULL WHERE tenant_id=? AND id=? AND status='processing' AND lease_owner=? AND lease_expires_at>?`,[outcome.status,outcome.providerMessageId||null,outcome.errorCode||null,outcome.status,at.utc,outcome.status,at.utc,delay,job.tenant_id,job.id,workerId,at.utc]);
  if(result.affectedRows!==1)fail('INVOICE_DELIVERY_LEASE_LOST');return outcome;
}
async function history(db,tenantId,documentId){const [rows]=await db.query(`SELECT id,kind,channel,status,sequence_number AS sequence,scheduled_date AS scheduledDate,amount_minor AS amountMinor,attempts,provider_message_id AS providerMessageId,error_code AS errorCode,subject_snapshot AS subject,body_snapshot AS message,created_at AS createdAt,completed_at AS completedAt FROM sx_invoice_customer_jobs WHERE tenant_id=? AND document_id=? ORDER BY created_at DESC,id DESC LIMIT 100`,[tenantId,documentId]);return rows;}
async function info(db,tenantId,documentId,{env=process.env}={}){
  const current=await config(db,tenantId),record=await state.load(db,tenantId,documentId);
  const [[tracked]]=await db.query('SELECT scan_error_code FROM sx_invoice_communication_documents WHERE tenant_id=? AND document_id=?',[tenantId,documentId]);
  return {tracked:Boolean(tracked),sendingActive:env.SALEMAX_INVOICE_CUSTOMER_DELIVERY_ENABLED==='true',scanErrorCode:tracked?.scan_error_code||null,missingRecipients:record?plan.invoice(record.document,current).skipped:[],items:await history(db,tenantId,documentId)};
}
async function invoiceDocumentId(db,tenantId,invoiceId){
  const [[row]]=await db.query('SELECT cd.document_id FROM sx_invoice_communication_documents cd LEFT JOIN sx_training_generated_invoice_links l ON l.tenant_id=cd.tenant_id AND l.generated_document_id=cd.generated_document_id WHERE cd.tenant_id=? AND (cd.formal_invoice_id=? OR l.invoice_id=?) LIMIT 1',[tenantId,invoiceId,invoiceId]);return row?.document_id||invoiceId;
}
module.exports={hash,worker,clock,config,enqueue,created,changed,issued,scan,claim,finish,history,info,invoiceDocumentId};
