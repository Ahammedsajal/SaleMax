'use strict';
const crypto=require('node:crypto');
const delivery=require('./training-report-delivery');
const fail=code=>{throw Object.assign(new Error(code),{code});};
function validWorker(workerId,limit,leaseSeconds){if(typeof workerId!=='string'||!/^[A-Za-z0-9._:-]{3,100}$/.test(workerId)||!Number.isSafeInteger(limit)||limit<1||limit>25||!Number.isSafeInteger(leaseSeconds)||leaseSeconds<15||leaseSeconds>300)fail('INVALID_REPORT_WORKER');}
function object(value){try{return typeof value==='string'?JSON.parse(value):value||{};}catch{fail('REPORT_SNAPSHOT_INVALID');}}
function dateText(value){return String(value||'').slice(0,10);}
function emailContent(snapshot,{to}){
  const values=snapshot.summary||{},facts=[['New leads',values.leadsCreated],['Leads touched',values.leadsTouched],['Follow-ups due',values.followUpsDue],['Overdue follow-ups',values.followUpsOverdue]].filter(([,value])=>value!==undefined);
  if(snapshot.finance){const finance=snapshot.finance;for(const [name,key] of [['Billed','billedMinor'],['Collected','collectedMinor'],['Credited','creditedMinor'],['Outstanding','outstandingMinor']])if(finance[key]!==undefined)facts.push([name,`${(Number(finance[key])/100).toFixed(2)} ${finance.currency||'QAR'}`]);}
  const rows=facts.map(([name,value])=>`${name}: ${String(value)}`);const range=`${dateText(snapshot.from)} – ${dateText(snapshot.to)}`;const text=`SaleMaX ${snapshot.period||'scheduled'} summary\n${range}\nActivities: ${Number(snapshot.activityCount)||0}\n${rows.join('\n')||'No activity recorded.'}\n\nThis summary contains workspace totals only; customer details are excluded.`;
  const htmlEscape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return {to,subject:`SaleMaX ${snapshot.period||'scheduled'} report · ${range}`,text,html:`<div style="font-family:Arial,sans-serif;color:#17212f;max-width:600px;margin:auto"><h2 style="color:#a8003b">SaleMaX ${htmlEscape(snapshot.period||'scheduled')} summary</h2><p>${htmlEscape(range)}</p><p>Activities: ${Number(snapshot.activityCount)||0}</p><ul>${facts.map(([name,value])=>`<li><strong>${htmlEscape(name)}:</strong> ${htmlEscape(value)}</li>`).join('')||'<li>No activity recorded.</li>'}</ul><p>This summary contains workspace totals only; customer details are excluded.</p></div>`};
}
function whatsappParameters(snapshot){const values=snapshot.summary||{};return [String(snapshot.period||'scheduled'),`${dateText(snapshot.from)} - ${dateText(snapshot.to)}`,`Activities: ${Number(snapshot.activityCount)||0}; new leads: ${Number(values.leadsCreated)||0}; follow-ups due: ${Number(values.followUpsDue)||0}`];}
async function sendEmail(message,{env=process.env,transport,sendEmail}={}){
  const config=delivery.emailConfig(env);let created=null;try{if(sendEmail){const result=await sendEmail({...message,from:config.from});const accepted=result?.accepted===true||(Array.isArray(result?.accepted)&&result.accepted.some(address=>String(address).toLowerCase()===message.to.toLowerCase()));if(accepted)return {status:'accepted',providerMessageId:String(result.providerMessageId||'').slice(0,191)||null};if(['failed','retry','unknown'].includes(result?.status))return {status:result.status,errorCode:result.errorCode||null};return {status:'unknown',errorCode:'REPORT_EMAIL_ACCEPTANCE_UNCONFIRMED'};}if(!transport)created=require('nodemailer').createTransport({host:config.host,port:config.port,secure:config.secure,requireTLS:!config.secure,auth:config.auth,tls:{minVersion:'TLSv1.2'},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000});const result=await (transport||created).sendMail({...message,from:config.from});const accepted=(result?.accepted||[]).some(address=>String(address).toLowerCase()===message.to.toLowerCase());if(accepted)return {status:'accepted',providerMessageId:String(result.messageId||'').slice(0,191)||null};if((result?.rejected||[]).some(address=>String(address).toLowerCase()===message.to.toLowerCase()))return {status:'failed',errorCode:'REPORT_EMAIL_REJECTED'};return {status:'unknown',errorCode:'REPORT_EMAIL_ACCEPTANCE_UNCONFIRMED'};}
  catch(error){const responseCode=Number(error?.responseCode);if(responseCode>=400&&responseCode<500)return {status:'retry',errorCode:'REPORT_EMAIL_TEMPORARY_REJECTION'};if(responseCode>=500)return {status:'failed',errorCode:'REPORT_EMAIL_REJECTED'};return {status:'unknown',errorCode:'REPORT_EMAIL_OUTCOME_UNKNOWN'};}
  finally{created?.close();}
}
async function sendWhatsapp(db,{tenantId,to,snapshot,env=process.env,http=require('axios'),sendWhatsapp:injected}={}){
  let config;try{config=delivery.whatsappConfig(env,'delivery');}catch(error){return {status:'failed',errorCode:error.code||'REPORT_WHATSAPP_NOT_CONFIGURED'};}
  let credentials;try{credentials=await delivery.tenantMetaCredentials(db,tenantId);}catch{return {status:'retry',errorCode:'REPORT_WHATSAPP_ACCOUNT_LOOKUP_FAILED'};}if(!credentials)return {status:'failed',errorCode:'REPORT_WHATSAPP_ACCOUNT_UNAVAILABLE'};
  const parameters=whatsappParameters(snapshot),message={messaging_product:'whatsapp',to:String(to).replace(/^\+/,''),type:'template',template:{name:config.template,language:{code:config.language},components:[{type:'body',parameters:parameters.map(text=>({type:'text',text}))}]}};
  try{const response=injected?await injected({tenantId,to,snapshot,config,message}):await http.post(`https://graph.facebook.com/${config.version}/${credentials.phoneId}/messages`,message,{headers:{Authorization:`Bearer ${credentials.token}`},timeout:15000});const id=(response?.data?.messages?.[0]?.id||response?.providerMessageId||'').toString();return (id||response?.accepted)?{status:'accepted',providerMessageId:id.slice(0,191)||null}:{status:'unknown',errorCode:'REPORT_WHATSAPP_ACCEPTANCE_UNCONFIRMED'};}
  catch(error){const status=Number(error?.response?.status);if(status===429)return {status:'retry',errorCode:'REPORT_WHATSAPP_RATE_LIMITED'};if(status>=400&&status<500)return {status:'failed',errorCode:'REPORT_WHATSAPP_REJECTED'};return {status:'unknown',errorCode:'REPORT_WHATSAPP_OUTCOME_UNKNOWN'};}
}
async function claim(db,{workerId,limit=10,leaseSeconds=90,ready={email:true,whatsapp:true}}={}){
  validWorker(workerId,limit,leaseSeconds);await db.beginTransaction();try{
    const [rows]=await db.query(`SELECT d.id,d.tenant_id,d.report_run_id,d.schedule_revision,d.channel,d.status,d.attempts,
      r.snapshot_json,r.schedule_id,s.revision AS current_revision,s.status AS schedule_status,
      s.email_enabled,s.email_destination,s.email_verified_at,s.whatsapp_enabled,s.whatsapp_destination,s.whatsapp_verified_at
      FROM sx_training_report_deliveries d JOIN sx_training_report_runs r ON r.tenant_id=d.tenant_id AND r.id=d.report_run_id
      LEFT JOIN sx_training_report_schedules s ON s.tenant_id=r.tenant_id AND s.id=r.schedule_id
      WHERE ((d.status IN ('queued','retry') AND d.available_at<=UTC_TIMESTAMP(3)) OR (d.status='processing' AND d.lease_expires_at<=UTC_TIMESTAMP(3)))
      ORDER BY d.available_at,d.created_at,d.id LIMIT ? FOR UPDATE SKIP LOCKED`,[limit]);const items=[];
    for(const row of rows){
      if(row.status==='processing'){await db.query("UPDATE sx_training_report_deliveries SET status='unknown',lease_owner=NULL,lease_expires_at=NULL,last_error_code='REPORT_DELIVERY_WORKER_LOST',updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?",[row.tenant_id,row.id]);continue;}
      const enabled=Number(row[row.channel+'_enabled'])===1,verified=Boolean(row[row.channel+'_verified_at']),recipient=row.channel==='email'?delivery.email(row.email_destination):delivery.phone(row.whatsapp_destination);
      if(!row.schedule_id||row.schedule_status!=='active'||Number(row.current_revision)!==Number(row.schedule_revision)||!enabled||!verified||!recipient){await db.query("UPDATE sx_training_report_deliveries SET status='suppressed',last_error_code='REPORT_SCHEDULE_CHANGED',updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?",[row.tenant_id,row.id]);continue;}
      if(!ready[row.channel])continue;if(Number(row.attempts)>=5){await db.query("UPDATE sx_training_report_deliveries SET status='failed',last_error_code='REPORT_DELIVERY_MAX_ATTEMPTS',updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?",[row.tenant_id,row.id]);continue;}
      const attempt=Number(row.attempts)+1;await db.query("UPDATE sx_training_report_deliveries SET status='processing',attempts=?,lease_owner=?,lease_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),last_error_code=NULL,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?",[attempt,workerId,leaseSeconds,row.tenant_id,row.id]);items.push({id:row.id,tenantId:row.tenant_id,runId:row.report_run_id,scheduleId:row.schedule_id,revision:Number(row.schedule_revision),channel:row.channel,attempt,destination:recipient,snapshot:object(row.snapshot_json)});
    }
    await db.commit();return items;
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
async function finish(db,{item,workerId,outcome}){
  const allowed=['accepted','failed','retry','unknown'];let status=allowed.includes(outcome?.status)?outcome.status:'unknown';if(status==='retry'&&item.attempt>=5)status='failed';const delay=Math.min(3600,30*2**Math.min(item.attempt-1,6));const code=/^[A-Z0-9_]{2,100}$/.test(outcome?.errorCode||'')?outcome.errorCode:null;
  const [result]=await db.query(`UPDATE sx_training_report_deliveries SET status=?,available_at=IF(?='retry',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),available_at),lease_owner=NULL,lease_expires_at=NULL,provider_message_id=?,last_error_code=?,accepted_at=IF(?='accepted',UTC_TIMESTAMP(3),NULL),updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND status='processing' AND lease_owner=?`,[status,status,delay,outcome?.providerMessageId||null,code,status,item.tenantId,item.id,workerId]);if(result?.affectedRows!==1)fail('REPORT_DELIVERY_LEASE_LOST');return {id:item.id,channel:item.channel,status,errorCode:code};
}
async function tick(pool,{workerId=`report-delivery-${process.pid}`,limit=10,env=process.env,sendEmail:emailAdapter,sendWhatsapp:whatsappAdapter,http}={}){
  if(env.SALEMAX_REPORT_DELIVERY_ENABLED!=='true')return {claimed:0,accepted:0,failed:0,retrying:0,unknown:0,externalWrites:false};
  const probe=await pool.getConnection();let ready;try{let whatsappReady=false;try{delivery.whatsappConfig(env,'delivery');whatsappReady=true;}catch{}let emailReady=false;try{delivery.emailConfig(env);emailReady=true;}catch{}ready={email:emailReady,whatsapp:whatsappReady};}
  finally{probe.release();}
  const db=await pool.getConnection();let items;try{items=await claim(db,{workerId,limit,ready});}finally{db.release();}const outcomes=[];
  for(const item of items){let outcome;if(item.channel==='email')outcome=await sendEmail(emailContent(item.snapshot,{to:item.destination}),{env,sendEmail:emailAdapter});else{const c=await pool.getConnection();try{outcome=await sendWhatsapp(c,{tenantId:item.tenantId,to:item.destination,snapshot:item.snapshot,env,http,sendWhatsapp:whatsappAdapter});}finally{c.release();}}
    const complete=await pool.getConnection();try{outcomes.push(await finish(complete,{item,workerId,outcome}));}finally{complete.release();}}
  return {claimed:items.length,accepted:outcomes.filter(x=>x.status==='accepted').length,failed:outcomes.filter(x=>x.status==='failed').length,retrying:outcomes.filter(x=>x.status==='retry').length,unknown:outcomes.filter(x=>x.status==='unknown').length,externalWrites:outcomes.length>0,externallySent:outcomes.some(x=>x.status==='accepted')};
}
module.exports={emailContent,whatsappParameters,sendEmail,sendWhatsapp,claim,finish,tick};
