'use strict';
const crypto=require('node:crypto');
function config(env=process.env){
  if(env.SALEMAX_REPORT_WHATSAPP_ENABLED!=='true'||env.SALEMAX_REPORT_WHATSAPP_TRANSPORT!=='qr'||env.LOCAL_ONLY_MODE==='true')throw Object.assign(Error('REPORT_QR_DISABLED'),{code:'REPORT_QR_DISABLED'});
  const secret=String(env.CRM_INTERNAL_SECRET||''),port=Number(env.PORT||3010);
  if(!secret||!Number.isSafeInteger(port)||port<1||port>65535)throw Object.assign(Error('REPORT_QR_NOT_CONFIGURED'),{code:'REPORT_QR_NOT_CONFIGURED'});
  const origin=new URL(env.SALEMAX_REPORT_QR_INTERNAL_ORIGIN||`http://127.0.0.1:${port}`);
  if(origin.protocol!=='http:'||!['127.0.0.1','localhost','app'].includes(origin.hostname)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Object.assign(Error('REPORT_QR_NOT_CONFIGURED'),{code:'REPORT_QR_NOT_CONFIGURED'});
  return {secret,url:origin.origin+'/api/internal/qr/send-text'};
}
async function sender(db,tenantId){
  const [rows]=await db.query(`SELECT u.uid,o.legacy_uid_hash,n.number FROM sx_legacy_ownership o
    JOIN sx_tenants t ON t.id=o.tenant_id AND t.status='active'
    JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id AND m.role='owner' AND m.status='active'
    JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
    JOIN user u ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
    JOIN instance n ON n.uid=u.uid AND n.status='ACTIVE' WHERE o.tenant_id=? LIMIT 2`,[tenantId]);
  if(rows.length!==1||rows[0].legacy_uid_hash!==crypto.createHash('sha256').update(rows[0].uid).digest('hex'))return null;
  return {uid:rows[0].uid,from:rows[0].number};
}
async function send(db,{tenantId,to,text,snapshot,env=process.env,http=require('axios')}){
  let c,from;try{c=config(env);from=await sender(db,tenantId);}catch{return {status:'failed',errorCode:'REPORT_QR_NOT_CONFIGURED'};}
  if(!from)return {status:'failed',errorCode:'REPORT_QR_SENDER_UNAVAILABLE'};
  if(!/^\+[1-9]\d{7,14}$/.test(String(to)))return {status:'failed',errorCode:'INVALID_REPORT_WHATSAPP'};
  // Recheck the recipient immediately before crossing the provider boundary.
  const [[recipient]]=await db.query("SELECT id FROM sx_training_report_recipients WHERE tenant_id=? AND channel='whatsapp' AND destination=? AND status='verified' LIMIT 1",[tenantId,to]);
  if(!recipient)return {status:'failed',errorCode:'REPORT_DESTINATION_NOT_VERIFIED'};
  if(snapshot?.period==='daily')return require('./business-notifications').scheduledReport(db,{tenantId,to,snapshot});
  try{const response=await http.post(c.url,{...from,to:to.slice(1),text},{headers:{'x-internal-secret':c.secret},timeout:20000});
    const id=response?.data?.data?.messageId;
    return response?.data?.success&&id?{status:'accepted',providerMessageId:String(id).slice(0,191)}:{status:'unknown',errorCode:'REPORT_QR_ACCEPTANCE_UNCONFIRMED'};
  }catch(error){return {status:Number(error?.response?.status)<500?'failed':'unknown',errorCode:'REPORT_QR_SEND_UNCONFIRMED'};}
}
async function verify(db,{tenantId,to,code,env=process.env,http=require('axios')}){
  let c;try{c=config(env);}catch{return {errorCode:'REPORT_QR_NOT_CONFIGURED'};}
  const from=await sender(db,tenantId);if(!from)return {errorCode:'REPORT_QR_SENDER_UNAVAILABLE'};
  const [[recipient]]=await db.query("SELECT id FROM sx_training_report_recipients WHERE tenant_id=? AND channel='whatsapp' AND destination=? AND status IN ('pending','verified') LIMIT 1",[tenantId,to]);
  if(!recipient||!/^\+[1-9]\d{7,14}$/.test(String(to))||!/^\d{10}$/.test(String(code)))return {errorCode:'REPORT_DESTINATION_NOT_ENABLED'};
  try{const response=await http.post(c.url,{...from,to:to.slice(1),text:`7Network owner report verification code: ${code}\nValid for 10 minutes.`},{headers:{'x-internal-secret':c.secret},timeout:20000});const id=response?.data?.data?.messageId;return response?.data?.success&&id?{accepted:String(id).slice(0,191)}:{unknown:true,errorCode:'REPORT_QR_ACCEPTANCE_UNCONFIRMED'};}catch{return {unknown:true,errorCode:'REPORT_QR_SEND_UNCONFIRMED'};}
}
module.exports={config,sender,send,verify};
