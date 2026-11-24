'use strict';

const {normalizeEmail}=require('./email-marketing');
const bouncePrivacy=require('./email-marketing-bounce-privacy');
const reconciliation=require('./email-marketing-reconciliation');

const EVENT_TYPES=new Set(['Bounce','Complaint','Delivery','Send','Reject','Rendering Failure','DeliveryDelay','Subscription','Open','Click']);
const UUID=/^[-0-9a-f]{36}$/i;
const eventKind=event=>String(event?.eventType||event?.notificationType||'').trim().slice(0,32);
const sesMessageId=event=>String(event?.mail?.messageId||'').trim().slice(0,120)||null;
function tag(event,name){
  const value=event?.mail?.tags?.[name];
  return (Array.isArray(value)?value[0]:value)==null?'':String(Array.isArray(value)?value[0]:value).trim();
}
function eventRecipients(event,type){
  if(type==='Bounce')return Array.isArray(event?.bounce?.bouncedRecipients)?event.bounce.bouncedRecipients:[];
  if(type==='Complaint')return Array.isArray(event?.complaint?.complainedRecipients)?event.complaint.complainedRecipients:[];
  return [];
}
function suppressionReason(event,type){
  if(type==='Complaint')return 'complaint';
  if(type==='Bounce')return 'bounce';
  return null;
}
function normalizedBounceType(event){
  const value=String(event?.bounce?.bounceType||'');
  return ['Permanent','Transient','Undetermined'].includes(value)?value:'Undetermined';
}

async function persist(pool,{envelope,event,key}){
  const snsId=String(envelope?.MessageId||'').trim();
  if(!/^[A-Za-z0-9-]{1,128}$/.test(snsId))throw Object.assign(Error('SNS_MESSAGE_INVALID'),{code:'SNS_MESSAGE_INVALID',status:400});
  const type=eventKind(event);
  if(!type)throw Object.assign(Error('SES_EVENT_INVALID'),{code:'SES_EVENT_INVALID',status:400});
  const messageId=sesMessageId(event),campaignId=tag(event,'campaign_id'),recipientId=tag(event,'recipient_id');
  const hasScopedTags=UUID.test(campaignId)&&UUID.test(recipientId);
  const reason=suppressionReason(event,type),reportedRecipients=eventRecipients(event,type);
  const reportedEmails=new Set(reportedRecipients.map(row=>normalizeEmail(row?.emailAddress||'')).filter(Boolean));
  const db=await pool.getConnection();
  try{
    await db.beginTransaction();
    try{
      await db.query('INSERT INTO sx_email_provider_events(sns_message_id,event_type,provider_message_id,tenant_id,campaign_id,recipient_id) VALUES(?,?,?,?,?,?)',
        [snsId,type,messageId,null,null,null]);
    }catch(error){
      if(error?.code==='ER_DUP_ENTRY'){await db.commit();return {accepted:true,duplicate:true,processed:false};}
      throw error;
    }

    let matched=null;
    if(EVENT_TYPES.has(type)&&hasScopedTags){
      const [[row]]=await db.query('SELECT id,tenant_id,campaign_id,recipient_email,normalized_email,email_fingerprint,provider_message_id FROM sx_email_campaign_recipients WHERE id=? AND campaign_id=? LIMIT 1 FOR UPDATE',[recipientId,campaignId]);
      if(row&&(!messageId||!row.provider_message_id||row.provider_message_id===messageId)){
        matched=row;
        const storedValue=String(row.recipient_email||row.normalized_email||'');
        const storedEmail=storedValue.startsWith('!bounced:')?'':normalizeEmail(storedValue);
        const reportedMatches=!reportedEmails.size||[...reportedEmails].some(email=>
          (storedEmail&&email===storedEmail)||(row.email_fingerprint&&bouncePrivacy.emailFingerprint(key,row.tenant_id,email)===row.email_fingerprint));
        // Authenticated SES tags plus the provider message ID bind Bounce to this
        // individual recipient row; some valid DSNs report an alias address.
        if(reason==='bounce'||(reason==='complaint'&&reportedMatches)){
          if(reason==='bounce'){
            const bounceType=normalizedBounceType(event);
            if(storedEmail)await bouncePrivacy.scrubBouncedAddress(db,{key,tenantId:row.tenant_id,email:storedEmail,bounceType});
            else if(row.email_fingerprint){
              await db.query(`INSERT INTO sx_email_bounce_suppressions(tenant_id,email_fingerprint,bounce_type,source)
                VALUES(?,?,?,'ses-event') ON DUPLICATE KEY UPDATE bounce_type=CASE
                  WHEN bounce_type='Permanent' OR VALUES(bounce_type)='Permanent' THEN 'Permanent'
                  WHEN bounce_type='Undetermined' OR VALUES(bounce_type)='Undetermined' THEN 'Undetermined'
                  ELSE 'Transient' END,source='ses-event'`,
                [row.tenant_id,row.email_fingerprint,bounceType]);
            }
          }else if(storedEmail){
            await db.query(`INSERT INTO sx_email_suppressions(tenant_id,normalized_email,reason,source)
              VALUES(?,?,?,'ses-event')
              ON DUPLICATE KEY UPDATE reason=CASE
                WHEN reason='unsubscribe' THEN reason
                WHEN VALUES(reason)='complaint' THEN 'complaint'
                ELSE reason END,source=IF(reason='unsubscribe',source,VALUES(source))`,
              [row.tenant_id,storedEmail,reason]);
          }
        }
      }
    }
    if(matched){
      await db.query('UPDATE sx_email_provider_events SET tenant_id=?,campaign_id=?,recipient_id=? WHERE sns_message_id=?',
        [matched.tenant_id,matched.campaign_id,matched.id,snsId]);
      if(type==='Send'||type==='Delivery'){
        const timestamp=type==='Delivery'?event?.delivery?.timestamp:event?.mail?.timestamp;
        const parsedAt=timestamp?new Date(timestamp):null,confirmedAt=parsedAt&&!Number.isNaN(parsedAt.getTime())?parsedAt:null;
        await reconciliation.reconcileConfirmedRecipient(db,{tenantId:matched.tenant_id,campaignId:matched.campaign_id,recipientId:matched.id,providerMessageId:messageId,confirmedAt});
      }
    }
    await db.commit();
    return {accepted:true,duplicate:false,processed:Boolean(matched),eventType:type};
  }catch(error){try{await db.rollback();}catch{}throw error;}
  finally{db.release();}
}

module.exports={EVENT_TYPES,eventKind,eventRecipients,suppressionReason,persist};
