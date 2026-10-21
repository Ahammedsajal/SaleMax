'use strict';
const crypto=require('node:crypto');
const grants=require('./training-document-grants');
const emailDelivery=require('./training-receipt-delivery');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const sha=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
function whatsappConfig(env=process.env){if(env.SALEMAX_RECEIPT_WHATSAPP_ENABLED!=='true')fail('RECEIPT_WHATSAPP_NOT_CONFIGURED');const template=String(env.SALEMAX_RECEIPT_WHATSAPP_TEMPLATE||'').trim(),language=String(env.SALEMAX_RECEIPT_WHATSAPP_LANGUAGE||'en_US').trim(),version=String(env.SALEMAX_META_GRAPH_VERSION||'v24.0').trim();if(!/^[a-z0-9_]{2,64}$/.test(template)||!/^[a-z]{2,3}_[A-Z]{2}$/.test(language)||!/^v\d+\.\d+$/.test(version))fail('RECEIPT_WHATSAPP_NOT_CONFIGURED');return {template,language,version};}
function content({type,number,url,from,to}){const kind=type==='receipt'?'payment receipt':'invoice';return {from,to,subject:`${kind==='invoice'?'Invoice':'Payment receipt'} ${number}`,text:`Your ${kind} ${number} is available here: ${url}\n\n7Network`,html:`<p>Your ${kind} <strong>${number.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</strong> is available here.</p><p><a href="${url}">Open ${kind}</a></p>`};}
async function deliver(db,ctx,{type,id,channel,requestKey,origin,env=process.env,http,sendMail},dependencies={}){
  if(!['invoice','receipt'].includes(type)||!['email','whatsapp'].includes(channel)||!uuid(id)||!uuid(requestKey))fail('INVALID_DOCUMENT_DELIVERY');
  const [[prior]]=await db.query('SELECT id,document_type,document_id,channel,status,provider_message_id,error_code FROM sx_training_document_deliveries WHERE tenant_id=? AND request_key=?',[ctx.tenant.id,requestKey]);
  if(prior){if(prior.document_type!==type||prior.document_id!==id||prior.channel!==channel)fail('IDEMPOTENCY_CONFLICT');return {id:prior.id,channel,status:prior.status,providerMessageId:prior.provider_message_id||null,errorCode:prior.error_code||null,repeated:true};}
  const [[rate]]=await db.query("SELECT COUNT(*) AS sends FROM sx_training_document_deliveries WHERE tenant_id=? AND document_type=? AND document_id=? AND channel=? AND created_at>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 HOUR)",[ctx.tenant.id,type,id,channel]);if(Number(rate?.sends)>=5)fail('DOCUMENT_DELIVERY_RATE_LIMIT');
  if(channel==='email')emailDelivery.config(env);else whatsappConfig(env);
  const grant=await (dependencies.issueGrant||grants.issue)(db,ctx,type,id,{origin,preserveExisting:true,channel});let recipient=channel==='email'?grant.recipientEmail:grant.recipientPhone;
  if(channel==='whatsapp'){recipient=require('./training-report-delivery').phone(recipient);if(!recipient)fail('DOCUMENT_PHONE_UNAVAILABLE');}
  if(!recipient)fail(channel==='email'?'DOCUMENT_EMAIL_UNAVAILABLE':'DOCUMENT_PHONE_UNAVAILABLE');
  const attemptId=crypto.randomUUID();
  try{await db.query("INSERT INTO sx_training_document_deliveries(id,tenant_id,document_type,document_id,request_key,channel,recipient_hash,status,created_by_identity_id) VALUES(?,?,?,?,?,?,?,'sending',?)",[attemptId,ctx.tenant.id,type,id,requestKey,channel,sha(String(recipient).trim().toLowerCase()),ctx.identity.id]);}
  catch(error){if(error.code==='ER_DUP_ENTRY')fail('DOCUMENT_DELIVERY_IN_PROGRESS');throw error;}
  let providerMessageId=null,status='failed',errorCode='DOCUMENT_DELIVERY_FAILED';
  try{
    if(channel==='email'){
      const config=emailDelivery.config(env);let transport,created=false;
      try{if(!sendMail){transport=require('nodemailer').createTransport({host:config.host,port:config.port,secure:config.secure,requireTLS:!config.secure,auth:config.auth,tls:{minVersion:'TLSv1.2'},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000});created=true;}const result=sendMail?await sendMail(content({type,number:grant.documentNumber,url:grant.url,from:config.from,to:recipient})):await transport.sendMail(content({type,number:grant.documentNumber,url:grant.url,from:config.from,to:recipient}));emailDelivery.accepted(result,recipient);providerMessageId=String(result.messageId||'').slice(0,191)||null;status='accepted';errorCode=null;}finally{if(created)transport.close();}
    }else{
      const config=whatsappConfig(env),provider=require('./training-report-delivery'),meta=await (dependencies.tenantMetaCredentials||provider.tenantMetaCredentials)(db,ctx.tenant.id);if(!meta)fail('RECEIPT_WHATSAPP_ACCOUNT_UNAVAILABLE');
      const response=await (http||require('axios')).post(`https://graph.facebook.com/${config.version}/${meta.phoneId}/messages`,{messaging_product:'whatsapp',to:String(recipient).replace(/^\+/,''),type:'template',template:{name:config.template,language:{code:config.language},components:[{type:'body',parameters:[{type:'text',text:grant.documentNumber},{type:'text',text:grant.url}]}]}},{headers:{Authorization:`Bearer ${meta.token}`},timeout:15000});
      providerMessageId=String(response?.data?.messages?.[0]?.id||'').slice(0,191)||null;if(!providerMessageId)throw Object.assign(new Error(),{code:'WHATSAPP_ACCEPTANCE_UNCONFIRMED'});status='accepted';errorCode=null;
    }
  }catch(error){const httpStatus=Number(error?.response?.status);if(['ECONNABORTED','ETIMEDOUT','ECONNRESET','ESOCKETTIMEDOUT','WHATSAPP_ACCEPTANCE_UNCONFIRMED'].includes(error?.code)||!httpStatus)status='unknown';errorCode=/^[A-Z0-9_]{1,64}$/.test(error?.code||'')?error.code:'DOCUMENT_DELIVERY_FAILED';}
  await db.query('UPDATE sx_training_document_deliveries SET status=?,provider_message_id=?,error_code=?,completed_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND status=\'sending\'',[status,providerMessageId,errorCode,ctx.tenant.id,attemptId]);
  await db.query("INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES(?,?,?,'identity',?,'customer-document',?,?,?)",[crypto.randomUUID(),ctx.tenant.id,ctx.identity.id,`training.document-${channel}-${status}`,id,JSON.stringify({documentType:type,channel,status,providerMessageId,errorCode}),requestKey]);
  return {id:attemptId,channel,status,providerMessageId,errorCode,repeated:false};
}
module.exports={whatsappConfig,content,deliver};
