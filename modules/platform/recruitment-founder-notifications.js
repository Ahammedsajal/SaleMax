'use strict';
const crypto=require('node:crypto');

const fail=code=>{throw Object.assign(new Error(code),{code});};
const TEMPLATE='salemax_candidate_founder_alert';
const VERSION='v17.0';
const QR_NUMBER='97455160323';
function config(env=process.env){
  const phone=String(env.SALEMAX_RECRUITMENT_FOUNDER_PHONE||'').trim();
  const template=String(env.SALEMAX_RECRUITMENT_FOUNDER_TEMPLATE||TEMPLATE).trim();
  const language=String(env.SALEMAX_RECRUITMENT_FOUNDER_LANGUAGE||'en').trim();
  const version=String(env.SALEMAX_META_GRAPH_VERSION||VERSION).trim();
  const qrOrigin=String(env.SALEMAX_RECRUITMENT_QR_INTERNAL_ORIGIN||'http://app:3010').trim().replace(/\/$/,'');
  if(phone!=='+97455160323')fail('RECRUITMENT_FOUNDER_PHONE_NOT_CONFIGURED');
  if(!/^[a-z0-9_]{2,64}$/.test(template)||!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)||!/^v\d+\.\d+$/.test(version))fail('RECRUITMENT_FOUNDER_TEMPLATE_CONFIG_INVALID');
  let url;try{url=new URL(qrOrigin);}catch{fail('RECRUITMENT_QR_ORIGIN_INVALID');}
  if(url.protocol!=='http:'||!['app','localhost','127.0.0.1'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)fail('RECRUITMENT_QR_ORIGIN_INVALID');
  if(typeof env.CRM_INTERNAL_SECRET!=='string'||env.CRM_INTERNAL_SECRET.length<20)fail('RECRUITMENT_QR_SECRET_NOT_CONFIGURED');
  return {phone,template,language,version,qrOrigin};
}
function clean(value,max=160){return String(value??'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)||'Not provided';}
function yesNo(value){return value==='yes'?'Yes':value==='no'?'No':clean(value);}
function years(value){if(value==='0')return 'Less than 1 year';if(value==='1-2')return '1–2 years';if(value==='3+')return '3 or more years';if(value==='1')return '1 year';return clean(value);}
function params(payload){
  const a=payload?.answers||{};
  return [clean(a.fullName||payload?.senderName),clean(a.whatsappNumber||payload?.whatsappNumber,30),clean(a.contactNumber||a.whatsappNumber||payload?.whatsappNumber,30),clean(a.email,254),yesNo(a.currentlyWorking),years(a.totalExperienceRange),years(a.salesExperienceYears),yesNo(a.hasComputerAndInternet),yesNo(a.comfortableWithSalesCalls),a.englishLevel==='proficient'?'Professional':clean(a.englishLevel),a.hindiLevel==='none'?'None':clean(a.hindiLevel),({full_time:'Full-time',part_time:'Part-time',either:'Flexible'}[a.availability]||clean(a.availability))].map(text=>({type:'text',text}));
}
function textPayload(payload){
  const a=payload?.answers||{};const p=params(payload).map(x=>x.text);
  const lines=['New 7Network sales associate application','',`Name: ${p[0]}`,`WhatsApp: ${p[1]}`,`Contact: ${p[2]}`,`Email: ${p[3]}`,`Currently working: ${p[4]}`,`Total experience: ${p[5]}`,`Sales experience: ${p[6]}`,`Computer and reliable internet: ${p[7]}`,`Comfortable with system-led sales calls: ${p[8]}`,`English: ${p[9]}`,`Hindi: ${p[10]}`,`Availability: ${p[11]}`];
  if(a.crmSaasExperience)lines.push(`CRM/SaaS/IT sales background: ${clean(a.crmSaasExperience,600)}`);
  if(a.referenceCode)lines.push(`Application reference: ${clean(a.referenceCode,40)}`);
  if(a.cvFileName)lines.push(`CV uploaded: ${clean(a.cvFileName,180)}`);
  lines.push(`Application source: ${clean(payload?.source||'Application form',80)}`);
  return lines.join('\n');
}
async function enqueue(db,{tenantId,profileId,channelKind,channelRef,conversationId,inboundMessageId,payload}){
  if(!tenantId||!profileId||!['whatsapp_meta','whatsapp_qr'].includes(channelKind)||typeof channelRef!=='string'||!channelRef||typeof conversationId!=='string'||!conversationId||typeof inboundMessageId!=='string'||!inboundMessageId||!payload?.answers?.fullName)fail('INVALID_RECRUITMENT_FOUNDER_NOTIFICATION');
  const id=crypto.randomUUID();
  const [result]=await db.query(`INSERT IGNORE INTO sx_recruitment_founder_notifications(id,tenant_id,profile_id,channel_kind,channel_ref,conversation_id,inbound_message_id,payload,status,attempt_count,available_at)
    VALUES (?,?,?,?,?,?,?,?, 'queued',0,UTC_TIMESTAMP(3))`,[id,tenantId,profileId,channelKind,channelRef,conversationId,inboundMessageId,JSON.stringify(payload)]);
  return {id,queued:result.affectedRows===1};
}
async function enqueueApplication(db,{tenantId,application}){
  const [[profile]]=await db.query("SELECT id FROM sx_chatbot_profiles WHERE tenant_id=? ORDER BY (status='live') DESC,updated_at DESC,id LIMIT 1",[tenantId]);
  if(!profile?.id)return {queued:false,reason:'CHATBOT_PROFILE_UNAVAILABLE'};
  const [[screening]]=await db.query('SELECT answers FROM sx_recruitment_screenings WHERE tenant_id=? AND normalized_mobile=? AND consented_at IS NOT NULL ORDER BY updated_at DESC LIMIT 1',[tenantId,application.normalizedMobile]);
  let screened={};try{screened=typeof screening?.answers==='string'?JSON.parse(screening.answers):(screening?.answers||{});}catch{}
  const answers={...screened,fullName:application.fullName,whatsappNumber:application.normalizedMobile,contactNumber:application.contactMobile||application.mobile,email:application.email||'',currentlyWorking:application.currentWorkStatus||screened.currentlyWorking||'Not provided',totalExperienceRange:application.totalExperienceRange||screened.totalExperienceRange||String(application.experienceYears??'Not provided'),salesExperienceYears:application.salesExperienceYears||screened.salesExperienceYears||'Not provided',hasComputerAndInternet:application.hasComputerAndInternet||screened.hasComputerAndInternet||'Not provided',comfortableWithSalesCalls:application.comfortableWithSalesCalls||screened.comfortableWithSalesCalls||'Not provided',englishLevel:application.englishLevel,hindiLevel:application.hindiLevel,availability:application.availability,crmSaasExperience:application.crmSaasExperience,referenceCode:application.referenceCode,cvFileName:application.cvFileName};
  return enqueue(db,{tenantId,profileId:profile.id,channelKind:'whatsapp_meta',channelRef:'recruitment-application',conversationId:application.normalizedMobile,inboundMessageId:`application:${application.id}`,payload:{answers,whatsappNumber:application.normalizedMobile,senderName:application.fullName,source:'Application form'}});
}
async function claim(db,{workerId,limit=10,leaseSeconds=90}={}){
  if(typeof workerId!=='string'||!/^[A-Za-z0-9._:-]{3,100}$/.test(workerId)||!Number.isSafeInteger(limit)||limit<1||limit>50||!Number.isSafeInteger(leaseSeconds)||leaseSeconds<30||leaseSeconds>300)fail('INVALID_RECRUITMENT_NOTIFICATION_WORKER');
  await db.beginTransaction();
  try{
    const [rows]=await db.query(`SELECT id,tenant_id AS tenantId,profile_id AS profileId,channel_ref AS channelRef,conversation_id AS conversationId,payload,delivery_results AS deliveryResults,attempt_count AS attemptCount
      FROM sx_recruitment_founder_notifications
      WHERE ((status='queued' AND available_at<=UTC_TIMESTAMP(3)) OR (status='processing' AND lease_expires_at<=UTC_TIMESTAMP(3)))
      ORDER BY available_at,created_at,id LIMIT ? FOR UPDATE SKIP LOCKED`,[limit]);
    const claimed=[];
    for(const row of rows){
      if(Number(row.attemptCount)>=168){await db.query("UPDATE sx_recruitment_founder_notifications SET status='failed',lease_owner=NULL,lease_expires_at=NULL,last_error_code='MAX_ATTEMPTS_EXCEEDED',payload=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=?",[row.id]);continue;}
      const attempt=Number(row.attemptCount)+1;
      await db.query("UPDATE sx_recruitment_founder_notifications SET status='processing',attempt_count=?,lease_owner=?,lease_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),updated_at=UTC_TIMESTAMP(3) WHERE id=?",[attempt,workerId,leaseSeconds,row.id]);
      claimed.push({...row,attempt,deliveryResults:typeof row.deliveryResults==='string'?JSON.parse(row.deliveryResults||'{}'):(row.deliveryResults||{}),payload:typeof row.payload==='string'?JSON.parse(row.payload):row.payload});
    }
    await db.commit();return claimed;
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
async function sendMeta(db,item,cfg,payload,http){
  const [owners]=await db.query(`SELECT u.uid,m.access_token,m.business_phone_number_id AS phoneId
    FROM sx_tenants t JOIN sx_legacy_ownership o ON o.tenant_id=t.id AND o.source_table='user'
    JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED) JOIN meta_api m ON m.uid=u.uid
    WHERE t.id=? LIMIT 2`,[item.tenantId]);
  if(owners.length!==1||!owners[0].phoneId||!owners[0].access_token)return {accepted:false,errorCode:'META_SENDER_UNAVAILABLE'};
  const response=await http(`https://graph.facebook.com/${cfg.version}/${encodeURIComponent(owners[0].phoneId)}/messages`,{method:'POST',headers:{Authorization:`Bearer ${owners[0].access_token}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:cfg.phone.replace(/^\+/,''),type:'template',template:{name:cfg.template,language:{code:cfg.language},components:[{type:'body',parameters:params(payload)}]}}),signal:AbortSignal.timeout(20000)});
  let body={};try{body=await response.json();}catch{}const messageId=body?.messages?.[0]?.id;
  if(response.ok&&messageId)return {accepted:true,messageId:String(messageId).slice(0,191)};
  return {accepted:false,errorCode:`META_${Number(body?.error?.code)||response.status||0}`};
}
async function sendQr(db,item,cfg,payload,env,http){
  const [owners]=await db.query(`SELECT u.uid FROM sx_tenants t JOIN sx_legacy_ownership o ON o.tenant_id=t.id AND o.source_table='user'
    JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED) WHERE t.id=? LIMIT 2`,[item.tenantId]);
  if(owners.length!==1)return {accepted:false,errorCode:'QR_OWNER_UNAVAILABLE'};
  const [instances]=await db.query("SELECT uniqueId FROM instance WHERE uid=? AND number=? AND status='ACTIVE' LIMIT 2",[owners[0].uid,QR_NUMBER]);
  if(instances.length!==1)return {accepted:false,errorCode:'QR_INSTANCE_UNAVAILABLE'};
  const response=await http(`${cfg.qrOrigin}/api/internal/qr/send-text`,{method:'POST',headers:{'Content-Type':'application/json','x-internal-secret':env.CRM_INTERNAL_SECRET},body:JSON.stringify({uid:owners[0].uid,from:QR_NUMBER,to:QR_NUMBER,text:textPayload(payload)}),signal:AbortSignal.timeout(20000)});
  let body={};try{body=await response.json();}catch{}const messageId=body?.data?.messageId;
  if(response.ok&&body?.success===true)return {accepted:true,messageId:messageId?String(messageId).slice(0,191):null};
  return {accepted:false,errorCode:`QR_${response.status||0}`};
}
async function send(db,item,{env=process.env,http=fetch}={}){
  const cfg=config(env);const prior=item.deliveryResults||{};const result={channels:{meta:prior.meta||null,qr:prior.qr||null}};
  const pending=[];
  if(!result.channels.meta?.accepted)pending.push(sendMeta(db,item,cfg,item.payload,http).then(v=>{result.channels.meta=v;}).catch(e=>{result.channels.meta={accepted:false,errorCode:/^[A-Z0-9_]{2,100}$/.test(e.code||'')?e.code:'META_DELIVERY_FAILED'};}));
  if(!result.channels.qr?.accepted)pending.push(sendQr(db,item,cfg,item.payload,env,http).then(v=>{result.channels.qr=v;}).catch(e=>{result.channels.qr={accepted:false,errorCode:/^[A-Z0-9_]{2,100}$/.test(e.code||'')?e.code:'QR_DELIVERY_FAILED'};}));
  await Promise.all(pending);result.accepted=Boolean(result.channels.meta?.accepted&&result.channels.qr?.accepted);result.errorCode=result.accepted?null:[result.channels.meta?.accepted?null:result.channels.meta?.errorCode,result.channels.qr?.accepted?null:result.channels.qr?.errorCode].filter(Boolean).join('_').slice(0,64);return result;
}
async function finish(db,item,{workerId,result,now=new Date()}={}){
  const channels=result.channels||item.deliveryResults||{};const allAccepted=Boolean(channels.meta?.accepted&&channels.qr?.accepted);
  const providerIds=[channels.meta?.messageId,channels.qr?.messageId].filter(Boolean).join(',').slice(0,191)||null;
  if(allAccepted){await db.query(`UPDATE sx_recruitment_founder_notifications SET status='sent',provider_message_id=?,delivery_results=?,payload=NULL,last_error_code=NULL,lease_owner=NULL,lease_expires_at=NULL,sent_at=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status='processing' AND lease_owner=?`,[providerIds,JSON.stringify(channels),now,item.id,workerId]);return 'sent';}
  const terminal=Number(item.attempt)>=168,delay=Math.min(3600,60*2**Math.min(Number(item.attempt)-1,6));
  await db.query(`UPDATE sx_recruitment_founder_notifications SET status=?,available_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),delivery_results=?,last_error_code=?,payload=IF(?=1,NULL,payload),lease_owner=NULL,lease_expires_at=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status='processing' AND lease_owner=?`,[terminal?'failed':'queued',delay,JSON.stringify(channels),String(result.errorCode||'DUAL_CHANNEL_DELIVERY_FAILED').slice(0,64),terminal?1:0,item.id,workerId]);
  return terminal?'failed':'queued';
}
async function tick(pool,{workerId,limit=10,env=process.env,http=fetch}={}){
  config(env);const db=await pool.getConnection();let sent=0,queued=0,failed=0,claimed=0;
  try{const items=await claim(db,{workerId,limit});claimed=items.length;for(const item of items){let result;try{result=await send(db,item,{env,http});}catch(error){result={accepted:false,channels:item.deliveryResults||{},errorCode:/^[A-Z0-9_]{2,100}$/.test(error.code||'')?error.code:'RECRUITMENT_FOUNDER_DELIVERY_FAILED'};}const status=await finish(db,item,{workerId,result});if(status==='sent')sent++;else if(status==='failed')failed++;else queued++;}return {claimed,sent,queued,failed};}finally{db.release();}
}
module.exports={TEMPLATE,QR_NUMBER,config,params,textPayload,enqueue,enqueueApplication,claim,send,sendMeta,sendQr,finish,tick};
