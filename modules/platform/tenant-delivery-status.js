'use strict';

function requireOwnerUid(uid){
  if(typeof uid!=='string'||uid.trim()==='')throw new TypeError('DELIVERY_STATUS_OWNER_REQUIRED');
  return uid;
}

async function updateApiLogStatus({query,uid,messageId,status,errorData=null}){
  requireOwnerUid(uid);
  if(typeof messageId!=='string'||messageId==='')return {affectedRows:0};
  if(status==='failed')return query(
    'UPDATE beta_api_logs SET status = ?, err = ? WHERE uid = ? AND msg_id = ?',
    [status,errorData,uid,messageId],
  );
  return query(
    'UPDATE beta_api_logs SET status = ? WHERE uid = ? AND msg_id = ?',
    [status,uid,messageId],
  );
}

async function findCampaignLog({query,uid,messageId}){
  requireOwnerUid(uid);
  if(typeof messageId!=='string'||messageId==='')return null;
  const rows=await query(
    'SELECT campaign_id, delivery_status FROM beta_campaign_logs WHERE uid = ? AND meta_msg_id = ? LIMIT 1',
    [uid,messageId],
  );
  return rows?.[0]||null;
}

async function updateCampaignLogStatus({query,uid,messageId,status,errorData=null}){
  requireOwnerUid(uid);
  if(typeof messageId!=='string'||messageId==='')return {affectedRows:0};
  if(status==='failed')return query(
    'UPDATE beta_campaign_logs SET delivery_status = ?, delivery_time = NOW(), error_message = ? WHERE uid = ? AND meta_msg_id = ?',
    [status,errorData,uid,messageId],
  );
  return query(
    'UPDATE beta_campaign_logs SET delivery_status = ?, delivery_time = NOW() WHERE uid = ? AND meta_msg_id = ?',
    [status,uid,messageId],
  );
}

async function updateWebhookStatuses({query,uid,statuses,body,updateCampaignMessageStatus}){
  requireOwnerUid(uid);
  if(!Array.isArray(statuses)||statuses.length===0)return;
  if(typeof updateCampaignMessageStatus!=='function')throw new TypeError('CAMPAIGN_STATUS_UPDATER_REQUIRED');
  const errorData=JSON.stringify(body);
  for(const item of statuses){
    if(typeof item?.id!=='string'||!item.id)continue;
    const details=item.status==='failed'?errorData:null;
    const campaignLog=await findCampaignLog({query,uid,messageId:item.id});
    if(campaignLog&&!(campaignLog.delivery_status==='read'&&item.status==='delivered')){
      // The campaign worker refreshes counters; this direct scoped update keeps
      // the callback status even if that best-effort worker path fails.
      await updateCampaignMessageStatus(uid,item.id,item.status,details);
      await updateCampaignLogStatus({query,uid,messageId:item.id,status:item.status,errorData:details});
    }
    await updateApiLogStatus({query,uid,messageId:item.id,status:item.status,errorData:details});
  }
}

module.exports={updateApiLogStatus,findCampaignLog,updateCampaignLogStatus,updateWebhookStatuses};
