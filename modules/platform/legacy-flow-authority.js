'use strict';

const ACCESS_CAPABILITY='automation.flows';

function createLegacyFlowNodeGuard({uid,flowId,origin,sessionId,webhook,pool,getActiveFlows,optionalFeatureEnabled}){
  let initialized=false,baseline=null;
  return async()=>{
    try{
      if(origin?.toLowerCase()==='webhook_automation'&&(!optionalFeatureEnabled||!await optionalFeatureEnabled(uid,'webhooks')))return false;
      const db=await pool.getConnection();let current;
      try{current=await require('./chatbot-runtime-access').resolveOwnerAccess(db,uid,ACCESS_CAPABILITY);}
      finally{db.release();}
      if(!initialized){baseline=current;initialized=true;if(current.linked&&!current.context)return false;}
      else if(Boolean(current.linked)!==Boolean(baseline?.linked))return false;
      else if(baseline?.linked&&!require('./chatbot-runtime-access').sameBoundary(baseline.context,current.context))return false;
      const active=await getActiveFlows({uid,origin,sessionId,webhook});
      return Array.isArray(active)&&active.some(flow=>flow?.flow_id===flowId)?'allowed':false;
    }catch(error){
      console.warn('Legacy flow authority check failed; stopping the flow.',error?.code||'FLOW_AUTHORITY_UNAVAILABLE');
      return false;
    }
  };
}

module.exports={ACCESS_CAPABILITY,createLegacyFlowNodeGuard};
