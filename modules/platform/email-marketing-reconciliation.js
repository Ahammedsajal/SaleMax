'use strict';

async function refreshCampaignStatus(db,tenantId,campaignId){
  const [[counts]]=await db.query(`SELECT SUM(status='pending') AS pending,SUM(status='sending') AS sending,
      SUM(status='accepted') AS accepted,SUM(status='failed') AS failed,SUM(status='suppressed') AS suppressed,
      SUM(status='unknown') AS unknownCount FROM sx_email_campaign_recipients WHERE tenant_id=? AND campaign_id=?`,[tenantId,campaignId]);
  const pending=Number(counts.pending||0),sending=Number(counts.sending||0),accepted=Number(counts.accepted||0),failed=Number(counts.failed||0),suppressed=Number(counts.suppressed||0),unknown=Number(counts.unknownCount||0);
  const status=pending||sending?(accepted?'sending':'queued'):unknown?'needs_review':accepted?'completed':failed?'failed':'completed';
  await db.query('UPDATE sx_email_campaigns SET status=?,accepted_count=?,failed_count=?,suppressed_count=? WHERE tenant_id=? AND id=?',[status,accepted,failed,suppressed,tenantId,campaignId]);
  return {status,accepted,failed,suppressed,unknown};
}

async function reconcileConfirmedRecipient(db,{tenantId,campaignId,recipientId,providerMessageId=null,confirmedAt=null}){
  const [updated]=await db.query(`UPDATE sx_email_campaign_recipients SET status='accepted',provider_message_id=COALESCE(provider_message_id,?),
      accepted_at=COALESCE(accepted_at,?,UTC_TIMESTAMP(3)),last_error_code=NULL,lease_owner=NULL,lease_expires_at=NULL
    WHERE tenant_id=? AND campaign_id=? AND id=? AND status='unknown'`,[providerMessageId,confirmedAt,tenantId,campaignId,recipientId]);
  if(!updated.affectedRows)return false;
  const [[thread]]=await db.query('SELECT id FROM sx_email_threads WHERE tenant_id=? AND campaign_id=? AND recipient_id=? LIMIT 1',[tenantId,campaignId,recipientId]);
  if(thread){
    await db.query(`UPDATE sx_email_messages SET provider_message_id=COALESCE(provider_message_id,?),delivery_status='sent',
        sent_at=COALESCE(sent_at,?,UTC_TIMESTAMP(3)),last_error_code=NULL,updated_at=UTC_TIMESTAMP(3)
      WHERE tenant_id=? AND thread_id=? AND direction='outbound' AND delivery_status='uncertain'`,[providerMessageId,confirmedAt,tenantId,thread.id]);
    await db.query(`UPDATE sx_email_threads SET last_message_at=GREATEST(last_message_at,COALESCE(?,UTC_TIMESTAMP(3)))
      WHERE tenant_id=? AND id=?`,[confirmedAt,tenantId,thread.id]);
  }
  await refreshCampaignStatus(db,tenantId,campaignId);
  return true;
}

async function reconcileCampaignFromEvents(db,tenantId,campaignId){
  const [rows]=await db.query(`SELECT r.id AS recipientId,MAX(e.provider_message_id) AS providerMessageId,MIN(e.created_at) AS confirmedAt
    FROM sx_email_campaign_recipients r JOIN sx_email_provider_events e
      ON e.tenant_id=r.tenant_id AND e.campaign_id=r.campaign_id AND e.recipient_id=r.id
    WHERE r.tenant_id=? AND r.campaign_id=? AND r.status='unknown' AND e.event_type IN ('Send','Delivery')
    GROUP BY r.id ORDER BY r.id`,[tenantId,campaignId]);
  let reconciled=0;
  for(const row of rows)if(await reconcileConfirmedRecipient(db,{tenantId,campaignId,recipientId:row.recipientId,providerMessageId:row.providerMessageId,confirmedAt:row.confirmedAt}))reconciled++;
  const state=await refreshCampaignStatus(db,tenantId,campaignId);
  return {reconciled,unresolved:state.unknown,status:state.status,accepted:state.accepted};
}

module.exports={refreshCampaignStatus,reconcileConfirmedRecipient,reconcileCampaignFromEvents};
