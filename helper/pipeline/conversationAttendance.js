'use strict';
const crypto=require('node:crypto');
const sha=value=>crypto.createHash('sha256').update(String(value)).digest('hex');

async function recordAgentReply({uid,chatId,agentId,origin,providerMessageId,query}={}){
  const numericAgent=Number(agentId),messageId=String(providerMessageId||'').trim().slice(0,191);
  if(typeof query!=='function'||typeof uid!=='string'||!uid||typeof chatId!=='string'||!chatId||!Number.isSafeInteger(numericAgent)||numericAgent<1||!['qr','meta'].includes(origin)||!messageId)return false;
  const uidHash=sha(uid),[leads]=await query(`SELECT lead_id FROM pipeline_conversations WHERE uid_hash=? AND uid=? AND chat_id=? AND origin=? ORDER BY last_inbound_at DESC LIMIT 1`,[uidHash,uid,chatId,origin]);
  if(!leads?.length)return false;
  const leadId=leads[0].lead_id,details=JSON.stringify({origin,providerMessageId:messageId});
  const [existing]=await query(`SELECT id FROM pipeline_activity WHERE uid_hash=? AND lead_id=? AND activity_type='agent_message_sent' AND details=? LIMIT 1`,[uidHash,leadId,details]);
  if(existing?.length)return false;
  await query(`INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,actor_id,activity_type,summary,details) VALUES (?,?,'agent',?,'agent_message_sent','Agent replied in WhatsApp conversation',?)`,[uidHash,leadId,String(numericAgent),details]);
  return true;
}
module.exports={recordAgentReply};
