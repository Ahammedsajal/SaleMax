'use strict';
function canAgentAccessLead(agentId,ownerAgentId){
  return Number.isSafeInteger(Number(agentId))&&Number(agentId)>0&&
    Number.isSafeInteger(Number(ownerAgentId))&&Number(ownerAgentId)===Number(agentId);
}
module.exports={canAgentAccessLead};
