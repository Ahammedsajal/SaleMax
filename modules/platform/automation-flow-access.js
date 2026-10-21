'use strict';

const policy=require('./policy');
const {legacyContext}=require('./business-feature-session');

function createAutomationFlowAccess({pool,resolveContext=legacyContext,decide=policy.decision}={}){
  if(!pool||typeof pool.getConnection!=='function')throw new TypeError('AUTOMATION_FLOW_POOL_REQUIRED');
  return async function automationFlowAccess(req,res,next){
    try{
      const agent=req.featureSession?.agent===true||req.decode?.userData?.role==='agent';
      const actor=req.featureSession?.actor||req.decode?.userData;
      let context=req.featureSession?.context||null;
      if(!context&&actor)context=await resolveContext(pool,actor,agent);
      // Keep unmapped historical accounts on their current legacy contract
      // until they are adopted through the reviewed tenant-ownership flow.
      if(!context)return next();

      const flow=decide(context,{capability:'automation.flows',permission:'automation.manage'});
      if(!flow.allowed&&(!agent||flow.code!=='PERMISSION_DENIED'))
        return res.status(403).json({success:false,code:flow.code||'FEATURE_UNAVAILABLE'});

      if(agent){
        const reply=decide(context,{capability:'messaging.inbox',permission:'conversations.reply'});
        if(!reply.allowed)return res.status(403).json({success:false,code:reply.code||'PERMISSION_DENIED'});
      }
      req.automationFlowContext=context;
      return next();
    }catch(error){
      return res.status(error.status||503).json({success:false,code:error.status?error.code:'AUTOMATION_FLOW_ACCESS_UNAVAILABLE'});
    }
  };
}

module.exports={createAutomationFlowAccess};
