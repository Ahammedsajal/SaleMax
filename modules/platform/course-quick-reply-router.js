'use strict';
const service=require('./course-quick-replies');
const media=require('./training-course-media');
module.exports=function createRouter({agent=false,pool:injectedPool,authenticate,send,origin=process.env.SALEMAX_PLATFORM_ORIGIN}={}) {
  const express=require('express'),router=express.Router(),pool=injectedPool||require('../../database/config').promise();
  const userGuard=authenticate||require('../../middlewares/user'),agentGuard=authenticate||require('../../middlewares/agent');
  const guard=agent?agentGuard:userGuard;
  const contextFor=req=>req.featureSession?service.sessionContext(pool,req.featureSession):service.context(pool,req.decode.userData,req.courseAgent??agent,req.owner);
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  router.use(express.json({limit:'4kb',strict:true}));
  router.use((req,res,next)=>{res.set('Cache-Control','private, no-store');if(req.method==='POST'&&!require('./request-origin').matches(req,origin))return res.status(403).json({success:false,code:'ORIGIN_DENIED'});next();});
  // Native image/document elements cannot add a bearer header. This narrowly
  // scoped HttpOnly cookie uses the same revocable legacy authentication.
  router.get('/files/:id/:index',(req,res,next)=>{
    try{
      const value=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('sx_course_reply='))?.slice(16);
      if(!value)return guard(req,res,next);
      const auth=JSON.parse(Buffer.from(value||'','base64url').toString());
      if(auth.mode==='cookie')return guard(req,res,next);
      if(typeof auth.token!=='string'||auth.token.length>8192||typeof auth.agent!=='boolean')throw Error();
      req.headers.authorization=auth.token;req.courseAgent=auth.agent;if(auth.agent)req.headers['x-salemax-actor']='agent';
      (auth.agent?agentGuard:userGuard)(req,res,next);
    }catch{res.status(401).json({success:false,code:'AUTH_REQUIRED'});}
  },wrap(async(req,res)=>{
    const c=await contextFor(req);
    const row=await service.job(pool,c,req.params.id),parts=JSON.parse(row.parts_json),index=Number(req.params.index);
    if(!Number.isInteger(index)||index<0||index>=parts.length||!parts[index].mediaId)return res.sendStatus(404);
    const file=await media.getFile(pool,c.ctx.tenant.id,row.course_id,parts[index].mediaId);
    res.set({'Content-Type':file.mimeType,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':`${file.kind==='document'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`});
    res.sendFile(file.path,{dotfiles:'deny'});
  }));
  router.use(guard);
  router.use((req,res,next)=>contextFor(req).then(c=>{req.courseReplyContext=c;next();}).catch(next));
  router.get('/',wrap(async(req,res)=>{
    const c=req.courseReplyContext;await service.conversation(c,req.query.chatId);
    const items=await service.options(pool,c);
    const auth=Buffer.from(JSON.stringify(req.get('Authorization')?{mode:'bearer',agent:req.featureSession?.agent??agent,token:req.get('Authorization')}:{mode:'cookie'})).toString('base64url');
    for(const path of ['/api/inbox/course-replies/files','/api/workspace/inbox/course-replies/files'])res.cookie('sx_course_reply',auth,{httpOnly:true,secure:origin?.startsWith('https:'),sameSite:'strict',path,maxAge:3600000});
    res.json({success:true,data:{courses:items}});
  }));
  router.get('/preview/:id',wrap(async(req,res)=>{await service.conversation(req.courseReplyContext,req.query.chatId);res.json({success:true,data:await service.plan(pool,req.courseReplyContext,req.params.id,req.query.language==='ar'?'ar':'en')});}));
  router.get('/jobs/:id',wrap(async(req,res)=>res.json({success:true,data:service.publicJob(await service.job(pool,req.courseReplyContext,req.params.id))})));
  router.post('/send',wrap(async(req,res)=>res.json({success:true,data:await service.execute(pool,req.courseReplyContext,req.body,send)})));
  router.use((e,req,res,next)=>{if(res.headersSent)return next(e);const status=e.status||(['TEAM_INBOX_PERMISSION_DENIED','PERMISSION_DENIED'].includes(e.code)?403:503);res.status(status).json({success:false,code:status>=500?'COURSE_REPLY_UNAVAILABLE':e.code});});
  return router;
};
