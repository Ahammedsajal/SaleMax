'use strict';

const {legacyContext}=require('./business-feature-session');
const {decision}=require('./policy');

async function resolveCampaignModuleAccess(db,uid,{resolveContext=legacyContext,decide=decision}={}){
  if(typeof uid!=='string'||!uid||uid.length>255)return {allowed:false,code:'OWNER_NOT_FOUND'};
  const [owners]=await db.query("SELECT id,uid,role FROM user WHERE uid=? AND role='user' LIMIT 2",[uid]);
  if(owners.length!==1)return {allowed:false,code:owners.length?'BUSINESS_LINK_INVALID':'OWNER_NOT_FOUND'};
  const owner=owners[0];
  const [links]=await db.query("SELECT tenant_id AS tenantId FROM sx_legacy_ownership WHERE source_table='user' AND source_id=CAST(? AS CHAR) LIMIT 2",[owner.id]);
  // Keep a real but not-yet-adopted legacy owner on the established worker path.
  if(!links.length)return {allowed:true,compatibility:true};
  if(links.length!==1)return {allowed:false,code:'BUSINESS_LINK_INVALID'};
  let context;
  try{context=await resolveContext(db,owner,false);}
  catch(error){return {allowed:false,code:error.code||'CAMPAIGN_ACCESS_UNAVAILABLE'};}
  if(!context||context.tenant.id!==links[0].tenantId)return {allowed:false,code:'BUSINESS_LINK_INVALID'};
  const result=decide(context,{capability:'campaigns.send',permission:'campaigns.manage'});
  return result.allowed?{allowed:true,context}:{allowed:false,code:result.code||'FEATURE_UNAVAILABLE'};
}

function createCampaignModuleAccess({pool,resolveContext,decide}={}){
  if(!pool||typeof pool.getConnection!=='function')throw new TypeError('CAMPAIGN_ACCESS_POOL_REQUIRED');
  return async function canSendCampaign(uid){
    const db=await pool.getConnection();
    try{return await resolveCampaignModuleAccess(db,uid,{resolveContext,decide});}
    catch(error){return {allowed:false,code:error.code||'CAMPAIGN_ACCESS_UNAVAILABLE'};}
    finally{db.release();}
  };
}

module.exports={resolveCampaignModuleAccess,createCampaignModuleAccess};
