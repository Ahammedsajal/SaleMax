'use strict';
const fs=require('node:fs/promises');
const fail=()=>{throw Object.assign(new Error('SEND_STOPPED_CHECK_CHAT'),{code:'SEND_STOPPED_CHECK_CHAT'});};
async function send({c,chat,part,file,jobId,index},dependencies={}) {
  const helpers=dependencies.helpers||require('../../helper/socket/function');
  let msgCon=part.kind==='text'?{type:'text',text:{body:part.text,preview_url:false}}:{type:part.kind,[part.kind]:{link:`/api/inbox/course-replies/files/${jobId}/${index}`,caption:part.name,...(part.kind==='document'?{filename:part.name}:{})}};
  let response;
  if(chat.origin==='qr') {
    // Resolve the actual persisted channel inside this account, never a browser supplied session.
    const sessions=await c.query('SELECT uniqueId FROM instance WHERE uid=? AND uniqueId=? LIMIT 1',[c.scope.uid,chat.origin_instance_unique_id]);
    if(sessions.length!==1)fail();
    const {getSession,formatPhone}=dependencies.qr||require('../../helper/addon/qr');
    const session=await getSession(sessions[0].uniqueId);
    if(!session?.sendMessage)fail();
    const content=file?{[part.kind]:await fs.readFile(file.path),mimetype:file.mimeType,fileName:file.originalName,caption:file.originalName}:{text:part.text};
    const sent=await session.sendMessage(formatPhone(chat.sender_mobile),content);
    if(!sent?.key?.id)fail();
    response={success:true,id:sent.key.id};
  }else if(chat.origin==='meta') {
    let providerCon=msgCon;
    if(file) {
      const [api]=await c.query('SELECT access_token,business_phone_number_id FROM meta_api WHERE uid=?',[c.scope.uid]);
      if(!api?.access_token||!api.business_phone_number_id)fail();
      const FormData=require('form-data'),fetch=dependencies.fetch||require('node-fetch');
      const form=new FormData();
      form.append('file',await fs.readFile(file.path),{filename:file.originalName,contentType:file.mimeType});
      form.append('messaging_product','whatsapp');
      const upload=await fetch(`https://graph.facebook.com/v17.0/${encodeURIComponent(api.business_phone_number_id)}/media`,{method:'POST',headers:{Authorization:`Bearer ${api.access_token}`,...form.getHeaders()},body:form,timeout:60000});
      const data=await upload.json();if(!upload.ok||!data.id)fail();
      providerCon={type:part.kind,[part.kind]:{id:data.id,caption:part.name,...(part.kind==='document'?{filename:part.name}:{})}};
    }
    response=await helpers.sendMetaMsg({uid:c.scope.uid,to:chat.sender_mobile,msgObj:providerCon});
    if(!response?.success||!response.id)fail();
  }else fail();
  const [user]=await c.query('SELECT timezone FROM user WHERE uid=?',[c.scope.uid]);
  const messageData=helpers.returnMsgObjAfterAddingKey({type:part.kind,msgContext:msgCon,metaChatId:response.id,timestamp:helpers.getCurrentTimestampInTimeZone(user?.timezone||'Asia/Qatar'),senderName:chat.sender_name,senderMobile:chat.sender_mobile,origin:chat.origin,status:'sent'});
  await (dependencies.saveMessage||require('../../functions/function').saveMessageToConversation)({uid:c.scope.uid,chatId:chat.chat_id,messageData});
  await c.query('UPDATE beta_chats SET last_message=? WHERE uid=? AND chat_id=?',[JSON.stringify(messageData),c.scope.uid,chat.chat_id]);
  if(c.agent)await (dependencies.recordReply||require('../../helper/pipeline/conversationAttendance').recordAgentReply)({query:c.query,uid:c.scope.uid,chatId:chat.chat_id,agentId:c.actor.id,origin:chat.origin,providerMessageId:response.id}).catch(()=>{});
  const sendToUid=dependencies.notify||require('../../socket').sendToUid;
  const recipients=new Set([c.scope.uid,c.actor.uid]);
  for(const uid of recipients){sendToUid(uid,{chatId:chat.chat_id},'request_update_chat_list');sendToUid(uid,{chatId:chat.chat_id},'request_update_opened_chat');}
  return response.id;
}
module.exports={send};
