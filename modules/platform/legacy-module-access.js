'use strict';

const policy=require('./policy');
const {legacyContext}=require('./business-feature-session');

function createLegacyModuleAccess({pool,capability,permission,resolveContext=legacyContext,decide=policy.decision,agentFallbacks=[],errorCode='LEGACY_MODULE_ACCESS_UNAVAILABLE',contextProperty='legacyModuleContext'}={}){
  if(!pool||typeof pool.getConnection!=='function')throw new TypeError('LEGACY_MODULE_POOL_REQUIRED');
  if(typeof capability!=='string'||typeof permission!=='string')throw new TypeError('LEGACY_MODULE_POLICY_REQUIRED');
  return async function legacyModuleAccess(req,res,next){
    try{
      const agent=req.featureSession?.agent===true||req.decode?.userData?.role==='agent';
      const actor=req.featureSession?.actor||req.decode?.userData;
      let context=req.featureSession?.context||null;
      if(!context&&actor)context=await resolveContext(pool,actor,agent);
      // Unmapped historic accounts remain on their existing path until reviewed
      // ownership adoption supplies an authoritative tenant context.
      if(!context)return next();

      const access=decide(context,{capability,permission});
      if(!access.allowed){
        const canUseAgentFallback=agent&&access.code==='PERMISSION_DENIED'&&agentFallbacks.length>0&&agentFallbacks.every(item=>decide(context,item).allowed);
        if(!canUseAgentFallback)return res.status(403).json({success:false,code:access.code||'FEATURE_UNAVAILABLE'});
      }
      req[contextProperty]=context;
      return next();
    }catch(error){
      return res.status(error.status||503).json({success:false,code:error.status?error.code:errorCode});
    }
  };
}

module.exports={createLegacyModuleAccess};
