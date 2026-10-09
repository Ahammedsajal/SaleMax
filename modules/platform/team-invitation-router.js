'use strict';
const express=require('express');
const team=require('./team-invitations');
function createTeamInvitationRouters({pool,origin,userGuard,insecureLoopback=false,agentGuard=(req,res,next)=>require('../../middlewares/agent')(req,res,next)}){
  const owner=express.Router(),accept=express.Router();
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  function errorHandler(req,res,error){
    if(error.code?.startsWith('CONVERSATION_'))return res.status(error.status===400?400:403).json({success:false,code:error.code});
    const code=error.code||'',status=['PERMISSION_DENIED','TEAM_INBOX_PERMISSION_DENIED'].includes(code)?403:['INVITE_NOT_FOUND','MEMBER_NOT_FOUND','ROLE_NOT_FOUND','VERIFIED_BUSINESS_OWNER_REQUIRED','BUSINESS_LINK_INVALID'].includes(code)?404:['INVITE_NOT_PENDING','INVITE_ALREADY_PENDING','MEMBERSHIP_EXISTS','IDEMPOTENCY_CONFLICT','NAVIGATION_NOT_AVAILABLE','ROLE_NAME_EXISTS','ROLE_IN_USE','ROLE_ARCHIVED'].includes(code)?409:code==='INVITE_INVALID'?410:code==='SEAT_LIMIT_EXCEEDED'||code==='TEAM_FEATURE_UNAVAILABLE'||code==='BUSINESS_INACTIVE'||code==='ROLE_ONBOARDING_UNAVAILABLE'?409:code.startsWith('INVALID_')?400:error.type==='entity.parse.failed'?400:error.type==='entity.too.large'?413:503;
    res.status(status).json({success:false,code:status===503?'TEAM_INVITATION_UNAVAILABLE':error.type==='entity.parse.failed'?'INVALID_JSON':error.type==='entity.too.large'?'BODY_TOO_LARGE':code});
  }
  owner.use(express.json({limit:'16kb',strict:true}));owner.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)&&(req.get('Origin')!==origin||!req.body||typeof req.body!=='object'||Array.isArray(req.body)))return res.status(req.get('Origin')!==origin?403:400).json({success:false,code:req.get('Origin')!==origin?'ORIGIN_DENIED':'INVALID_BODY'});next();});owner.use(userGuard);
  owner.get('/sidebar-access',wrap(async(req,res)=>res.json({success:true,data:await team.sidebarAccess(pool,req.decode.uid)})));
  const conversationAccess=wrap(async(req,res)=>{
    const chatId=req.query.chatId;
    if(typeof chatId!=='string'||!chatId||chatId.length>255)return res.status(400).json({success:false,code:'INVALID_CONVERSATION'});
    const access=require('./team-inbox-scope');
    const query=async(sql,args)=>(await pool.query(sql,args))[0];
    const scope=await access.resolveInboxScope(query,req.decode.userData,'load_conversation');
    if(!scope.assignedOnly)return res.json({success:true,data:{allowed:true,assignedOnly:false}});
    const rows=await query('SELECT assigned_agent FROM beta_chats WHERE uid=? AND chat_id=? LIMIT 1',[scope.uid,chatId]);
    res.json({success:true,data:{allowed:rows.length===1&&access.filterAssignedChats(rows,scope).length===1,assignedOnly:true}});
  });
  owner.get('/conversation-access',conversationAccess);
  owner.get('/',wrap(async(req,res)=>res.json({success:true,data:await team.list(pool,req.decode.uid)})));
  function setAccountCookie(res,result){
    res.cookie(insecureLoopback?'salemax_dev_session':'__Host-salemax_session',result.cookieToken,
      {httpOnly:true,secure:!insecureLoopback,sameSite:'strict',path:'/',maxAge:result.expiresInSeconds*1000});
  }
  owner.post('/members/:id/login-as',wrap(async(req,res)=>{
    const result=await team.accountSession(pool,req.decode.uid,req.params.id,{jwtKey:process.env.JWTKEY});
    setAccountCookie(res,result);res.json({success:true,data:{token:result.token,sessionId:result.sessionId,expiresInSeconds:result.expiresInSeconds}});
  }));
  owner.post('/return-owner',wrap(async(req,res)=>{
    const result=await team.accountSession(pool,req.decode.uid,null,{jwtKey:process.env.JWTKEY,returning:true,sessionId:req.body.sessionId});
    setAccountCookie(res,result);res.json({success:true,data:{returned:true}});
  }));
  owner.post('/',wrap(async(req,res)=>res.status(201).json({success:true,data:await team.create(pool,req.decode.uid,req.body)})));
  owner.post('/roles',wrap(async(req,res)=>res.status(201).json({success:true,data:await team.createRole(pool,req.decode.uid,req.body)})));
  owner.put('/roles/:id',wrap(async(req,res)=>res.json({success:true,data:await team.updateRole(pool,req.decode.uid,req.params.id,req.body)})));
  owner.post('/roles/:id/archive',wrap(async(req,res)=>res.json({success:true,data:await team.archiveRole(pool,req.decode.uid,req.params.id)})));
  owner.put('/members/:id/navigation',wrap(async(req,res)=>res.json({success:true,data:await team.updateMemberNavigation(pool,req.decode.uid,req.params.id,req.body)})));
  owner.post('/:id/rotate',wrap(async(req,res)=>res.json({success:true,data:await team.rotate(pool,req.decode.uid,req.params.id)})));
  owner.post('/:id/cancel',wrap(async(req,res)=>res.json({success:true,data:await team.cancel(pool,req.decode.uid,req.params.id)})));
  owner.use((error,req,res,next)=>{if(res.headersSent)return next(error);errorHandler(req,res,error);});

  accept.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return next();if(req.get('Origin')!==origin)return res.status(403).json({success:false,code:'ORIGIN_DENIED'});next();});
  accept.get('/conversation-access',agentGuard,conversationAccess);
  accept.get('/conversation-staff',agentGuard,wrap(async(req,res)=>{
    const result=await require('./agent-conversation-transfer').conversationStaff(pool,req.decode.userData,req.query.chatId);
    res.json({success:true,data:{staff:result.staff.map(({identityId,name})=>({identityId,name}))}});
  }));
  accept.post('/conversation-transfer',express.json({limit:'2kb',strict:true}),agentGuard,wrap(async(req,res)=>{
    const result=await require('./agent-conversation-transfer').transfer(pool,req.decode.userData,req.body?.chatId,req.body?.identityId,require('../../socket').sendToUid);
    res.json({success:true,data:result});
  }));
  accept.get('/preview/:token',wrap(async(req,res)=>res.json({success:true,data:await team.preview(pool,req.params.token)})));
  accept.post('/accept',express.json({limit:'8kb',strict:true}),wrap(async(req,res)=>res.status(201).json({success:true,data:await team.accept(pool,req.body||{})})));
  accept.use((error,req,res,next)=>{if(res.headersSent)return next(error);errorHandler(req,res,error);});
  return {owner,accept};
}
module.exports={createTeamInvitationRouters};
