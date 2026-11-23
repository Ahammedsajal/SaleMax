'use strict';

const crypto=require('node:crypto');

function normalizedAddress(value){return String(value||'').trim().toLowerCase();}
function emailFingerprint(key,tenantId,email){
  if(!Buffer.isBuffer(key)||key.length!==32)throw Object.assign(Error('EMAIL_SUPPRESSION_KEY_UNAVAILABLE'),{code:'EMAIL_SUPPRESSION_KEY_UNAVAILABLE',status:503});
  const normalized=normalizedAddress(email);
  if(!normalized||!String(tenantId||''))throw Object.assign(Error('EMAIL_SUPPRESSION_INPUT_INVALID'),{code:'EMAIL_SUPPRESSION_INPUT_INVALID',status:400});
  const scopedKey=crypto.createHmac('sha256',key).update('7network/email-bounce-suppression:v1').digest();
  return crypto.createHmac('sha256',scopedKey).update(String(tenantId)+'\0'+normalized).digest('hex');
}
function redactAddress(value,email){
  const address=normalizedAddress(email);
  if(!address)return String(value||'');
  const escaped=address.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return String(value||'').replace(new RegExp(escaped,'gi'),'[email removed after bounce]');
}

async function isSuppressed(db,key,tenantId,email){
  const address=normalizedAddress(email);
  if(!address)return false;
  const fingerprint=emailFingerprint(key,tenantId,address);
  const [[row]]=await db.query('SELECT 1 AS blocked FROM sx_email_bounce_suppressions WHERE tenant_id=? AND email_fingerprint=? LIMIT 1',[tenantId,fingerprint]);
  return Boolean(row);
}

async function scrubBouncedAddress(db,{key,tenantId,email,bounceType='Permanent'}){
  const address=normalizedAddress(email);
  if(!address||!['Permanent','Transient','Undetermined'].includes(bounceType))return {removed:false};
  const fingerprint=emailFingerprint(key,tenantId,address);
  await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[tenantId]);
  const counts={removed:true,contactsCleared:0,recipientRowsCleared:0,threadsRedacted:0,messagesRedacted:0};
  await db.query(`INSERT INTO sx_email_bounce_suppressions(tenant_id,email_fingerprint,bounce_type,source)
    VALUES(?,?,?,'ses-event')
    ON DUPLICATE KEY UPDATE bounce_type=CASE
      WHEN bounce_type='Permanent' OR VALUES(bounce_type)='Permanent' THEN 'Permanent'
      WHEN bounce_type='Undetermined' OR VALUES(bounce_type)='Undetermined' THEN 'Undetermined'
      ELSE 'Transient' END,source='ses-event'`,
    [tenantId,fingerprint,bounceType]);

  await db.query(`UPDATE sx_email_messages m JOIN sx_email_threads t
      ON t.tenant_id=m.tenant_id AND t.id=m.thread_id
    SET m.delivery_status='failed',m.last_error_code='EMAIL_RECIPIENT_BOUNCED',m.updated_at=UTC_TIMESTAMP(3)
    WHERE m.tenant_id=? AND m.direction='outbound' AND m.delivery_status IN ('draft','queued')
      AND LOWER(TRIM(COALESCE(t.recipient_email,'')))=?`,[tenantId,address]);
  const [messages]=await db.query(`SELECT m.id,m.subject,m.text_body AS body
    FROM sx_email_messages m JOIN sx_email_threads t ON t.tenant_id=m.tenant_id AND t.id=m.thread_id
    LEFT JOIN sx_email_campaign_recipients r ON r.tenant_id=t.tenant_id AND r.campaign_id=t.campaign_id AND r.id=t.recipient_id
    WHERE m.tenant_id=? AND (LOWER(TRIM(COALESCE(t.recipient_email,'')))=? OR r.normalized_email=?)`,[tenantId,address,address]);
  for(const message of messages){
    const subject=redactAddress(message.subject,address),body=redactAddress(message.body,address);
    if(subject!==message.subject||body!==message.body){await db.query('UPDATE sx_email_messages SET subject=?,text_body=? WHERE tenant_id=? AND id=?',[subject,body,tenantId,message.id]);counts.messagesRedacted++;}
  }
  await db.query(`UPDATE sx_email_outbound_queue q JOIN sx_email_messages m
      ON m.tenant_id=q.tenant_id AND m.id=q.message_id
    JOIN sx_email_threads t ON t.tenant_id=m.tenant_id AND t.id=m.thread_id
    SET q.status='failed',q.last_error_code='EMAIL_RECIPIENT_BOUNCED',q.lease_expires_at=NULL
    WHERE q.tenant_id=? AND q.status IN ('queued','sending')
      AND LOWER(TRIM(COALESCE(t.recipient_email,'')))=?`,[tenantId,address]);
  const [threads]=await db.query(`UPDATE sx_email_threads SET recipient_email='',
      recipient_name=REPLACE(recipient_name,?,'[email removed after bounce]'),
      subject=REPLACE(subject,?,'[email removed after bounce]')
    WHERE tenant_id=? AND LOWER(TRIM(COALESCE(recipient_email,'')))=?`,[address,address,tenantId,address]);
  counts.threadsRedacted=Number(threads.affectedRows||0);
  await db.query(`UPDATE sx_email_messages SET from_email=''
    WHERE tenant_id=? AND direction='inbound' AND LOWER(TRIM(COALESCE(from_email,'')))=?`,[tenantId,address]);
  await db.query(`UPDATE sx_email_consent_events SET normalized_email=''
    WHERE tenant_id=? AND normalized_email=?`,[tenantId,address]);
  const [contacts]=await db.query(`UPDATE contact c
    JOIN user u ON u.uid=c.uid
    JOIN sx_legacy_ownership o ON o.source_table='user' AND o.tenant_id=? AND BINARY CAST(u.id AS CHAR)=BINARY o.source_id AND BINARY SHA2(u.uid,256)=BINARY o.legacy_uid_hash
    SET c.email='',c.name=REPLACE(c.name,?,'[email removed after bounce]'),c.email_marketing_consent=0,c.email_marketing_consent_at=NULL,c.email_marketing_consent_source=NULL
    WHERE LOWER(TRIM(COALESCE(c.email,'')))=?`,[tenantId,address,address]);
  counts.contactsCleared=Number(contacts.affectedRows||0);
  const [recipients]=await db.query(`UPDATE sx_email_campaign_recipients
    /* The table's unique address key requires a distinct non-email placeholder per bounced address. */
    SET email_fingerprint=?,recipient_email='',normalized_email=CONCAT('!bounced:',?),recipient_name=REPLACE(recipient_name,?,'[email removed after bounce]'),
        last_error_code=IF(status IN ('pending','sending'),'EMAIL_BOUNCED',last_error_code),
        status=IF(status IN ('pending','sending'),'suppressed',status),
        lease_owner=NULL,lease_expires_at=NULL
    WHERE tenant_id=? AND (normalized_email=? OR email_fingerprint=?)`,
    [fingerprint,fingerprint,address,tenantId,address,fingerprint]);
  counts.recipientRowsCleared=Number(recipients.affectedRows||0);
  await db.query('DELETE FROM sx_email_suppressions WHERE tenant_id=? AND normalized_email=?',[tenantId,address]);
  return counts;
}

async function migrateLegacyBounces(pool,key){
  const db=await pool.getConnection();
  const totals={migrated:true,legacyRowsProcessed:0,providerBounceRowsProcessed:0,contactsCleared:0,recipientRowsCleared:0,threadsRedacted:0,messagesRedacted:0};
  try{
    for(;;){
      await db.beginTransaction();
      try{
        const [rows]=await db.query(`SELECT tenant_id AS tenantId,normalized_email AS email
          FROM sx_email_suppressions WHERE reason='bounce' ORDER BY tenant_id,normalized_email LIMIT 25 FOR UPDATE`);
        const providerRows=rows.length?[]:await db.query(`SELECT r.tenant_id AS tenantId,r.recipient_email AS email
          FROM sx_email_campaign_recipients r
          WHERE r.recipient_email<>''
            AND EXISTS (SELECT 1 FROM sx_email_provider_events e
              WHERE e.tenant_id=r.tenant_id AND e.campaign_id=r.campaign_id AND e.recipient_id=r.id AND e.event_type='Bounce')
          ORDER BY r.tenant_id,r.campaign_id,r.id LIMIT 25 FOR UPDATE`).then(result=>result[0]);
        const batch=rows.length?rows:providerRows;
        if(!batch.length){await db.commit();return totals;}
        for(const row of batch){
          // Old provider-event rows did not retain SES bounceType; record those as undetermined.
          const result=await scrubBouncedAddress(db,{key,tenantId:row.tenantId,email:row.email,bounceType:'Undetermined'});
          if(rows.length)totals.legacyRowsProcessed++;
          else totals.providerBounceRowsProcessed++;
          for(const name of ['contactsCleared','recipientRowsCleared','threadsRedacted','messagesRedacted'])totals[name]+=result[name]||0;
        }
        await db.commit();
      }catch(error){try{await db.rollback();}catch{}throw error;}
    }
  }finally{db.release();}
}
module.exports={normalizedAddress,emailFingerprint,redactAddress,isSuppressed,scrubBouncedAddress,migrateLegacyBounces};
