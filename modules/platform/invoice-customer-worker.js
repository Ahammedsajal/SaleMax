'use strict';
const jobs=require('./invoice-customer-jobs'),state=require('./invoice-communication-state'),plan=require('./invoice-communication-plan');
const settings=require('./invoice-communications-settings'),access=require('./invoice-customer-access'),provider=require('./invoice-customer-provider');
const fail=code=>{throw Object.assign(Error(code),{code});};
const money=(minor,currency)=>new Intl.NumberFormat('en-QA',{style:'currency',currency:currency||'QAR'}).format(Number(minor)/100);
async function prepare(db,job,{workerId,now=new Date(),env=process.env,...adapters}={}){
  const at=jobs.clock(now);await db.beginTransaction();
  try{
    // Invoice edits, verification and settings changes use this same tenant lock.
    const [[tenant]]=await db.query("SELECT id FROM sx_tenants WHERE id=? AND status='active' FOR UPDATE",[job.tenant_id]);
    const [[currentJob]]=await db.query("SELECT id FROM sx_invoice_customer_jobs WHERE tenant_id=? AND id=? AND status='processing' AND lease_owner=? AND lease_expires_at>? FOR UPDATE",[job.tenant_id,job.id,workerId,at.utc]);if(!currentJob)fail('INVOICE_DELIVERY_LEASE_LOST');
    const entitlement=tenant?await require('./plans').loadEntitlements(db,job.tenant_id):null;
    if(!entitlement||!['active','trial','grace'].includes(entitlement.status)||entitlement.categoryKey!=='training_center'||!entitlement.capabilities?.includes('finance.invoices')){await db.commit();return {outcome:{status:'blocked',errorCode:'CUSTOMER_FINANCE_FEATURE_UNAVAILABLE'}};}
    const current=await jobs.config(db,job.tenant_id),record=tenant?await state.load(db,job.tenant_id,job.document_id):null;
    const proposed=record?(job.kind==='invoice'?plan.invoice(record.document,current):plan.reminders(record.document,current,at.today,record)):{jobs:[]};
    const selected=proposed.jobs.find(x=>x.idempotencyKey===job.idempotency_key&&jobs.hash(x.recipient)===job.recipient_hash);
    if(!selected){await db.commit();return {outcome:{status:'suppressed',errorCode:'INVOICE_OR_PAYMENT_STATE_CHANGED'}};}
    if(job.kind!=='invoice'&&at.time<current.localTime){await db.commit();return {outcome:{status:'blocked',errorCode:'CUSTOMER_REMINDER_NOT_YET_DUE'}};}
    const ready=await provider.readiness(db,job.tenant_id,job.channel,{env,...adapters});if(!ready.ready){await db.commit();return {outcome:{status:'blocked',errorCode:ready.errorCode}};}
    let link;try{link=await access.issue(db,job.tenant_id,record,{env,now});}catch(error){if(['REMINDER_LINK_KEY_UNAVAILABLE','CUSTOMER_INVOICE_ORIGIN_UNAVAILABLE'].includes(error.code)){await db.rollback();return {outcome:{status:'blocked',errorCode:error.code}};}throw error;}
    const d=record.document,values={customer_name:d.name,business_name:d.businessName,invoice_number:d.invoiceNumber,invoice_total:money(d.totalMinor,d.currency),amount_due:money(selected.amountMinor||d.outstandingMinor,d.currency),due_date:selected.dueDate||d.installments[0]?.dueDate||'',invoice_url:link.url,preferences_url:link.url};
    const message=settings.render(current,job.kind,d.language,values),redacted=message.text.split(link.url).join('[secure customer invoice link]'),attempt=Number(job.attempts)+1;
    await db.query(`UPDATE sx_invoice_customer_jobs SET attempts=?,send_started_at=?,settings_revision=?,subject_snapshot=?,body_snapshot=?,amount_minor=? WHERE tenant_id=? AND id=?`,[attempt,at.utc,current.revision,message.subject.split(link.url).join('[secure customer invoice link]'),redacted,selected.amountMinor||null,job.tenant_id,job.id]);
    await db.commit();return {message:{tenantId:job.tenant_id,channel:job.channel,recipient:selected.recipient,...message},attempt};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
async function tick(pool,{workerId=`invoice-customer-${process.pid}`,limit=10,now,env=process.env,...adapters}={}){
  jobs.worker(workerId);if(!Number.isSafeInteger(limit)||limit<1||limit>50)fail('INVALID_INVOICE_COMMUNICATION_LIMIT');
  if(env.SALEMAX_INVOICE_CUSTOMER_DELIVERY_ENABLED!=='true')return {scanned:0,queued:0,processed:0,accepted:0,externallySent:false};
  const time=()=>now===undefined?new Date():new Date(now);
  const scheduled=await jobs.scan(pool,{now:time(),limit:50}),outcomes=[];
  for(let i=0;i<limit;i++){
    let job,db=await pool.getConnection();try{job=await jobs.claim(db,{workerId,now:time()});}finally{db.release();}
    if(!job)break;if(job.recoveredUnknown||job.exhausted){outcomes.push({status:job.recoveredUnknown?'unknown':'failed'});continue;}
    let prepared;
    db=await pool.getConnection();try{prepared=await prepare(db,job,{workerId,now:time(),env,...adapters});}
    catch(error){if(error.code==='INVOICE_DELIVERY_LEASE_LOST')continue;prepared={outcome:{status:'failed',errorCode:/^[A-Z0-9_]{1,100}$/.test(error.code||'')?error.code:'CUSTOMER_MESSAGE_PREPARATION_FAILED'}};}
    finally{db.release();}
    let outcome=prepared.outcome;
    if(prepared.message){job.attempts=prepared.attempt;db=await pool.getConnection();try{outcome=await provider.send(db,prepared.message,{env,...adapters});}finally{db.release();}}
    db=await pool.getConnection();try{outcomes.push(await jobs.finish(db,{job,workerId,outcome,now:time()}));}finally{db.release();}
  }
  const accepted=outcomes.filter(x=>x.status==='accepted').length;
  return {...scheduled,processed:outcomes.length,accepted,blocked:outcomes.filter(x=>x.status==='blocked').length,unknown:outcomes.filter(x=>x.status==='unknown').length,externallySent:accepted>0&&!adapters.emailSend&&!adapters.whatsappSend};
}
module.exports={prepare,tick};
