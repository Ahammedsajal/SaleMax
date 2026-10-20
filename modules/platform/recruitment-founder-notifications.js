'use strict';
const crypto=require('node:crypto');

const fail=code=>{throw Object.assign(new Error(code),{code});};
const TEMPLATE='salemax_candidate_founder_alert';
const VERSION='v17.0';
function config(env=process.env){
  const phone=String(env.SALEMAX_RECRUITMENT_FOUNDER_PHONE||'').trim();
  const template=String(env.SALEMAX_RECRUITMENT_FOUNDER_TEMPLATE||TEMPLATE).trim();
  const language=String(env.SALEMAX_RECRUITMENT_FOUNDER_LANGUAGE||'en').trim();
  const version=String(env.SALEMAX_META_GRAPH_VERSION||VERSION).trim();
  if(!/^\+974\d{8}$/.test(phone))fail('RECRUITMENT_FOUNDER_PHONE_NOT_CONFIGURED');
  if(!/^[a-z0-9_]{2,64}$/.test(template)||!/^\w{2,3}(?:_\w{2})?$/.test(language)||!/^v\d+\.\d+$/.test(version))fail('RECRUITMENT_FOUNDER_TEMPLATE_CONFIG_INVALID');
  return {phone,template,language,version};
}
function clean(value,max=160){return String(value??'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)||'Not provided';}
function yesNo(value){return value==='yes'?'Yes':value==='no'?'No':clean(value);}
function years(value,kind){if(value==='0')return 'Less than 1 year';if(value==='1-2')return '1–2 years';if(value==='3+')return '3 or more years';if(value==='1')return '1 year';return clean(value|| (kind==='sales'?'Not provided':'Not provided'));}
function params(payload){
  const a=payload?.answers||{};
  return [
    clean(a.fullName||payload?.senderName),
    clean(a.whatsappNumber||payload?.whatsappNumber,30),
    clean(a.contactNumber||a.whatsappNumber||payload?.whatsappNumber,30),
    clean(a.email,254),
    yesNo(a.currentlyWorking),
    years(a.totalExperienceRange,'total'),
    years(a.salesExperienceYears,'sales'),
    yesNo(a.hasComputerAndInternet),
    yesNo(a.comfortableWithSalesCalls),
    a.englishLevel==='proficient'?'Professional':clean(a.englishLevel),
    a.hindiLevel==='none'?'None':clean(a.hindiLevel),
    ({full_time:'Full-time',part_time:'Part-time',either:'Flexible'}[a.availability]||clean(a.availability)),
  ].map(text=>({type:'text',text}));
}
async function enqueue(db,{tenantId,profileId,channelKind,channelRef,conversationId,inboundMessageId,payload}){
  if(!tenantId||!profileId||!['whatsapp_meta','whatsapp_qr'].includes(channelKind)||typeof channelRef!=='string'||!channelRef||typeof conversationId!=='string'||!conversationId||typeof inboundMessageId!=='string'||!inboundMessageId||!payload?.answers?.fullName)fail('INVALID_RECRUITMENT_FOUNDER_NOTIFICATION');
  const id=crypto.randomUUID();
  const [result]=await db.query(`INSERT IGNORE INTO sx_recruitment_founder_notifications(id,tenant_id,profile_id,channel_kind,channel_ref,conversation_id,inbound_message_id,payload,status,attempt_count,available_at)
    VALUES (?,?,?,?,?,?,?,?, 'queued',0,UTC_TIMESTAMP(3))`,[id,tenantId,profileId,channelKind,channelRef,conversationId,inboundMessageId,JSON.stringify(payload)]);
  return {id,queued:result.affectedRows===1};
}
async function claim(db,{workerId,limit=10,leaseSeconds=90}={}){
  if(typeof workerId!=='string'||!/^[A-Za-z0-9._:-]{3,100}$/.test(workerId)||!Number.isSafeInteger(limit)||limit<1||limit>50||!Number.isSafeInteger(leaseSeconds)||leaseSeconds<30||leaseSeconds>300)fail('INVALID_RECRUITMENT_NOTIFICATION_WORKER');
  await db.beginTransaction();
  try{
    const [rows]=await db.query(`SELECT id,tenant_id AS tenantId,profile_id AS profileId,channel_ref AS channelRef,conversation_id AS conversationId,payload,attempt_count AS attemptCount
      FROM sx_recruitment_founder_notifications
      WHERE ((status='queued' AND available_at<=UTC_TIMESTAMP(3)) OR (status='processing' AND lease_expires_at<=UTC_TIMESTAMP(3)))
      ORDER BY available_at,created_at,id LIMIT ? FOR UPDATE SKIP LOCKED`,[limit]);
    const claimed=[];
    for(const row of rows){
      if(Number(row.attemptCount)>=168){await db.query("UPDATE sx_recruitment_founder_notifications SET status='failed',lease_owner=NULL,lease_expires_at=NULL,last_error_code='MAX_ATTEMPTS_EXCEEDED',payload=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=?",[row.id]);continue;}
      const attempt=Number(row.attemptCount)+1;
      await db.query("UPDATE sx_recruitment_founder_notifications SET status='processing',attempt_count=?,lease_owner=?,lease_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),updated_at=UTC_TIMESTAMP(3) WHERE id=?",[attempt,workerId,leaseSeconds,row.id]);
      claimed.push({...row,attempt,payload:typeof row.payload==='string'?JSON.parse(row.payload):row.payload});
    }
    await db.commit();return claimed;
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
async function send(db,item,{env=process.env,http=fetch}={}){
  const cfg=config(env);
  const [owners]=await db.query(`SELECT u.uid,m.access_token,m.business_phone_number_id AS phoneId
    FROM sx_tenants t JOIN sx_legacy_ownership o ON o.tenant_id=t.id AND o.source_table='user'
    JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED) JOIN meta_api m ON m.uid=u.uid
    WHERE t.id=? LIMIT 2`,[item.tenantId]);
  if(owners.length!==1||!owners[0].phoneId||!owners[0].access_token)fail('RECRUITMENT_FOUNDER_META_SENDER_UNAVAILABLE');
  const response=await http(`https://graph.facebook.com/${cfg.version}/${encodeURIComponent(owners[0].phoneId)}/messages`,{
    method:'POST',headers:{Authorization:`Bearer ${owners[0].access_token}`,'Content-Type':'application/json'},
    body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:cfg.phone.replace(/^\+/,''),type:'template',template:{name:cfg.template,language:{code:cfg.language},components:[{type:'body',parameters:params(item.payload)}]}}),signal:AbortSignal.timeout(20000),
  });
  let body={};try{body=await response.json();}catch{}
  const messageId=body?.messages?.[0]?.id;
  if(response.ok&&messageId)return {accepted:true,messageId:String(messageId).slice(0,191)};
  const errorCode=Number(body?.error?.code)||response.status||0;
  return {accepted:false,errorCode:`META_${errorCode}`};
}
async function finish(db,item,{workerId,result,now=new Date()}={}){
  if(result.accepted){await db.query(`UPDATE sx_recruitment_founder_notifications SET status='sent',provider_message_id=?,payload=NULL,last_error_code=NULL,lease_owner=NULL,lease_expires_at=NULL,sent_at=?,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status='processing' AND lease_owner=?`,[result.messageId,now,item.id,workerId]);return 'sent';}
  const terminal=Number(item.attempt)>=168,delay=Math.min(3600,60*2**Math.min(Number(item.attempt)-1,6));
  await db.query(`UPDATE sx_recruitment_founder_notifications SET status=?,available_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),last_error_code=?,payload=IF(?=1,NULL,payload),lease_owner=NULL,lease_expires_at=NULL,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status='processing' AND lease_owner=?`,[terminal?'failed':'queued',delay,String(result.errorCode||'META_DELIVERY_FAILED').slice(0,64),terminal?1:0,item.id,workerId]);
  return terminal?'failed':'queued';
}
async function tick(pool,{workerId,limit=10,env=process.env,http=fetch}={}){
  config(env);const db=await pool.getConnection();let sent=0,queued=0,failed=0,claimed=0;
  try{const items=await claim(db,{workerId,limit});claimed=items.length;for(const item of items){let result;try{result=await send(db,item,{env,http});}catch(error){result={accepted:false,errorCode:/^[A-Z0-9_]{2,100}$/.test(error.code||'')?error.code:'RECRUITMENT_FOUNDER_DELIVERY_FAILED'};}const status=await finish(db,item,{workerId,result});if(status==='sent')sent++;else if(status==='failed')failed++;else queued++;}return {claimed,sent,queued,failed};}finally{db.release();}
}
module.exports={TEMPLATE,config,params,enqueue,claim,send,finish,tick};
