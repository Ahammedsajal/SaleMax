'use strict';

const crypto=require('node:crypto');
const service=require('./email-marketing');
const ses=require('./email-marketing-ses');
const inbound=require('./email-marketing-inbound');
const providerSettings=require('./email-marketing-provider-settings');

const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const uuid=()=>crypto.randomUUID();
const cleanSubject=value=>{
  if(typeof value!=='string')fail('INVALID_EMAIL_SUBJECT');
  const subject=value.trim();
  if(!subject||subject.length>998||/[\r\n\x00-\x1f\x7f]/.test(subject))fail('INVALID_EMAIL_SUBJECT');
  return subject;
};
const cleanBody=value=>{
  if(typeof value!=='string'||value.length>30000)fail('INVALID_EMAIL_TEXT');
  return value.trim();
};
const cleanName=value=>String(value||'').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,200);
const validMessageId=value=>typeof value==='string'&&/^\d{1,20}$/.test(value);

async function senderFor(db,tenantId,senderId){
  if(typeof senderId!=='string'||!/^[-0-9a-f]{36}$/i.test(senderId))fail('INVALID_EMAIL_SENDER_ID');
  const [[sender]]=await db.query(`SELECT s.id,s.email,s.verification_status AS senderStatus,d.region,
      d.verification_status AS domainStatus,d.dkim_status AS dkimStatus
    FROM sx_email_senders s JOIN sx_email_sender_domains d ON d.tenant_id=s.tenant_id AND d.id=s.domain_id
    WHERE s.tenant_id=? AND s.id=?`,[tenantId,senderId]);
  if(!sender)fail('EMAIL_SENDER_NOT_FOUND',404);
  if(sender.senderStatus!=='verified'||sender.domainStatus!=='verified'||sender.dkimStatus!=='SUCCESS')fail('EMAIL_SENDER_NOT_VERIFIED',409);
  return sender;
}

async function saveDraft(db,ctx,input){
  service.emailMarketingAccess(ctx.context);
  if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_EMAIL_DRAFT');
  const messageId=input.messageId==null?null:String(input.messageId),threadId=input.threadId==null?null:String(input.threadId);
  if(messageId&&!validMessageId(messageId))fail('INVALID_EMAIL_DRAFT_ID');
  if(threadId&&!/^[-0-9a-f]{36}$/i.test(threadId))fail('INVALID_EMAIL_THREAD_ID');
  const attachmentIds=Array.isArray(input.attachmentIds)?input.attachmentIds:[];
  if(attachmentIds.length>service.MAX_ATTACHMENTS)fail('INVALID_ATTACHMENT_SELECTION');
  const body=cleanBody(input.text||''),name=cleanName(input.name);
  const requestedTo=input.to==null?'':service.cleanEmail(input.to,true);
  const requestedSubject=input.subject==null?'':String(input.subject).trim();
  if(requestedSubject.length>998||/[\r\n\x00-\x1f\x7f]/.test(requestedSubject))fail('INVALID_EMAIL_SUBJECT');

  await db.beginTransaction();
  try{
    let message=null,thread=null;
    if(messageId){
      const [[row]]=await db.query(`SELECT m.id,m.thread_id AS threadId,m.draft_revision AS revision,m.delivery_status AS deliveryStatus,
          t.campaign_id AS campaignId,t.recipient_id AS recipientId,t.sender_id AS senderId,t.recipient_email AS email,
          t.recipient_name AS name,t.subject AS threadSubject,c.sender_id AS campaignSenderId
        FROM sx_email_messages m JOIN sx_email_threads t ON t.tenant_id=m.tenant_id AND t.id=m.thread_id
        LEFT JOIN sx_email_campaigns c ON c.tenant_id=t.tenant_id AND c.id=t.campaign_id
        WHERE m.tenant_id=? AND m.id=? AND m.direction='outbound' FOR UPDATE`,[ctx.tenantId,messageId]);
      if(!row||row.deliveryStatus!=='draft')fail('EMAIL_DRAFT_NOT_FOUND',404);
      if(!Number.isSafeInteger(input.revision)||Number(input.revision)!==Number(row.revision))fail('EMAIL_DRAFT_CONFLICT',409);
      if(threadId&&threadId!==row.threadId)fail('EMAIL_THREAD_MISMATCH',409);
      thread=row;message=row;
    }else if(threadId){
      const [[row]]=await db.query(`SELECT t.id AS threadId,t.campaign_id AS campaignId,t.recipient_id AS recipientId,t.sender_id AS senderId,
          t.recipient_email AS email,t.recipient_name AS name,t.subject AS threadSubject,c.sender_id AS campaignSenderId
        FROM sx_email_threads t LEFT JOIN sx_email_campaigns c ON c.tenant_id=t.tenant_id AND c.id=t.campaign_id
        WHERE t.tenant_id=? AND t.id=? FOR UPDATE`,[ctx.tenantId,threadId]);
      if(!row)fail('EMAIL_THREAD_NOT_FOUND',404);
      thread=row;
    }

    const effectiveSenderId=thread?.campaignSenderId||thread?.senderId||String(input.senderId||'');
    const sender=await senderFor(db,ctx.tenantId,effectiveSenderId);
    let recipient=requestedTo||thread?.email;
    if(thread&&(!recipient||service.cleanEmail(recipient,true)!==service.cleanEmail(thread.email,true)))fail('EMAIL_THREAD_RECIPIENT_LOCKED',409);
    recipient=service.cleanEmail(recipient,true);
    const recipientName=thread?.name||name;
    const subject=requestedSubject||thread?.threadSubject||'';
    const attachments=await service.loadAttachments(db,ctx.tenantId,attachmentIds);
    if(attachments.reduce((sum,file)=>sum+file.size,0)>service.MAX_TOTAL_ATTACHMENT_BYTES)fail('ATTACHMENT_TOTAL_TOO_LARGE');

    let id=messageId,selectedThreadId=thread?.threadId||threadId;
    if(!selectedThreadId){
      selectedThreadId=uuid();
      await db.query(`INSERT INTO sx_email_threads(id,tenant_id,campaign_id,recipient_id,contact_id,sender_id,recipient_email,recipient_name,subject,last_message_at)
        VALUES(?,?,NULL,NULL,NULL,?,?,?,?,UTC_TIMESTAMP(3))`,[selectedThreadId,ctx.tenantId,sender.id,recipient,recipientName,subject||'(no subject)']);
    }else if(!thread.campaignId){
      await db.query(`UPDATE sx_email_threads SET recipient_email=?,recipient_name=?,sender_id=?,subject=?,last_message_at=UTC_TIMESTAMP(3)
        WHERE tenant_id=? AND id=?`,[recipient,recipientName,sender.id,subject||'(no subject)',ctx.tenantId,selectedThreadId]);
    }else{
      await db.query('UPDATE sx_email_threads SET last_message_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?',[ctx.tenantId,selectedThreadId]);
    }

    if(messageId){
      const [result]=await db.query(`UPDATE sx_email_messages SET sender_email=?,subject=?,text_body=?,draft_revision=draft_revision+1,updated_at=UTC_TIMESTAMP(3)
        WHERE tenant_id=? AND id=? AND delivery_status='draft' AND draft_revision=?`,[sender.email,subject||'(no subject)',body,ctx.tenantId,messageId,input.revision]);
      if(!result.affectedRows)fail('EMAIL_DRAFT_CONFLICT',409);
    }else{
      const [result]=await db.query(`INSERT INTO sx_email_messages(tenant_id,thread_id,direction,sender_email,subject,text_body,delivery_status,draft_revision)
        VALUES(?,?,'outbound',?,?,?,'draft',1)`,[ctx.tenantId,selectedThreadId,sender.email,subject||'(no subject)',body]);
      id=String(result.insertId);
    }

    await db.query('DELETE FROM sx_email_message_attachments WHERE tenant_id=? AND message_id=?',[ctx.tenantId,id]);
    for(const file of attachments)await db.query('INSERT INTO sx_email_message_attachments(tenant_id,message_id,attachment_id) VALUES(?,?,?)',[ctx.tenantId,id,file.id]);
    if(attachments.length)await db.query('UPDATE sx_email_attachments SET expires_at=NULL WHERE tenant_id=? AND id IN (?)',[ctx.tenantId,attachments.map(file=>file.id)]);
    await service.audit(db,ctx,messageId?'email.message.draft-updated':'email.message.draft-created','email-message',id,{threadId:selectedThreadId,attachmentCount:attachments.length});
    await db.commit();
    return {messageId:String(id),threadId:selectedThreadId,revision:Number(message?.revision||0)+1,status:'draft'};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}

async function deleteDraft(db,ctx,messageId){
  service.emailMarketingAccess(ctx.context);
  if(!validMessageId(String(messageId||'')))fail('INVALID_EMAIL_DRAFT_ID');
  await db.beginTransaction();
  try{
    const [[row]]=await db.query(`SELECT thread_id AS threadId FROM sx_email_messages
      WHERE tenant_id=? AND id=? AND direction='outbound' AND delivery_status='draft' FOR UPDATE`,[ctx.tenantId,messageId]);
    if(!row)fail('EMAIL_DRAFT_NOT_FOUND',404);
    await db.query('DELETE FROM sx_email_message_attachments WHERE tenant_id=? AND message_id=?',[ctx.tenantId,messageId]);
    await db.query('DELETE FROM sx_email_messages WHERE tenant_id=? AND id=? AND delivery_status=\'draft\'',[ctx.tenantId,messageId]);
    const [[remaining]]=await db.query('SELECT COUNT(*) AS total,MAX(COALESCE(sent_at,created_at)) AS lastMessageAt FROM sx_email_messages WHERE tenant_id=? AND thread_id=?',[ctx.tenantId,row.threadId]);
    if(Number(remaining.total)===0){
      await db.query('DELETE FROM sx_email_threads WHERE tenant_id=? AND id=? AND campaign_id IS NULL',[ctx.tenantId,row.threadId]);
    }else{
      await db.query('UPDATE sx_email_threads SET last_message_at=COALESCE(?,last_message_at) WHERE tenant_id=? AND id=?',[remaining.lastMessageAt,ctx.tenantId,row.threadId]);
    }
    await service.audit(db,ctx,'email.message.draft-deleted','email-message',messageId,{threadId:row.threadId});
    await db.commit();return {deleted:true,threadId:row.threadId};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}

async function sendDraft(db,ctx,messageId,key){
  service.emailMarketingAccess(ctx.context);
  if(!validMessageId(String(messageId||'')))fail('INVALID_EMAIL_DRAFT_ID');
  const config=await providerSettings.read(db,key);if(!config.configured)fail('AWS_CREDENTIALS_REQUIRED',503);
  await db.beginTransaction();
  try{
    const [[row]]=await db.query(`SELECT m.id,m.thread_id AS threadId,m.subject,m.text_body AS text,m.delivery_status AS deliveryStatus,
        t.tenant_id AS tenantId,t.campaign_id AS campaignId,t.recipient_id AS recipientId,t.sender_id AS threadSenderId,
        t.recipient_email AS recipientEmail,t.recipient_name AS recipientName,c.sender_id AS campaignSenderId
      FROM sx_email_messages m JOIN sx_email_threads t ON t.tenant_id=m.tenant_id AND t.id=m.thread_id
      LEFT JOIN sx_email_campaigns c ON c.tenant_id=t.tenant_id AND c.id=t.campaign_id
      WHERE m.tenant_id=? AND m.id=? AND m.direction='outbound' FOR UPDATE`,[ctx.tenantId,messageId]);
    if(!row||row.deliveryStatus!=='draft')fail('EMAIL_DRAFT_NOT_FOUND',404);
    if(!String(row.text||'').trim())fail('INVALID_EMAIL_TEXT');
    if(!String(row.subject||'').trim()||String(row.subject).trim()==='(no subject)')fail('INVALID_EMAIL_SUBJECT');
    cleanSubject(row.subject);
    const senderId=row.campaignSenderId||row.threadSenderId;
    const sender=await senderFor(db,ctx.tenantId,senderId);
    const recipient=service.cleanEmail(row.recipientEmail,true);
    if(!row.campaignId){
      const [[suppressed]]=await db.query('SELECT id FROM sx_email_suppressions WHERE tenant_id=? AND normalized_email=? LIMIT 1',[ctx.tenantId,recipient]);
      if(suppressed)fail('EMAIL_RECIPIENT_SUPPRESSED',409);
    }
    const [files]=await db.query(`SELECT a.id,a.file_name AS fileName,a.content_type AS contentType,a.size_bytes AS size,a.content
      FROM sx_email_message_attachments x JOIN sx_email_attachments a ON a.tenant_id=x.tenant_id AND a.id=x.attachment_id
      WHERE x.tenant_id=? AND x.message_id=? ORDER BY a.file_name`,[ctx.tenantId,messageId]);
    if(files.length>service.MAX_ATTACHMENTS||files.reduce((sum,file)=>sum+Number(file.size),0)>service.MAX_TOTAL_ATTACHMENT_BYTES)fail('ATTACHMENT_TOTAL_TOO_LARGE');
    const [[inboundDomain]]=await db.query(`SELECT i.reply_domain AS replyDomain FROM sx_email_inbound_domains i
      JOIN sx_email_senders s ON s.tenant_id=i.tenant_id AND s.domain_id=i.sender_domain_id
      WHERE i.tenant_id=? AND s.id=? AND i.verification_status='verified' AND i.mx_verified_at IS NOT NULL AND i.receiving_status='active' LIMIT 1`,[ctx.tenantId,sender.id]);
    let replyToEmail=null;
    if(inboundDomain?.replyDomain){
      const token=row.campaignId&&row.recipientId
        ?inbound.replyToken(key,ctx.tenantId,row.campaignId,row.recipientId)
        :inbound.threadReplyToken(key,ctx.tenantId,row.threadId);
      replyToEmail=`${token}@${inboundDomain.replyDomain}`;
    }else{
      const [[replySettings]]=await db.query('SELECT reply_to_email AS replyToEmail FROM sx_email_marketing_settings WHERE tenant_id=?',[ctx.tenantId]);
      replyToEmail=replySettings?.replyToEmail||null;
    }
    const [[lastInbound]]=await db.query(`SELECT provider_message_id AS providerMessageId FROM sx_email_messages
      WHERE tenant_id=? AND thread_id=? AND direction='inbound' AND provider_message_id IS NOT NULL ORDER BY COALESCE(sent_at,created_at) DESC,id DESC LIMIT 1`,[ctx.tenantId,row.threadId]);
    const references=String(lastInbound?.providerMessageId||'').replace(/[\r\n<>]/g,'').slice(0,120);
    const queueId=uuid();
    const [updated]=await db.query(`UPDATE sx_email_messages SET delivery_status='queued',draft_revision=draft_revision+1,updated_at=UTC_TIMESTAMP(3)
      WHERE tenant_id=? AND id=? AND delivery_status='draft'`,[ctx.tenantId,messageId]);
    if(!updated.affectedRows)fail('EMAIL_DRAFT_CONFLICT',409);
    await db.query(`INSERT INTO sx_email_outbound_queue(id,tenant_id,message_id,sender_id,reply_to_email)
      VALUES(?,?,?,?,?)`,[queueId,ctx.tenantId,messageId,sender.id,replyToEmail]);
    await db.query('UPDATE sx_email_threads SET last_message_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?',[ctx.tenantId,row.threadId]);
    await service.audit(db,ctx,'email.message.queued','email-message',messageId,{threadId:row.threadId,attachmentCount:files.length,hasReplyRouting:Boolean(inboundDomain)});
    await db.commit();
    return {queued:true,messageId:String(messageId),threadId:row.threadId,replyRouting:Boolean(inboundDomain),hasInReplyTo:Boolean(references)};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}

async function claimQueue(pool,{limit=8}={}){
  const db=await pool.getConnection();
  try{
    await db.beginTransaction();
    await db.query(`UPDATE sx_email_outbound_queue q JOIN sx_email_messages m ON m.tenant_id=q.tenant_id AND m.id=q.message_id
      SET q.status='uncertain',q.last_error_code='DELIVERY_OUTCOME_UNKNOWN',q.lease_expires_at=NULL,
          m.delivery_status='uncertain',m.updated_at=UTC_TIMESTAMP(3)
      WHERE q.status='sending' AND q.lease_expires_at<=UTC_TIMESTAMP(3)`);
    const [rows]=await db.query(`SELECT q.id AS queueId,q.tenant_id AS tenantId,q.message_id AS messageId,q.sender_id AS senderId,
        q.reply_to_email AS replyToEmail,m.thread_id AS threadId,m.subject,m.text_body AS text,t.recipient_email AS recipientEmail,
        s.email AS senderEmail,s.verification_status AS senderStatus,d.region,d.verification_status AS domainStatus,d.dkim_status AS dkimStatus
      FROM sx_email_outbound_queue q JOIN sx_email_messages m ON m.tenant_id=q.tenant_id AND m.id=q.message_id
      JOIN sx_email_threads t ON t.tenant_id=m.tenant_id AND t.id=m.thread_id
      JOIN sx_email_senders s ON s.tenant_id=q.tenant_id AND s.id=q.sender_id
      JOIN sx_email_sender_domains d ON d.tenant_id=s.tenant_id AND d.id=s.domain_id
      WHERE q.status='queued' AND q.available_at<=UTC_TIMESTAMP(3)
      ORDER BY q.available_at,q.created_at,q.id LIMIT ? FOR UPDATE SKIP LOCKED`,[Math.max(1,Math.min(32,Number(limit)||8))]);
    for(const row of rows){
      await db.query(`UPDATE sx_email_outbound_queue SET status='sending',attempts=attempts+1,lease_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 5 MINUTE)
        WHERE id=? AND status='queued'`,[row.queueId]);
      await db.query(`UPDATE sx_email_messages SET delivery_status='sending',updated_at=UTC_TIMESTAMP(3)
        WHERE tenant_id=? AND id=? AND delivery_status='queued'`,[row.tenantId,row.messageId]);
    }
    await db.commit();return rows;
  }catch(error){try{await db.rollback();}catch{}throw error;}
  finally{db.release();}
}

async function finishQueue(pool,item,{status,errorCode=null,messageId=null,delaySeconds=0}={}){
  const db=await pool.getConnection();
  try{
    await db.beginTransaction();
    const queueStatus=status==='retry'?'queued':status;
    const messageStatus=status==='retry'?'queued':status;
    await db.query(`UPDATE sx_email_outbound_queue SET status=?,last_error_code=?,provider_message_id=COALESCE(?,provider_message_id),
        sent_at=IF(?='sent',UTC_TIMESTAMP(3),sent_at),lease_expires_at=NULL,
        available_at=IF(?='queued',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),available_at)
      WHERE id=? AND status='sending'`,[queueStatus,errorCode,messageId,queueStatus,queueStatus,Math.max(30,Number(delaySeconds)||30),item.queueId]);
    await db.query(`UPDATE sx_email_messages SET delivery_status=?,provider_message_id=COALESCE(?,provider_message_id),
        sent_at=IF(?='sent',UTC_TIMESTAMP(3),sent_at),updated_at=UTC_TIMESTAMP(3)
      WHERE tenant_id=? AND id=?`,[messageStatus,messageId,messageStatus,item.tenantId,item.messageId]);
    await db.commit();return {status:queueStatus};
  }catch(error){try{await db.rollback();}catch{}throw error;}
  finally{db.release();}
}

async function processQueue(pool,{credentials=null,configurationSetName=null,limit=8,send=ses.sendSimple,accountCache=new Map()}={}){
  if(!credentials)return {claimed:0,sent:0,failed:0,uncertain:0,retried:0};
  const items=await claimQueue(pool,{limit});
  let sent=0,failed=0,uncertain=0,retried=0;
  for(const item of items){
    try{
      if(item.senderStatus!=='verified'||item.domainStatus!=='verified'||item.dkimStatus!=='SUCCESS'){
        await finishQueue(pool,item,{status:'failed',errorCode:'EMAIL_SENDER_NOT_VERIFIED'});failed++;continue;
      }
      const db=await pool.getConnection();let files,lastInbound;
      try{
        const [rows]=await db.query(`SELECT a.id,a.file_name AS fileName,a.content_type AS contentType,a.content
          FROM sx_email_message_attachments x JOIN sx_email_attachments a ON a.tenant_id=x.tenant_id AND a.id=x.attachment_id
          WHERE x.tenant_id=? AND x.message_id=? ORDER BY a.file_name`,[item.tenantId,item.messageId]);
        files=rows.map(file=>({...file,content:Buffer.from(file.content)}));
        const [[last]]=await db.query(`SELECT provider_message_id AS providerMessageId FROM sx_email_messages
          WHERE tenant_id=? AND thread_id=? AND direction='inbound' AND provider_message_id IS NOT NULL
          ORDER BY COALESCE(sent_at,created_at) DESC,id DESC LIMIT 1`,[item.tenantId,item.threadId]);
        lastInbound=String(last?.providerMessageId||'').replace(/[\r\n<>]/g,'').slice(0,120);
      }finally{db.release();}
      let account=accountCache.get(item.region);
      if(!account){account=await ses.getAccount(item.region,credentials);account.localAccepted=0;accountCache.set(item.region,account);}
      if(!account.sendingEnabled){await finishQueue(pool,item,{status:'failed',errorCode:'SES_SENDING_DISABLED'});failed++;continue;}
      if(!account.productionAccessEnabled){await finishQueue(pool,item,{status:'failed',errorCode:'SES_PRODUCTION_ACCESS_REQUIRED'});failed++;continue;}
      if(Number(account.localAccepted||0)>=Math.max(1,Number(account.maxSendRate||1))){await finishQueue(pool,item,{status:'retry',errorCode:'SES_RATE_LIMITED',delaySeconds:2});retried++;continue;}
      const simple={Subject:{Data:item.subject,Charset:'UTF-8'},Body:{Text:{Data:item.text,Charset:'UTF-8'}}};
      if(files.length)simple.Attachments=files.map(file=>({FileName:file.fileName,ContentType:file.contentType,ContentDisposition:'ATTACHMENT',ContentTransferEncoding:'BASE64',RawContent:file.content}));
      if(lastInbound)simple.Headers=[{Name:'In-Reply-To',Value:`<${lastInbound}>`},{Name:'References',Value:`<${lastInbound}>`}];
      const message={FromEmailAddress:item.senderEmail,Destination:{ToAddresses:[item.recipientEmail]},
        Content:{Simple:simple},EmailTags:[{Name:'email_message_id',Value:String(item.messageId)},{Name:'email_thread_id',Value:String(item.threadId)}]};
      if(item.replyToEmail)message.ReplyToAddresses=[item.replyToEmail];
      if(configurationSetName)message.ConfigurationSetName=configurationSetName;
      const result=await send(item.region,message,credentials);
      account.localAccepted=Number(account.localAccepted||0)+1;
      await finishQueue(pool,item,{status:'sent',messageId:result.messageId||null});sent++;
    }catch(error){
      const code=ses.publicCode(error);
      if(code==='SES_THROTTLED'){
        await finishQueue(pool,item,{status:'retry',errorCode:code,delaySeconds:60});retried++;
      }else if(error?.$metadata?.httpStatusCode>=400&&error.$metadata.httpStatusCode<500){
        await finishQueue(pool,item,{status:'failed',errorCode:code});failed++;
      }else{
        await finishQueue(pool,item,{status:'uncertain',errorCode:'DELIVERY_OUTCOME_UNKNOWN'});uncertain++;
      }
    }
  }
  return {claimed:items.length,sent,failed,uncertain,retried};
}

module.exports={saveDraft,deleteDraft,sendDraft,claimQueue,finishQueue,processQueue};
