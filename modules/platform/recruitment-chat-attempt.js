'use strict';
// An explicit, audited restart opens a new attempt without changing old applications.
async function current(db,{tenantId,channelKind,channelRef,conversationId}){
 const [[attempt]]=await db.query(`SELECT id,DATE_FORMAT(occurred_at,'%Y-%m-%d %H:%i:%s.%f') AS startedAt FROM sx_audit_events
   WHERE tenant_id=? AND action='recruitment.chat-restarted' AND resource_type='chatbot-conversation' AND resource_id=?
   AND JSON_UNQUOTE(JSON_EXTRACT(changes,'$.channelKind'))=? AND JSON_UNQUOTE(JSON_EXTRACT(changes,'$.channelRef'))=?
   ORDER BY occurred_at DESC,id DESC LIMIT 1`,[tenantId,conversationId,channelKind,channelRef]);
 return attempt||null;
}
const submissionToken=(original,attempt)=>attempt?.id||original;
module.exports={current,submissionToken};
