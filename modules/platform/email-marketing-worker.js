'use strict';

const os=require('node:os');
const crypto=require('node:crypto');
const service=require('./email-marketing');
const ses=require('./email-marketing-ses');
const providerSettings=require('./email-marketing-provider-settings');
const workerId=`email-${os.hostname().replace(/[^A-Za-z0-9._:-]/g,'-').slice(0,60)}-${process.pid}`;
const id=()=>crypto.randomUUID();
const interval=5000,leaseSeconds=180;

async function claim(pool,{limit=8,now=new Date()}={}){
  const db=await pool.getConnection();
  try{
    await db.beginTransaction();
    await db.query("UPDATE sx_email_campaigns SET status='queued' WHERE status='scheduled' AND scheduled_at<=UTC_TIMESTAMP(3)");
    await db.query("UPDATE sx_email_campaign_recipients SET status='unknown',lease_owner=NULL,lease_expires_at=NULL,last_error_code='DELIVERY_OUTCOME_UNKNOWN' WHERE status='sending' AND lease_expires_at<=UTC_TIMESTAMP(3)");
    const [rows]=await db.query(`SELECT r.id,r.tenant_id AS tenantId,r.campaign_id AS campaignId,r.contact_id AS contactId,r.recipient_email AS recipientEmail,
      r.normalized_email AS normalizedEmail,r.attempt_count AS attemptCount,c.subject,c.text_body AS textBody,c.status AS campaignStatus,
      s.email AS senderEmail,s.verification_status AS senderStatus,d.region,d.domain,d.verification_status AS domainStatus,d.dkim_status AS dkimStatus
      FROM sx_email_campaign_recipients r JOIN sx_email_campaigns c ON c.tenant_id=r.tenant_id AND c.id=r.campaign_id
      JOIN sx_email_senders s ON s.tenant_id=c.tenant_id AND s.id=c.sender_id
      JOIN sx_email_sender_domains d ON d.tenant_id=s.tenant_id AND d.id=s.domain_id
      WHERE c.status IN ('queued','sending') AND (c.scheduled_at IS NULL OR c.scheduled_at<=UTC_TIMESTAMP(3))
        AND r.status='pending' AND r.available_at<=UTC_TIMESTAMP(3)
      ORDER BY r.available_at,r.created_at,r.id LIMIT ? FOR UPDATE SKIP LOCKED`,[limit]);
    const items=[];
    for(const row of rows){
      const attempt=Number(row.attemptCount)+1;
      await db.query("UPDATE sx_email_campaign_recipients SET status='sending',attempt_count=?,lease_owner=?,lease_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),last_error_code=NULL WHERE tenant_id=? AND campaign_id=? AND id=? AND status='pending'",[attempt,workerId,leaseSeconds,row.tenantId,row.campaignId,row.id]);
      await db.query("UPDATE sx_email_campaigns SET status='sending' WHERE tenant_id=? AND id=? AND status IN ('queued','sending')",[row.tenantId,row.campaignId]);
      items.push({...row,attempt,workerId});
    }
    await db.commit();return items;
  }catch(error){try{await db.rollback();}catch{}throw error;}finally{db.release();}
}

async function currentContact(db,item){
  const [rows]=await db.query(`SELECT c.name,c.email,c.mobile,c.var1,c.var2,c.var3,c.var4,c.var5,c.email_marketing_consent,c.email_unsubscribed_at,
      s.normalized_email AS suppressedEmail
    FROM sx_email_campaign_recipients r
    JOIN sx_legacy_ownership o ON o.tenant_id=r.tenant_id AND o.source_table='user'
    JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=o.tenant_id AND m.role='owner' AND m.status='active'
    JOIN user u ON BINARY CAST(u.id AS CHAR)=BINARY o.source_id AND BINARY SHA2(u.uid,256)=BINARY o.legacy_uid_hash
    JOIN contact c ON c.uid=u.uid AND c.id=r.contact_id
    LEFT JOIN sx_email_suppressions s ON s.tenant_id=r.tenant_id AND s.normalized_email=r.normalized_email
    WHERE r.tenant_id=? AND r.campaign_id=? AND r.id=? LIMIT 2`,[item.tenantId,item.campaignId,item.id]);
  if(rows.length!==1)return {blocked:true,code:'PHONEBOOK_CONTACT_UNAVAILABLE'};
  const contact=rows[0],email=service.normalizeEmail(contact.email);
  if(Number(contact.email_marketing_consent)!==1||contact.email_unsubscribed_at)return {blocked:true,code:'CONTACT_CONSENT_REVOKED'};
  if(!service.validEmail(email)||email!==item.normalizedEmail)return {blocked:true,code:'CONTACT_EMAIL_CHANGED'};
  if(contact.suppressedEmail)return {blocked:true,code:'EMAIL_SUPPRESSED'};
  return {contact:{...contact,email}};
}

function personalize(value,contact){
  const values={name:contact.name||'',email:contact.email||'',mobile:contact.mobile||'',var1:contact.var1||'',var2:contact.var2||'',var3:contact.var3||'',var4:contact.var4||'',var5:contact.var5||''};
  return String(value||'').replace(/\{\{\s*(name|email|mobile|var[1-5])\s*\}\}/gi,(_,key)=>String(values[key.toLowerCase()]||''));
}

async function campaignAttachments(db,item){
  const [rows]=await db.query('SELECT attachment_id AS id FROM sx_email_campaign_attachments WHERE tenant_id=? AND campaign_id=? ORDER BY attachment_id',[item.tenantId,item.campaignId]);
  if(!rows.length)return [];
  return service.loadAttachments(db,item.tenantId,rows.map(row=>row.id));
}

function unsubscribeUrl(origin,key,item){
  const base=String(origin||'https://7network.live').replace(/\/$/,'');
  return `${base}/api/public/email/unsubscribe/${service.tokenFor(key,item.tenantId,item.campaignId,item.id)}`;
}

async function dispatch(pool,item,{key,origin,send=ses.sendSimple,providerCache=new Map(),credentials=null,providerErrorCode=null}={}){
  if(item.senderStatus!=='verified'||item.domainStatus!=='verified'||item.dkimStatus!=='SUCCESS')return finish(pool,item,{status:'failed',errorCode:'EMAIL_SENDER_NOT_VERIFIED'});
  if(!credentials)return finish(pool,item,{status:'retry',errorCode:providerErrorCode||'AWS_CREDENTIALS_REQUIRED',delaySeconds:300});
  const db=await pool.getConnection();let current,attachments;try{current=await currentContact(db,item);if(current.blocked)return finish(pool,item,{status:'suppressed',errorCode:current.code});attachments=await campaignAttachments(db,item);}finally{db.release();}
  let account=providerCache.get(item.region);
  if(!account){try{account=await ses.getAccount(item.region,credentials);providerCache.set(item.region,account);}catch(error){return finish(pool,item,{status:'retry',errorCode:safeProviderCode(error),delaySeconds:300});}}
  if(!account.sendingEnabled||!account.productionAccessEnabled)return finish(pool,item,{status:'retry',errorCode:'SES_PRODUCTION_ACCESS_REQUIRED',delaySeconds:300});
  account.localAccepted=Number(account.localAccepted||0);
  if(account.max24HourSend>0&&account.sentLast24Hours+account.localAccepted>=account.max24HourSend)return finish(pool,item,{status:'retry',errorCode:'SES_DAILY_QUOTA_REACHED',delaySeconds:300});
  const contact=current.contact,subject=personalize(item.subject,contact),url=unsubscribeUrl(origin,key,item);
  const text=`${personalize(item.textBody,contact)}\n\n---\nUnsubscribe / إلغاء الاشتراك: ${url}`;
  const message={FromEmailAddress:item.senderEmail,Destination:{ToAddresses:[item.recipientEmail]},ReplyToAddresses:[item.senderEmail],
    Content:{Simple:{Subject:{Data:subject,Charset:'UTF-8'},Body:{Text:{Data:text,Charset:'UTF-8'}},
      Headers:[{Name:'List-Unsubscribe',Value:`<${url}>`},{Name:'List-Unsubscribe-Post',Value:'List-Unsubscribe=One-Click'}],
      ...(attachments.length?{Attachments:attachments.map(file=>({FileName:file.fileName,ContentType:file.contentType,ContentDisposition:'ATTACHMENT',ContentTransferEncoding:'BASE64',RawContent:file.content}))}:{})}},
    EmailTags:[{Name:'campaign_id',Value:item.campaignId},{Name:'recipient_id',Value:item.id}]};
  const configSet=process.env.SALEMAX_EMAIL_SES_CONFIGURATION_SET;if(configSet)message.ConfigurationSetName=configSet;
  try{const result=await send(item.region,message,credentials);account.localAccepted++;return finish(pool,item,{status:'accepted',providerMessageId:result.messageId||null,subject,text});}
  catch(error){
    const code=safeProviderCode(error),status=error?.$metadata?.httpStatusCode;
    if(code==='SES_THROTTLED')return finish(pool,item,{status:'retry',errorCode:code,delaySeconds:Math.min(300,15*2**Math.min(item.attempt-1,4))});
    if(code==='SES_DAILY_QUOTA_REACHED'||code==='SES_SENDING_DISABLED')return finish(pool,item,{status:'retry',errorCode:code,delaySeconds:300});
    if(Number(status)>=400&&Number(status)<500)return finish(pool,item,{status:'failed',errorCode:code});
    return finish(pool,item,{status:'unknown',errorCode:'DELIVERY_OUTCOME_UNKNOWN'});
  }
}

function safeProviderCode(error){return ses.publicCode(error);}
async function finish(pool,item,result){
  const db=await pool.getConnection();
  try{
    await db.beginTransaction();
    const [[row]]=await db.query('SELECT status,lease_owner FROM sx_email_campaign_recipients WHERE tenant_id=? AND campaign_id=? AND id=? FOR UPDATE',[item.tenantId,item.campaignId,item.id]);
    if(!row||row.status!=='sending'||row.lease_owner!==item.workerId){await db.commit();return {status:'stale'};}
    if(result.status==='retry'){
      await db.query("UPDATE sx_email_campaign_recipients SET status='pending',available_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),lease_owner=NULL,lease_expires_at=NULL,last_error_code=? WHERE tenant_id=? AND campaign_id=? AND id=?",[Math.min(3600,Math.max(30,Number(result.delaySeconds)||60)),String(result.errorCode||'SES_RETRY').slice(0,64),item.tenantId,item.campaignId,item.id]);
    }else{
      const status=result.status==='accepted'?'accepted':result.status==='suppressed'?'suppressed':result.status==='unknown'?'unknown':'failed';
      await db.query('UPDATE sx_email_campaign_recipients SET status=?,lease_owner=NULL,lease_expires_at=NULL,last_error_code=?,provider_message_id=?,accepted_at=IF(?=\'accepted\',UTC_TIMESTAMP(3),NULL) WHERE tenant_id=? AND campaign_id=? AND id=?',[status,result.errorCode||null,result.providerMessageId||null,status,item.tenantId,item.campaignId,item.id]);
      if(status==='accepted'){
        const threadId=id();
        const [[recipient]]=await db.query('SELECT recipient_email,recipient_name,contact_id FROM sx_email_campaign_recipients WHERE tenant_id=? AND campaign_id=? AND id=?',[item.tenantId,item.campaignId,item.id]);
        await db.query('INSERT INTO sx_email_threads(id,tenant_id,campaign_id,recipient_id,contact_id,recipient_email,recipient_name,subject,last_message_at) VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))',[threadId,item.tenantId,item.campaignId,item.id,recipient.contact_id,recipient.recipient_email,recipient.recipient_name,result.subject||item.subject]);
        await db.query("INSERT INTO sx_email_messages(tenant_id,thread_id,direction,subject,text_body,provider_message_id,sent_at) VALUES(?,?,'outbound',?,?,?,UTC_TIMESTAMP(3))",[item.tenantId,threadId,result.subject||item.subject,result.text||item.textBody,result.providerMessageId||null]);
      }
    }
    const [[counts]]=await db.query(`SELECT SUM(status='pending') AS pending,SUM(status='sending') AS sending,SUM(status='accepted') AS accepted,
      SUM(status='failed') AS failed,SUM(status='suppressed') AS suppressed,SUM(status='unknown') AS unknownCount
      FROM sx_email_campaign_recipients WHERE tenant_id=? AND campaign_id=?`,[item.tenantId,item.campaignId]);
    const pending=Number(counts.pending||0),sending=Number(counts.sending||0),accepted=Number(counts.accepted||0),failed=Number(counts.failed||0),suppressed=Number(counts.suppressed||0),unknown=Number(counts.unknownCount||0);
    const campaignStatus=pending||sending?(accepted?'sending':'queued'):unknown?'needs_review':accepted?'completed':failed?'failed':'completed';
    await db.query('UPDATE sx_email_campaigns SET status=?,accepted_count=?,failed_count=?,suppressed_count=? WHERE tenant_id=? AND id=?',[campaignStatus,accepted,failed,suppressed,item.tenantId,item.campaignId]);
    await db.commit();return {status:result.status};
  }catch(error){try{await db.rollback();}catch{}throw error;}finally{db.release();}
}

async function tick(pool,{key,origin,limit=8}={}){
  const items=await claim(pool,{limit}),providerCache=new Map();let providerConfig,providerErrorCode=null,sent=0,failed=0,suppressed=0,unknown=0,retried=0;
  try{const db=await pool.getConnection();try{providerConfig=await providerSettings.read(db,key);}finally{db.release();}if(!providerConfig.configured)providerErrorCode='AWS_CREDENTIALS_REQUIRED';}
  catch{providerConfig=null;providerErrorCode='AWS_CREDENTIALS_UNAVAILABLE';}
  for(const item of items){try{const result=await dispatch(pool,item,{key,origin,providerCache,credentials:providerConfig?.credentials||null,providerErrorCode});if(result.status==='accepted')sent++;else if(result.status==='failed')failed++;else if(result.status==='suppressed')suppressed++;else if(result.status==='unknown')unknown++;else if(result.status==='retry')retried++;}catch{await finish(pool,item,{status:'unknown',errorCode:'DELIVERY_OUTCOME_UNKNOWN'}).catch(()=>{});unknown++;}}
  return {claimed:items.length,sent,failed,suppressed,unknown,retried};
}
function start(pool,{key,origin,logger=console,setIntervalImpl=setInterval,clearIntervalImpl=clearInterval}={}){
  if(!pool||!Buffer.isBuffer(key)||key.length!==32||process.env.LOCAL_ONLY_MODE==='true')return ()=>{};
  let busy=false;
  const timer=setIntervalImpl(()=>{if(busy)return;busy=true;tick(pool,{key,origin}).catch(()=>logger.error('Email marketing worker tick failed.')).finally(()=>{busy=false;});},interval);
  timer.unref?.();return ()=>clearIntervalImpl(timer);
}

module.exports={claim,currentContact,personalize,unsubscribeUrl,dispatch,finish,tick,start};
