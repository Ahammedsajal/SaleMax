'use strict';
const {legacyContext}=require('./business-feature-session');
const {decision}=require('./policy');
const {supportsCategoryCapability}=require('./categories');
const deniedCodes=new Set(['ACCOUNT_INACTIVE','BUSINESS_LINK_INVALID','CATEGORY_UNAVAILABLE','INVALID_ROLE_LIMITS','INVALID_GRANTS']);
const denied=(code,tenantId)=>({linked:true,context:null,code,tenantId});
async function resolveOwnerAccess(db,uid){
 if(typeof uid!=='string'||!uid||uid.length>255)return {linked:false,context:null};
 const [rows]=await db.query(`SELECT u.id,u.uid,o.tenant_id AS tenantId,t.slug AS tenantSlug
 FROM user u LEFT JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
 LEFT JOIN sx_tenants t ON t.id=o.tenant_id WHERE u.uid=? AND u.role='user' LIMIT 2`,[uid]);
 if(!rows.length||rows.length===1&&!rows[0].tenantId)return {linked:false,context:null};
 if(rows.length!==1)return denied('BUSINESS_LINK_INVALID');
 const deny=code=>denied(code,rows[0].tenantId);
 let ctx;
 try{ctx=await legacyContext(db,rows[0]);}catch(error){if(deniedCodes.has(error.code))return deny(error.code);throw error;}
 if(!ctx||ctx.tenant.id!==rows[0].tenantId||ctx.membership.role!=='owner')return deny('BUSINESS_LINK_INVALID');
 if(!ctx.category?.planable||!supportsCategoryCapability(ctx.category,'automation.chatbot'))return deny('CATEGORY_UNAVAILABLE');
 if(ctx.subscription?.categoryKey!==ctx.category.key||ctx.subscription?.categoryVersion!==ctx.category.version)return deny('FEATURE_UNAVAILABLE');
 const gate=decision(ctx,{capability:'automation.chatbot',permission:'automation.manage'});if(!gate.allowed)return deny(gate.code);
 ctx.tenant.slug=rows[0].tenantSlug;
 return {linked:true,tenantId:ctx.tenant.id,context:ctx};
}
function sameBoundary(prior,current){
 return Boolean(prior&&current&&prior.tenant.id===current.tenant.id&&prior.tenant.categoryKey===current.tenant.categoryKey&&prior.tenant.categoryVersion===current.tenant.categoryVersion&&prior.membership.id===current.membership.id&&prior.identity.id===current.identity.id&&prior.subscription.assignmentId===current.subscription.assignmentId);
}
async function blocksFallback(db,access,channelKind,channelRef){
 if(!access.linked||!channelKind)return false;
 if(!access.tenantId)return true; // Ambiguous ownership must not dispatch another flow.
 const [[assigned]]=await db.query(`SELECT 1 AS found FROM sx_chatbot_channel_assignments a JOIN sx_chatbot_profiles p ON p.tenant_id=a.tenant_id AND p.id=a.chatbot_id WHERE a.tenant_id=? AND a.channel_kind=? AND a.channel_ref=? AND p.status='live' LIMIT 1`,[access.tenantId,channelKind,channelRef]);
 return Boolean(assigned);
}
module.exports={resolveOwnerAccess,sameBoundary,blocksFallback};
