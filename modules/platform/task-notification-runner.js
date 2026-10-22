'use strict';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function config(env=process.env){if(env.SALEMAX_TASK_EMAIL_ENABLED!=='true')fail('TASK_EMAIL_DISABLED');const host=String(env.SALEMAX_SMTP_HOST||'').trim(),port=Number(env.SALEMAX_SMTP_PORT),user=String(env.SALEMAX_SMTP_USER||''),pass=String(env.SALEMAX_SMTP_PASS||''),from=String(env.SALEMAX_TASK_EMAIL_FROM||env.SALEMAX_RECEIPT_FROM||'').trim();if(!host||host.length>253||!Number.isInteger(port)||port<1||port>65535||!user||user.length>254||!pass||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from))fail('TASK_SMTP_NOT_CONFIGURED');return {host,port,secure:env.SALEMAX_SMTP_SECURE==='true',auth:{user,pass},from};}
function whatsappConfig(env=process.env){const template=String(env.SALEMAX_TASK_WHATSAPP_TEMPLATE||'').trim(),language=String(env.SALEMAX_TASK_WHATSAPP_LANGUAGE||'en_US').trim(),version=String(env.SALEMAX_META_GRAPH_VERSION||'v24.0').trim();if(!template)return null;if(!/^[a-z0-9_]{2,64}$/.test(template)||!/^[a-z]{2,3}_[A-Z]{2}$/.test(language)||!/^v\d+\.\d+$/.test(version))fail('TASK_WHATSAPP_CONFIG_INVALID');return {template,language,version};}
function message({from,to,title,status,dueAt,taskId,baseUrl,categoryKey='training_center'}){
  const url=baseUrl?`${baseUrl.replace(/\/$/,'')}/user?page=tasks&task=${encodeURIComponent(taskId)}`:'';
  const workspace=categoryKey==='7network_sales'?'Sales Workspace':'Training Center';
  const safeTitle=escape(title),safeStatus=escape(status||'open'),safeDue=escape(dueAt||'Not set'),safeUrl=escape(url),safeWorkspace=escape(workspace);
  return {
    from,to,subject:`Task update: ${title}`,
    text:`7Network ${workspace} task update\n\nTask: ${title}\nStatus: ${status||'open'}\nDue: ${dueAt||'Not set'}${url?`\nOpen Tasks: ${url}`:''}`,
    html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#17202b"><h2 style="color:#a8003b">7Network · ${safeWorkspace}</h2><p>A task assigned to you has changed.</p><dl><dt><strong>Task</strong></dt><dd>${safeTitle}</dd><dt><strong>Status</strong></dt><dd>${safeStatus}</dd><dt><strong>Due</strong></dt><dd>${safeDue}</dd></dl>${url?`<p><a href="${safeUrl}">Open Tasks</a></p>`:''}</div>`
  };
}
async function claim(db,{workerId,limit=20,leaseSeconds=120}={}){
  if(typeof workerId!=='string'||!/^[A-Za-z0-9._:-]{3,100}$/.test(workerId)||!Number.isSafeInteger(limit)||limit<1||limit>50||!Number.isSafeInteger(leaseSeconds)||leaseSeconds<30||leaseSeconds>600)fail('INVALID_TASK_WORKER');
  await db.beginTransaction();
  try{
    const [rows]=await db.query(`SELECT n.id,n.tenant_id,n.task_id,n.task_revision,n.recipient_type,n.recipient_id,n.channel,n.attempt_count,n.status AS notification_status,t.title,t.description,t.task_type,t.source_type,t.source_id,t.due_at,tenant.category_key,tenant.timezone,
      COALESCE((SELECT e.to_status FROM sx_task_events e WHERE e.tenant_id=n.tenant_id AND e.task_id=n.task_id AND e.revision=n.task_revision AND e.to_status IS NOT NULL ORDER BY e.id DESC LIMIT 1),t.status) AS to_status
      FROM sx_task_notifications n JOIN sx_tasks t ON t.tenant_id=n.tenant_id AND t.id=n.task_id AND t.deleted_at IS NULL
      JOIN sx_tenants tenant ON tenant.id=n.tenant_id AND tenant.status='active'
      WHERE ((n.status='queued' AND n.available_at<=UTC_TIMESTAMP(3)) OR (n.status='processing' AND n.lease_expires_at<=UTC_TIMESTAMP(3)))
      ORDER BY n.available_at,n.id LIMIT ? FOR UPDATE SKIP LOCKED`,[limit]);
    const items=[];
    for(const row of rows){
      if(row.notification_status==='processing')await db.query("UPDATE sx_task_notification_attempts SET outcome='lease_expired',error_code='WORKER_LEASE_EXPIRED',finished_at=UTC_TIMESTAMP(3) WHERE notification_id=? AND attempt_number=? AND outcome='leased'",[row.id,Number(row.attempt_count)]);
      if(Number(row.attempt_count)>=8){await db.query("UPDATE sx_task_notifications SET status='failed',lease_owner=NULL,lease_expires_at=NULL,last_error_code='MAX_ATTEMPTS_EXCEEDED' WHERE id=?",[row.id]);continue;}
      const attempt=Number(row.attempt_count)+1;
      await db.query("UPDATE sx_task_notifications SET status='processing',attempt_count=?,lease_owner=?,lease_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND) WHERE id=?",[attempt,workerId,leaseSeconds,row.id]);
      await db.query("INSERT INTO sx_task_notification_attempts(tenant_id,notification_id,attempt_number,worker_id,outcome) VALUES(?,?,?,?,'leased')",[row.tenant_id,row.id,attempt,workerId]);
      items.push({...row,attempt,workerId});
    }
    await db.commit();return items;
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
async function resolveEmail(db,item){let rows;if(item.recipient_type==='identity'){[rows]=await db.query("SELECT i.email_normalized AS email FROM sx_identities i JOIN sx_memberships m ON m.identity_id=i.id AND m.tenant_id=? AND m.status='active' WHERE i.id=? AND i.status='active' LIMIT 1",[item.tenant_id,item.recipient_id]);}else if(item.recipient_type==='agent'){[rows]=await db.query("SELECT a.email FROM agents a JOIN user u ON u.uid=a.owner_uid JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR) AND o.tenant_id=? WHERE a.id=? AND a.role='agent' AND a.is_active=1 LIMIT 1",[item.tenant_id,item.recipient_id]);}else{[rows]=await db.query("SELECT u.email FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR) AND o.tenant_id=? WHERE u.uid=? LIMIT 1",[item.tenant_id,item.recipient_id]);}const email=rows?.[0]?.email;return typeof email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null;}
async function resolveWhatsapp(db,item){const [[preference]]=await db.query('SELECT whatsapp_opt_in AS whatsappOptIn FROM sx_task_notification_preferences WHERE tenant_id=? AND actor_type=? AND actor_id=? LIMIT 1',[item.tenant_id,item.recipient_type,item.recipient_id]);if(Number(preference?.whatsappOptIn)!==1)return {suppressed:'TASK_WHATSAPP_OPT_IN_REQUIRED'};let rows;if(item.recipient_type==='agent'){[rows]=await db.query("SELECT a.mobile AS phone,u.uid AS owner_uid FROM agents a JOIN user u ON u.uid=a.owner_uid JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR) AND o.tenant_id=? WHERE a.id=? AND a.role='agent' AND a.is_active=1 LIMIT 1",[item.tenant_id,item.recipient_id]);}else if(item.recipient_type==='identity'){[rows]=await db.query("SELECT u.mobile AS phone,u.uid AS owner_uid FROM sx_memberships m JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='user' JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED) WHERE m.tenant_id=? AND m.identity_id=? AND m.status='active' LIMIT 1",[item.tenant_id,item.recipient_id]);}else{[rows]=await db.query("SELECT u.mobile AS phone,u.uid AS owner_uid FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR) AND o.tenant_id=? WHERE u.uid=? LIMIT 1",[item.tenant_id,item.recipient_id]);}const recipient=rows?.[0];if(!recipient)return null;const phone=String(recipient.phone||'').replace(/[\s().-]/g,'');if(!/^\+?[1-9]\d{7,14}$/.test(phone))return null;const [[meta]]=await db.query('SELECT access_token,business_phone_number_id FROM meta_api WHERE uid=? LIMIT 1',[recipient.owner_uid]);if(!meta?.access_token||!/^\d{5,30}$/.test(String(meta.business_phone_number_id||'')))return null;return {phone:phone.replace(/^\+/,''),token:meta.access_token,phoneId:String(meta.business_phone_number_id)};}
async function sendWhatsapp(db,item,{config,http=require('axios')}){const recipient=await resolveWhatsapp(db,item);if(recipient?.suppressed)return recipient;if(!recipient)return {suppressed:'TASK_WHATSAPP_RECIPIENT_OR_PROVIDER_UNAVAILABLE'};const due=item.due_at instanceof Date?item.due_at.toISOString():String(item.due_at||'Not set');const payload={messaging_product:'whatsapp',to:recipient.phone,type:'template',template:{name:config.template,language:{code:config.language},components:[{type:'body',parameters:[{type:'text',text:String(item.title).slice(0,180)},{type:'text',text:String(item.to_status||'open').slice(0,24)},{type:'text',text:due.slice(0,64)}]}]}};try{const response=await http.post(`https://graph.facebook.com/${config.version}/${recipient.phoneId}/messages`,payload,{headers:{Authorization:`Bearer ${recipient.token}`},timeout:15000});const id=response?.data?.messages?.[0]?.id;if(!id)return {retry:'META_MESSAGE_ID_MISSING'};return {accepted:String(id).slice(0,191)};}catch(error){const code=String(error?.code||'');if(['ECONNABORTED','ETIMEDOUT','ECONNRESET','ESOCKETTIMEDOUT'].includes(code))return {unknown:'TASK_WHATSAPP_OUTCOME_UNKNOWN'};if(Number(error?.response?.status)>=400&&Number(error?.response?.status)<500)return {failed:'META_TEMPLATE_REJECTED'};return {retry:'TASK_WHATSAPP_DELIVERY_FAILED'};}}
function inboxFollowUpChatId(item){
  if(item.source_type==='inbox_chat')return String(item.source_id||'').trim()||null;
  if(item.task_type==='lead_follow_up'){
    const match=String(item.description||'').match(/^Conversation: ([^\r\n]{1,191})$/m);
    if(match)return match[1].trim()||null;
  }
  return null;
}
function inboxMessageText(message){
  let context=message?.msgContext;
  if(typeof context==='string'){try{context=JSON.parse(context);}catch{context=null;}}
  if(!context||typeof context!=='object')return '';
  const type=String(message?.type||context.type||'').toLowerCase();
  const value=type==='text'?context.text?.body
    :type==='image'?context.image?.caption||'Shared an image'
    :type==='video'?context.video?.caption||'Shared a video'
    :type==='document'?context.document?.caption||context.document?.filename||'Shared a document'
    :type==='audio'?'Shared a voice message'
    :context.text?.body||context.extendedTextMessage?.text||'';
  return String(value||'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,220);
}
function taskDescriptionValue(description,label){
  const match=String(description||'').match(new RegExp(`^${label}: ([^\\r\\n]{1,1000})$`,'m'));
  return match?.[1]?.trim()||'';
}
async function sendInboxFollowUpQr(db,item,{http=require('axios'),env=process.env}={}){
  const chatId=inboxFollowUpChatId(item);if(!chatId)return {suppressed:'TASK_QR_SENDER_UNAVAILABLE'};
  let sender;try{const [[channel]]=await db.query(`SELECT u.uid,n.number FROM sx_legacy_ownership o JOIN user u ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR) AND o.tenant_id=? JOIN instance n ON n.uid=u.uid AND n.status='ACTIVE' AND (((SELECT c.origin_instance_unique_id FROM beta_chats c WHERE c.uid=u.uid AND c.chat_id=? AND c.origin='qr' LIMIT 1) IS NOT NULL AND n.uniqueId=(SELECT c.origin_instance_unique_id FROM beta_chats c WHERE c.uid=u.uid AND c.chat_id=? AND c.origin='qr' LIMIT 1)) OR ((SELECT 1 FROM beta_chats c WHERE c.uid=u.uid AND c.chat_id=? AND c.origin='qr' LIMIT 1) IS NULL AND (SELECT COUNT(*) FROM instance x WHERE x.uid=u.uid AND x.status='ACTIVE')=1)) LIMIT 1`,[item.tenant_id,chatId,chatId,chatId]);sender=channel?{uid:channel.uid,from:channel.number}:null;}catch{return {suppressed:'TASK_QR_SENDER_UNAVAILABLE'};}
  if(!sender)return {suppressed:'TASK_QR_SENDER_UNAVAILABLE'};
  let chat=null,recentMessages=[];
  try{
    const [[chatRow]] = await db.query('SELECT sender_name,sender_mobile FROM beta_chats WHERE uid=? AND chat_id=? LIMIT 1',[sender.uid,chatId]);
    chat=chatRow||null;
    const [messages]=await db.query('SELECT route,type,msgContext FROM beta_conversation WHERE uid=? AND chat_id=? ORDER BY id DESC LIMIT 6',[sender.uid,chatId]);
    recentMessages=messages||[];
  }catch{}
  let rows;
  try{
    if(item.recipient_type==='agent') [rows]=await db.query("SELECT a.mobile AS phone FROM agents a JOIN sx_legacy_ownership o ON o.source_table='agents' AND o.source_id=CAST(a.id AS CHAR) AND o.tenant_id=? JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id AND m.role='agent' AND m.status='active' JOIN sx_identities i ON i.id=m.identity_id AND i.status='active' WHERE a.id=? AND a.role='agent' AND a.is_active=1 AND o.legacy_uid_hash=CONVERT(SHA2(a.uid,256) USING ascii) COLLATE ascii_bin LIMIT 1",[item.tenant_id,item.recipient_id]);
    else if(item.recipient_type==='identity') [rows]=await db.query("SELECT COALESCE(u.mobile_with_country_code,a.mobile) AS phone FROM sx_memberships m JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table IN ('user','agents') LEFT JOIN user u ON o.source_table='user' AND u.id=CAST(o.source_id AS UNSIGNED) LEFT JOIN agents a ON o.source_table='agents' AND a.id=CAST(o.source_id AS UNSIGNED) WHERE m.tenant_id=? AND m.identity_id=? AND m.status='active' AND m.role IN ('owner','manager') LIMIT 1",[item.tenant_id,item.recipient_id]);
    else [rows]=await db.query("SELECT mobile_with_country_code AS phone FROM user WHERE uid=? AND role='user' LIMIT 1",[item.recipient_id]);
  }catch{return {failed:'TASK_QR_RECIPIENT_LOOKUP_FAILED'};}
  const phone=String(rows?.[0]?.phone||'').replace(/[\s().-]/g,'');
  if(!/^\+?[1-9]\d{7,14}$/.test(phone))return {suppressed:'TASK_QR_RECIPIENT_UNAVAILABLE'};
  const secret=String(env.CRM_INTERNAL_SECRET||''),port=Number(env.PORT||3010),base=String(env.SALEMAX_TASK_QR_INTERNAL_ORIGIN||`http://127.0.0.1:${port}`);
  let url;try{const origin=new URL(base);if(!secret||origin.protocol!=='http:'||!['127.0.0.1','localhost','app'].includes(origin.hostname)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)return {suppressed:'TASK_QR_NOT_CONFIGURED'};url=origin.origin+'/api/internal/qr/send-text';}catch{return {suppressed:'TASK_QR_NOT_CONFIGURED'};}
  let due=String(item.due_at||'Not set');try{if(item.due_at)due=new Intl.DateTimeFormat('en',{timeZone:item.timezone||'Asia/Qatar',dateStyle:'medium',timeStyle:'short'}).format(new Date(item.due_at));}catch{}
  const description=String(item.description||'');
  const chatName=String(chat?.sender_name||'').trim();
  const chatPhone=String(chat?.sender_mobile||'').trim();
  const leadName=String((chatName&&!/^na$/i.test(chatName)?chatName:'')||taskDescriptionValue(description,'Lead')||String(item.title||'').replace(/^Follow up:\s*/i,'')||'WhatsApp contact').trim().slice(0,180);
  const leadPhone=String((chatPhone&&!/^na$/i.test(chatPhone)?chatPhone:'')||taskDescriptionValue(description,'WhatsApp')||'Not available').trim().slice(0,40);
  const assignedAgent=taskDescriptionValue(description,'Assigned agent');
  const followUpDetails=taskDescriptionValue(description,'Follow-up details');
  const chatSummary=recentMessages.map(message=>({route:String(message.route||'').toUpperCase(),text:inboxMessageText(message)})).filter(message=>message.text).slice(0,4).reverse();
  const summaryLines=chatSummary.length?chatSummary.map(message=>`${message.route==='INCOMING'?'Customer':'Team'}: ${message.text}`):['No recent chat messages available.'];
  const status=String(item.to_status||'open').replace(/_/g,' ').replace(/\b\w/g,char=>char.toUpperCase());
  const text=[
    '7Network follow-up task',
    '',
    `Customer: ${leadName}`,
    `Contact number: ${leadPhone}`,
    `Task: ${String(item.title||'Follow up').slice(0,180)}`,
    assignedAgent?`Assigned agent: ${assignedAgent}`:null,
    followUpDetails?`Follow-up details: ${followUpDetails}`:null,
    `Follow-up date: ${due}`,
    `Status: ${status}`,
    '',
    'Recent chat:',
    ...summaryLines
  ].filter(line=>line!==null).join('\n').slice(0,2200);
  try{const response=await http.post(url,{...sender,to:phone.replace(/^\+/,''),text},{headers:{'x-internal-secret':secret},timeout:20000});const id=response?.data?.data?.messageId;if(response?.data?.success&&id)return {accepted:String(id).slice(0,191)};return {unknown:'TASK_QR_ACCEPTANCE_UNCONFIRMED'};}catch(error){const status=Number(error?.response?.status),code=String(error?.code||'');if(status>=400&&status<500)return {failed:'TASK_QR_SEND_REJECTED'};if(['ECONNABORTED','ETIMEDOUT','ECONNRESET','ESOCKETTIMEDOUT'].includes(code))return {unknown:'TASK_QR_OUTCOME_UNKNOWN'};return {retry:'TASK_QR_DELIVERY_FAILED'};}
}
async function finish(db,item,{status,errorCode=null,providerMessageId=null,delaySeconds=0}){await db.beginTransaction();try{const [[row]]=await db.query('SELECT status,lease_owner,attempt_count FROM sx_task_notifications WHERE tenant_id=? AND id=? FOR UPDATE',[item.tenant_id,item.id]);if(!row||row.status!=='processing'||row.lease_owner!==item.workerId||Number(row.attempt_count)!==item.attempt)fail('TASK_NOTIFICATION_LEASE_REQUIRED');const finalStatus=status==='retry'?(item.attempt>=8?'failed':'queued'):status;if(!['queued','accepted','failed','suppressed','unknown'].includes(finalStatus))fail('INVALID_TASK_NOTIFICATION_RESULT');await db.query(`UPDATE sx_task_notifications SET status=?,available_at=IF(?='queued',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),available_at),lease_owner=NULL,lease_expires_at=NULL,last_error_code=?,provider_message_id=? WHERE tenant_id=? AND id=?`,[finalStatus,finalStatus,delaySeconds,errorCode,providerMessageId,item.tenant_id,item.id]);const outcome=finalStatus==='queued'?'retry':finalStatus;await db.query('UPDATE sx_task_notification_attempts SET outcome=?,error_code=?,finished_at=UTC_TIMESTAMP(3) WHERE notification_id=? AND attempt_number=? AND worker_id=?',[outcome,errorCode,item.id,item.attempt,item.workerId]);await db.commit();return {id:item.id,status:finalStatus};}catch(error){try{await db.rollback();}catch{}throw error;}}
async function dispatch(db,item,{transport,from,baseUrl,whatsapp,http,env=process.env}={}){if(item.channel==='whatsapp'){const result=inboxFollowUpChatId(item)?await sendInboxFollowUpQr(db,item,{http,env}):!whatsapp?{suppressed:'TASK_WHATSAPP_TEMPLATE_NOT_CONFIGURED'}:await sendWhatsapp(db,item,{config:whatsapp,http});if(result.accepted)return finish(db,item,{status:'accepted',providerMessageId:result.accepted});if(result.suppressed)return finish(db,item,{status:'suppressed',errorCode:result.suppressed});if(result.unknown)return finish(db,item,{status:'unknown',errorCode:result.unknown});if(result.failed)return finish(db,item,{status:'failed',errorCode:result.failed});return finish(db,item,{status:'retry',errorCode:result.retry,delaySeconds:Math.min(3600,15*2**Math.min(item.attempt-1,8))});}if(!transport)return finish(db,item,{status:'suppressed',errorCode:'TASK_EMAIL_NOT_CONFIGURED'});const to=await resolveEmail(db,item);if(!to)return finish(db,item,{status:'suppressed',errorCode:'TASK_RECIPIENT_UNAVAILABLE'});try{const result=await transport.sendMail(message({from,to,title:item.title,status:item.to_status||'open',dueAt:item.due_at,taskId:item.task_id,baseUrl,categoryKey:item.category_key}));const accepted=Array.isArray(result?.accepted)&&result.accepted.some(address=>String(address).toLowerCase()===to.toLowerCase());if(!accepted)throw Object.assign(new Error(),{code:'SMTP_RECIPIENT_NOT_ACCEPTED'});return finish(db,item,{status:'accepted',providerMessageId:String(result.messageId||'').slice(0,191)||null});}catch(error){const code=/^[A-Z][A-Z0-9_]{1,99}$/.test(error.code||'')?error.code:'TASK_EMAIL_DELIVERY_FAILED',unknown=['ETIMEDOUT','ECONNRESET','ESOCKET','ECONNECTION'].includes(error.code);return finish(db,item,{status:unknown?'unknown':'retry',errorCode:code,delaySeconds:Math.min(3600,15*2**Math.min(item.attempt-1,8))});}}
async function tick(pool,{workerId=`tasks-${process.pid}`,limit=20,transport,from,baseUrl,whatsapp,http}={}){const db=await pool.getConnection();let items;try{items=await claim(db,{workerId,limit});}finally{db.release();}const totals={claimed:items.length,accepted:0,retried:0,suppressed:0,failed:0,unknown:0};for(const item of items){const current=await pool.getConnection();try{const result=await dispatch(current,item,{transport,from,baseUrl,whatsapp,http});if(result.status==='accepted')totals.accepted++;else if(result.status==='queued')totals.retried++;else if(result.status==='suppressed')totals.suppressed++;else if(result.status==='failed')totals.failed++;else if(result.status==='unknown')totals.unknown++;}catch(error){console.error(JSON.stringify({event:'task_notification_dispatch_unconfirmed',channel:item.channel,recipientType:item.recipient_type,code:/^[A-Z0-9_]{2,100}$/.test(error?.code||'')?error.code:'TASK_NOTIFICATION_DISPATCH_FAILED'}));try{const result=await finish(current,item,{status:'unknown',errorCode:'TASK_NOTIFICATION_DISPATCH_UNCONFIRMED'});if(result.status==='unknown')totals.unknown++;}catch{}}finally{current.release();}}return totals;}
module.exports={config,whatsappConfig,message,claim,resolveEmail,resolveWhatsapp,sendWhatsapp,sendInboxFollowUpQr,finish,dispatch,tick,_private:{escape,inboxFollowUpChatId,inboxMessageText,taskDescriptionValue}};
