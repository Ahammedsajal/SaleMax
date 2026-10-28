'use strict';
const AUTO_REASONS=new Set(['recruitment-awaiting-cv','recruitment-complete','recruitment-recruiter-requested']);
function mayFinish(control){
  if(!control||control.mode!=='paused'||control.pauseUntil&&new Date(control.pauseUntil)<=new Date())return true;
  return control.updatedByKind==='system'&&AUTO_REASONS.has(control.reason);
}
function actionFor(completion,message,text){
  if(!completion)return null;
  if(!mayFinish(completion.control)||completion.application.cvFileName)return 'silent';
  if(message?.type==='document')return 'cv';
  if(['talk_to_recruiter','talk to recruiter','تحدث مع مسؤول التوظيف'].includes(String(text||'').trim().toLowerCase()))return 'recruiter';
  return 'silent';
}
async function load(db,{tenantId,channelKind,channelRef,conversationId}){
  const attempt=await require('./recruitment-chat-attempt').current(db,{tenantId,channelKind,channelRef,conversationId});
  const [[application]]=await db.query(`SELECT id,reference_code AS referenceCode,full_name AS fullName,mobile,contact_mobile AS contactMobile,email,current_work_status AS currentlyWorking,total_experience_range AS totalExperienceRange,sales_experience_years AS salesExperienceYears,has_computer_and_internet AS hasComputerAndInternet,comfortable_with_sales_calls AS comfortableWithSalesCalls,english_level AS englishLevel,hindi_level AS hindiLevel,availability,cv_file_name AS cvFileName FROM sx_recruitment_applications WHERE tenant_id=? AND linked_chat_id=? AND linked_chat_origin=? AND source_channel='whatsapp' AND (? IS NULL OR created_at>=?) ORDER BY created_at DESC,id LIMIT 1`,[tenantId,conversationId,channelKind==='whatsapp_meta'?'meta':'qr',attempt?.startedAt||null,attempt?.startedAt||null]);
  if(!application)return null;
  const [[control]]=await db.query(`SELECT mode,reason,pause_until AS pauseUntil,updated_by_kind AS updatedByKind FROM sx_chatbot_conversation_controls WHERE tenant_id=? AND channel_kind=? AND channel_ref=? AND conversation_id=? LIMIT 1`,[tenantId,channelKind,channelRef,conversationId]);
  return {application,control,answers:{...application,whatsappNumber:application.mobile,contactNumber:application.contactMobile||application.mobile}};
}
module.exports={AUTO_REASONS,mayFinish,actionFor,load};
