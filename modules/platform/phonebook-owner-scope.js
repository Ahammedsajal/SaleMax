'use strict';

const legacyPipelineActor=require('./legacy-pipeline-actor');

async function resolveOwnerUid(user,{pool,resolver=legacyPipelineActor.resolve}={}){
  if(!user||typeof user.uid!=='string'||!user.uid)return user?.uid||null;
  const actor=await resolver(pool,user);
  if(actor?.denied)throw Object.assign(new Error(actor.code||'BUSINESS_ACCESS_INACTIVE'),{code:actor.code||'BUSINESS_ACCESS_INACTIVE'});
  if(actor?.role==='manager'&&typeof actor.uid==='string'&&actor.uid)return actor.uid;
  return user.uid;
}

function middleware({pool,resolver}={}){
  return async function resolvePhonebookOwner(req,res,next){
    try{
      const user=req.decode?.userData;
      if(!user)return res.status(401).json({success:false,code:'AUTH_REQUIRED'});
      const ownerUid=await resolveOwnerUid(user,{pool,resolver});
      if(!ownerUid)return res.status(403).json({success:false,code:'BUSINESS_LINK_INVALID'});
      // The existing Phonebook and plan-limit services key records by this UID.
      // Keep the account identity available for diagnostics while directing this
      // request to the verified tenant owner's shared records.
      req.decode.actorUid=user.uid;
      req.decode.uid=ownerUid;
      return next();
    }catch(error){
      const status=error?.code==='AUTH_REQUIRED'?401:403;
      return res.status(status).json({success:false,code:error?.code||'PHONEBOOK_ACCESS_DENIED'});
    }
  };
}

module.exports={resolveOwnerUid,middleware};
