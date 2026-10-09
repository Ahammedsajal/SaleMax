'use strict';
const access = require('./team-inbox-scope');
const assignments = require('./team-conversation-assignment');
async function conversationStaff(pool, user, chatId) {
  if (typeof chatId !== 'string' || !chatId || chatId.length > 255) throw Object.assign(new Error('INVALID_CONVERSATION'), {code:'INVALID_CONVERSATION',status:400});
  const query = async (sql,args) => (await pool.query(sql,args))[0];
  const scope = await access.resolveInboxScope(query,user,'assign_agent_to_chat');
  if (!scope.canonical) throw Object.assign(new Error('TEAM_INBOX_PERMISSION_DENIED'),{code:'TEAM_INBOX_PERMISSION_DENIED',status:403});
  await access.authorizeInboxPayload(query,scope,'assign_agent_to_chat',{chatId});
  return {scope,staff:await assignments.eligibleStaff(pool,scope.ctx.tenant.id)};
}
async function transfer(pool,user,chatId,identityId,notify) {
  if(typeof identityId!=='string'||!identityId||identityId.length>64)throw Object.assign(new Error('CONVERSATION_ASSIGNEE_INVALID'),{code:'CONVERSATION_ASSIGNEE_INVALID',status:400});
  const {scope}=await conversationStaff(pool,user,chatId);
  const db=await pool.getConnection();
  let result;
  try {
    await db.beginTransaction();
    result=await assignments.assignConversation(db,{ctx:scope.ctx,uid:scope.uid,chatId,identityId,reason:'agent-panel-transfer'});
    await db.commit();
  } catch(error) { await db.rollback();throw error; }
  finally {db.release();}
  notify(scope.uid,{chatId},'request_update_chat_list');
  notify(scope.uid,{chatId},'request_update_opened_chat');
  return {assignee:result.assignee};
}
module.exports={conversationStaff,transfer};
