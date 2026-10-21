'use strict';
const jwt=require('jsonwebtoken');
const policy=require('./policy');
const sessions=require('./business-feature-session');
const {routePermission}=require('./team-role-request-guard');
const {canonicalMount}=require('./legacy-route-policy');
const fail=(code,status=403)=>{throw Object.assign(Error(code),{code,status});};
function capabilityFor(req,permission,context){
 const mount=String(req.baseUrl||'');
 const preferred=mount==='/api/qr'?'messaging.qr':mount==='/api/chat_flow'?'automation.flows':mount==='/api/chatbot'||mount==='/api/user/chatbots'?'automation.chatbot':mount==='/api/broadcast'?'campaigns.send':mount==='/api/templet'?'messaging.templates':null;
 if(preferred)return preferred;
 return Object.keys(policy.capabilities).find(key=>policy.capabilities[key].includes(permission)&&context.category.capabilities.includes(key)&&context.subscription?.capabilities.includes(key));
}
function authorize(req,session){
 req={baseUrl:canonicalMount(req.baseUrl),path:req.path,method:req.method};
 if(!session.context||!session.agent)fail('VERIFIED_AGENT_REQUIRED');
 const permission=req.baseUrl==='/api/qr'?'channels.configure':routePermission(req);if(!permission)fail('TEAM_ROLE_ROUTE_UNMAPPED');
 const bootstrap=(req.baseUrl==='/api/user/business-auth'&&req.path==='/me'&&req.method==='GET')||req.baseUrl==='/api/user'&&['/get_me','/get_fcm_data','/get_plan_details','/optional-features','/get_dashboard','/get_dashboard_old'].includes(req.path)&&req.method==='GET';
 if(bootstrap)return {permission,scope:'own',bootstrap:true};
 const capability=capabilityFor(req,permission,session.context);if(!capability)fail('FEATURE_UNAVAILABLE');
 const result=policy.decision(session.context,{capability,permission});if(!result.allowed)fail(result.code);
 // Narrow scopes are handled only by modules with resource-aware guards.
 if(result.scope!=='tenant'&&!['/api/inbox','/api/pipeline','/api/workspace/session','/api/workspace/tasks','/api/user/training/tasks','/api/workspace/phonebook','/api/workspace/inbox/course-replies','/api/workspace/courses','/api/workspace/products-services','/api/workspace/students','/api/workspace/forms','/api/workspace/finance','/api/user/call-center'].includes(req.baseUrl))fail('PERMISSION_DENIED');
 return {...result,permission};
}
function profile(session){
 const a=session.actor,o=session.owner;
 return {id:a.id,uid:a.uid,name:a.name,email:a.email,mobile_with_country_code:a.mobile||'',role:'user',workspaceRole:'agent',isAgent:true,
  timezone:session.context.tenant.timezone||'Asia/Qatar',plan:o.plan,plan_expire:o.plan_expire,contact:0};
}
function createAgentWorkspaceGuard({pool,query=(sql,args)=>pool.query(sql,args).then(r=>r[0]),origin=process.env.SALEMAX_PLATFORM_ORIGIN}={}){
 return async(req,res,next)=>{try{
  res.setHeader('Cache-Control','private, no-store');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!require('./request-origin').matches(req,origin))fail('ORIGIN_DENIED');
  const token=(req.get('Authorization')||'').match(/^Bearer\s+(\S+)$/i)?.[1];if(!token)fail('AUTH_REQUIRED',401);
  let claims;try{claims=jwt.verify(token,process.env.JWTKEY);}catch{fail('AUTH_REQUIRED',401);}
  const rows=await query('SELECT * FROM agents WHERE email=? AND password=? LIMIT 2',[claims.email,claims.password]);
  const actor=rows[0];if(rows.length!==1||actor.role!=='agent'||Number(actor.is_active)!==1||claims.uid!==actor.uid)fail('AUTH_REQUIRED',401);
  await require('./tenant-crm-domains').assertLegacyHost(query,req,'agents',actor.id);
  const session=await sessions.resolve(pool,{actor,agent:true});const access=authorize(req,session);
  const resourceMount=canonicalMount(req.baseUrl);
  req.featureSession=session;req.businessContext=session.context;req.agentWorkspace=true;req.owner=session.owner;
  req.decode={...claims,role:'agent',uid:session.ownerUid,actorUid:actor.uid,userData:actor};
  if(resourceMount==='/api/user/team-invitations')req.decode.uid=actor.uid;
  // Existing personal channel/automation handlers retain the agent's ownership.
  if(['/api/chat_flow','/api/chatbot','/api/templet','/api/broadcast','/api/telegram','/api/webhook'].includes(resourceMount)||resourceMount==='/api/user'&&['channels.configure','templates.manage','campaigns.manage'].includes(access.permission))req.decode.uid=actor.uid;
  if(resourceMount==='/api/qr'&&req.method==='POST'&&req.path!=='/gen_qr'){
   const key=req.body?.uniqueId||req.body?.insId;
   if(!key||!(await query(`SELECT instance.id FROM instance JOIN sx_qr_channel_shares share ON share.instance_id=instance.id
    WHERE instance.uniqueId=? AND instance.uid=? AND share.tenant_id=? AND share.membership_id=? AND share.granted_by_identity_id=?`,[key,session.ownerUid,session.context.tenant.id,session.context.membership.id,session.context.identity.id])).length)fail('RESOURCE_NOT_FOUND',404);
  }
  if(access.bootstrap){
   if(req.path==='/me')return res.json({success:true,context:session.context,csrfToken:null});
   if(req.path==='/get_me')return res.json({success:true,data:profile(session),addon:require('../../utils/addons').returnAddons()});
   if(['/get_dashboard','/get_dashboard_old'].includes(req.path)){
    const safe=profile(session);let plan;try{plan=JSON.parse(safe.plan);}catch{plan=null;}
    const stats={agents:0,activeChats:0,completedTasks:0,activeInstances:0};
    if(policy.decision(session.context,{capability:'messaging.inbox',permission:'conversations.read'}).allowed){
     const inbox=require('./team-inbox-scope'),scope=await inbox.resolveInboxScope(query,actor,'get_chat_list');
     stats.activeChats=inbox.filterAssignedChats(await query('SELECT assigned_agent,origin,origin_instance_unique_id FROM beta_chats WHERE uid=? AND unread_count>0',[session.ownerUid]),scope).length;
    }
    if(policy.decision(session.context,{capability:'team.tasks',permission:'tasks.read'}).allowed){const rows=await query("SELECT COUNT(*) AS count FROM agent_task WHERE uid=? AND owner_uid=? AND status='COMPLETED'",[actor.uid,session.ownerUid]);stats.completedTasks=Number(rows[0]?.count||0);}
    return res.json({success:true,data:{user:{...safe,plan},addons:require('../../utils/addons').returnAddons(),stats,recentConversations:[],unreadSummary:[],activeChatbots:[],performanceData:[],lastUpdated:new Date().toISOString()}});
   }
   if(req.path==='/get_fcm_data')return res.json({success:true,data:[]});
   if(req.path==='/get_plan_details')return res.json({success:true,data:{plan:session.owner.plan,plan_expire:session.owner.plan_expire}});
   if(req.path==='/optional-features')return res.json({success:true,data:await require('./optional-features').read({query:async(sql,args)=>[await query(sql,args)]},session.owner.id)});
  }
  const optional=require('./optional-features'),feature=optional.featureForRequest(req);
  if(feature&&!await optional.enabledForUid(session.ownerUid,feature,query))fail('FEATURE_DISABLED');
  next();
 }catch(error){res.status(error.status||503).json({success:false,code:error.status?error.code:'AGENT_WORKSPACE_UNAVAILABLE'});}};
}
module.exports={authorize,profile,capabilityFor,createAgentWorkspaceGuard};
