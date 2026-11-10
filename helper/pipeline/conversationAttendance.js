'use strict';
const crypto=require('node:crypto');
const sha=value=>crypto.createHash('sha256').update(String(value)).digest('hex');

async function recordReply({uid,chatId,origin,providerMessageId,actorType,actorId,activityType,summary,query}={}){
  if(require('../../modules/platform/qr-inbox-groups').isGroup({chatId}))return false;
  const messageId=String(providerMessageId||'').trim().slice(0,191),actor=String(actorId||'').trim().slice(0,191);
  if(typeof query!=='function'||typeof uid!=='string'||!uid||typeof chatId!=='string'||!chatId||!actor||!['qr','meta'].includes(origin)||!messageId||!['agent','user'].includes(actorType)||!['agent_message_sent','workspace_message_sent'].includes(activityType))return false;
  const uidHash=sha(uid),[leads]=await query(`SELECT lead_id FROM pipeline_conversations WHERE uid_hash=? AND uid=? AND chat_id=? AND origin=? ORDER BY last_inbound_at DESC LIMIT 1`,[uidHash,uid,chatId,origin]);
  if(!leads?.length)return false;
  const leadId=leads[0].lead_id,details=JSON.stringify({origin,providerMessageId:messageId});
  const [existing]=await query(`SELECT id FROM pipeline_activity WHERE uid_hash=? AND lead_id=? AND activity_type IN ('agent_message_sent','workspace_message_sent') AND JSON_UNQUOTE(JSON_EXTRACT(details,'$.providerMessageId'))=? LIMIT 1`,[uidHash,leadId,messageId]);
  if(existing?.length)return false;
  await query(`INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,actor_id,activity_type,summary,details) VALUES (?,?,?,?,?,?,?)`,[uidHash,leadId,actorType,actor,activityType,summary,details]);
  return true;
}
async function recordAgentReply({agentId,...input}={}){
  const numericAgent=Number(agentId);
  if(!Number.isSafeInteger(numericAgent)||numericAgent<1)return false;
  return recordReply({...input,actorType:'agent',actorId:String(numericAgent),activityType:'agent_message_sent',summary:'Agent replied in WhatsApp conversation'});
}
async function recordWorkspaceReply({identityId,...input}={}){
  const identity=String(identityId||'').trim();
  if(!/^\d{1,20}$/.test(identity))return false;
  return recordReply({...input,actorType:'user',actorId:identity,activityType:'workspace_message_sent',summary:'Workspace user replied in connected conversation'});
}
module.exports={recordAgentReply,recordWorkspaceReply};
