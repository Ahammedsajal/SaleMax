'use strict';
const crypto=require('node:crypto');
const pipeline=require('../../helper/pipeline/leadPipeline');
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
// Runs inside the caller's chat-transfer transaction. The phone lock is shared
// with inbound capture so a transfer and a new message cannot create two leads.
async function assign(db,{ctx,uid,chatId,chat,agentId,agentName}){
  const category=require('./categories').getCategory(ctx.tenant?.categoryKey,Number(ctx.tenant?.categoryVersion));
  if(!category||ctx.category&&(ctx.category.key!==category.key||ctx.category.version!==category.version)||category.conversationTransferLeadAdapter!=='whatsapp_inquiry_v1')return null;
  if(!['qr','meta'].includes(chat.origin))throw Object.assign(Error('CONVERSATION_ORIGIN_INVALID'),{code:'CONVERSATION_ORIGIN_INVALID',status:409});
  const uidHash=hash(uid),conversationKey=hash(`${chat.origin}:${chatId}`);
  const phone=pipeline.normalizePhone(chat.sender_mobile),identityKey=hash(phone?`phone:${phone}`:`conversation:${conversationKey}`);
  await pipeline.prepareWorkspace(db,uid);
  await db.query('INSERT IGNORE INTO pipeline_identity_locks (uid_hash,identity_key,current_lead_id) VALUES (?,?,NULL)',[uidHash,identityKey]);
  const [[lock]]=await db.query('SELECT current_lead_id FROM pipeline_identity_locks WHERE uid_hash=? AND identity_key=? FOR UPDATE',[uidHash,identityKey]);
  const [linked]=await db.query(`SELECT l.id,l.owner_agent_id FROM pipeline_conversations c JOIN pipeline_leads l ON l.uid_hash=c.uid_hash AND l.id=c.lead_id
    WHERE c.uid_hash=? AND c.conversation_key=? LIMIT 1 FOR UPDATE`,[uidHash,conversationKey]);
  let lead=linked[0]||null,created=false;
  if(!lead){
    const [legacy]=await db.query('SELECT id,owner_agent_id FROM pipeline_leads WHERE uid_hash=? AND chat_id=? AND primary_origin=? ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE',[uidHash,chatId,chat.origin]);
    lead=legacy[0]||null;
  }
  if(!lead&&lock?.current_lead_id){const [[current]]=await db.query('SELECT id,owner_agent_id FROM pipeline_leads WHERE uid_hash=? AND id=? LIMIT 1 FOR UPDATE',[uidHash,lock.current_lead_id]);lead=current||null;}
  if(!lead){
    const name=String(chat.sender_name||'').trim().slice(0,255);
    const result=await pipeline.createManualLead({uid,actorType:'user',actorId:ctx.identity.id,role:'owner',connection:db,input:{title:(name?`${name} · WhatsApp inquiry`:'WhatsApp inquiry').slice(0,180),contactName:name||undefined,mobile:phone||undefined,ownerAgentId:agentId}});
    lead={id:result.id,owner_agent_id:agentId};created=true;
    await db.query('UPDATE pipeline_leads SET identity_key=?,chat_id=?,primary_origin=?,source_type=? WHERE uid_hash=? AND id=?',[identityKey,chatId,chat.origin,chat.origin==='qr'?'qr_whatsapp':'meta_whatsapp',uidHash,lead.id]);
  }
  const previousAgentId=lead.owner_agent_id==null?null:Number(lead.owner_agent_id);
  if(previousAgentId!==agentId){
    await db.query('UPDATE pipeline_leads SET owner_agent_id=?,last_activity_at=UTC_TIMESTAMP(3) WHERE uid_hash=? AND id=?',[agentId,uidHash,lead.id]);
    await db.query(`INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,actor_id,activity_type,summary,details,created_at)
      VALUES (?,?,'user',?,'lead_reassigned',?,?,UTC_TIMESTAMP(3))`,[uidHash,lead.id,ctx.identity.id,`Chat transferred to ${agentName||'agent'}`,JSON.stringify({fromAgentId:previousAgentId,toAgentId:agentId,toAgentName:agentName||null,reason:'conversation_transfer',chatId})]);
  }
  await db.query(`INSERT INTO pipeline_conversations(uid_hash,lead_id,conversation_key,chat_id,origin,first_inbound_at,last_inbound_at)
    VALUES (?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE lead_id=VALUES(lead_id)`,[uidHash,lead.id,conversationKey,chatId,chat.origin]);
  if(!lock?.current_lead_id||lock.current_lead_id===lead.id)await db.query('UPDATE pipeline_identity_locks SET current_lead_id=? WHERE uid_hash=? AND identity_key=?',[lead.id,uidHash,identityKey]);
  return {id:lead.id,created,ownerAgentId:agentId};
}
module.exports={assign};
