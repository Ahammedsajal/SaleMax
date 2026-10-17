'use strict';
const qr=require('./training-report-qr'),mail=require('./training-receipt-delivery');
const safeCode=(error,fallback)=>/^[A-Z0-9_]{1,100}$/.test(error?.code||'')?error.code:fallback;
const qrEnv=env=>({...env,SALEMAX_REPORT_WHATSAPP_TRANSPORT:'qr',SALEMAX_REPORT_WHATSAPP_ENABLED:env.SALEMAX_INVOICE_WHATSAPP_ENABLED||env.SALEMAX_REPORT_WHATSAPP_ENABLED});
function smtp(env){return mail.smtpConfig({...env,SALEMAX_TRAINING_EMAIL_FROM:env.SALEMAX_INVOICE_FROM||env.SALEMAX_TRAINING_EMAIL_FROM||env.SALEMAX_RECEIPT_FROM||env.SALEMAX_REPORT_FROM});}
async function readiness(db,tenantId,channel,{env=process.env,emailSend,whatsappSend}={}){
  if(channel==='email'&&emailSend||channel==='whatsapp'&&whatsappSend)return {ready:true,injected:true};
  if(env.LOCAL_ONLY_MODE==='true')return {ready:false,errorCode:'CUSTOMER_DELIVERY_LOCAL_ONLY'};
  try{if(channel==='email'){smtp(env);return {ready:true};}qr.config(qrEnv(env));if(!await qr.sender(db,tenantId))return {ready:false,errorCode:'CUSTOMER_QR_SENDER_UNAVAILABLE'};return {ready:true};}
  catch(error){return {ready:false,errorCode:safeCode(error,'CUSTOMER_CHANNEL_NOT_CONFIGURED')};}
}
function content(message){const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));return {...message,html:`<div style="font-family:Arial,sans-serif;color:#243348;max-width:660px;margin:auto;white-space:pre-wrap">${escape(message.text).replace(/https:\/\/[A-Za-z0-9.-]+(?::\d+)?\/customer-invoice#[A-Za-z0-9_-]{43}/g,url=>`<a href="${url}">${url}</a>`)}</div>`};}
async function send(db,{tenantId,channel,recipient,subject,text},{env=process.env,emailSend,whatsappSend,http=require('axios')}={}){
  if(env.LOCAL_ONLY_MODE==='true'&&!(channel==='email'?emailSend:whatsappSend))return {status:'blocked',errorCode:'CUSTOMER_DELIVERY_LOCAL_ONLY'};
  if(channel==='email'){
    let transport;try{
      const message=content({to:recipient,subject,text}),c=emailSend?null:smtp(env);
      if(!emailSend)transport=require('nodemailer').createTransport({host:c.host,port:c.port,secure:c.secure,requireTLS:!c.secure,auth:c.auth,tls:{minVersion:'TLSv1.2'},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000});
      const result=emailSend?await emailSend(message):await transport.sendMail({...message,from:c.from});
      if(result?.status&&['retry','failed','unknown','blocked'].includes(result.status))return result;
      if((result?.accepted||[]).some(x=>String(x).toLowerCase()===recipient.toLowerCase())&&result?.messageId)return {status:'accepted',providerMessageId:String(result.messageId).slice(0,191)};
      if((result?.rejected||[]).some(x=>String(x).toLowerCase()===recipient.toLowerCase()))return {status:'failed',errorCode:'CUSTOMER_EMAIL_REJECTED'};
      return {status:'unknown',errorCode:'CUSTOMER_EMAIL_ACCEPTANCE_UNCONFIRMED'};
    }catch(error){const code=Number(error?.responseCode);return {status:code>=400&&code<500?'retry':code>=500?'failed':['ECONNREFUSED','ENOTFOUND','EAI_AGAIN'].includes(error?.code)?'retry':'unknown',errorCode:safeCode(error,'CUSTOMER_EMAIL_OUTCOME_UNKNOWN')};}finally{transport?.close();}
  }
  try{
    let result;if(whatsappSend)result=await whatsappSend({tenantId,to:recipient,text});
    else{const c=qr.config(qrEnv(env)),sender=await qr.sender(db,tenantId);if(!sender)return {status:'blocked',errorCode:'CUSTOMER_QR_SENDER_UNAVAILABLE'};
      const response=await http.post(c.url,{...sender,to:recipient.slice(1),text},{headers:{'x-internal-secret':c.secret},timeout:20000});result=response?.data;
    }
    if(result?.status&&['retry','failed','unknown','blocked'].includes(result.status))return result;
    const id=result?.data?.messageId;if(result?.success===true&&id)return {status:'accepted',providerMessageId:String(id).slice(0,191)};
    return {status:'unknown',errorCode:'CUSTOMER_QR_ACCEPTANCE_UNCONFIRMED'};
  }catch(error){const status=Number(error?.response?.status),message=String(error?.response?.data?.msg||'');
    if(status===404||status===500&&message==='Session is not active for this instance')return {status:'blocked',errorCode:'CUSTOMER_QR_NOT_CONNECTED'};
    if(status===401||status===403)return {status:'blocked',errorCode:'CUSTOMER_QR_INTERNAL_AUTH_REQUIRED'};
    if(['ECONNREFUSED','ENOTFOUND','EAI_AGAIN'].includes(error?.code))return {status:'retry',errorCode:'CUSTOMER_QR_INTERNAL_UNAVAILABLE'};
    return {status:status>=400&&status<500?'failed':'unknown',errorCode:'CUSTOMER_QR_OUTCOME_UNCONFIRMED'};
  }
}
module.exports={smtp,readiness,content,send};
