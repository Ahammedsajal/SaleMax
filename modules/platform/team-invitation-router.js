'use strict';
const express=require('express');
const team=require('./team-invitations');
function createTeamInvitationRouters({pool,origin,userGuard}){
  const owner=express.Router(),accept=express.Router();
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  function errorHandler(req,res,error){
    const code=error.code||'',status=code==='PERMISSION_DENIED'?403:['INVITE_NOT_FOUND','VERIFIED_BUSINESS_OWNER_REQUIRED','BUSINESS_LINK_INVALID'].includes(code)?404:['INVITE_NOT_PENDING','INVITE_ALREADY_PENDING','MEMBERSHIP_EXISTS','IDEMPOTENCY_CONFLICT'].includes(code)?409:code==='INVITE_INVALID'?410:code==='SEAT_LIMIT_EXCEEDED'||code==='TEAM_FEATURE_UNAVAILABLE'||code==='BUSINESS_INACTIVE'||code==='ROLE_ONBOARDING_UNAVAILABLE'?409:code.startsWith('INVALID_')?400:error.type==='entity.parse.failed'?400:error.type==='entity.too.large'?413:503;
    res.status(status).json({success:false,code:status===503?'TEAM_INVITATION_UNAVAILABLE':error.type==='entity.parse.failed'?'INVALID_JSON':error.type==='entity.too.large'?'BODY_TOO_LARGE':code});
  }
  owner.use(express.json({limit:'16kb',strict:true}));owner.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)&&(req.get('Origin')!==origin||!req.body||typeof req.body!=='object'||Array.isArray(req.body)))return res.status(req.get('Origin')!==origin?403:400).json({success:false,code:req.get('Origin')!==origin?'ORIGIN_DENIED':'INVALID_BODY'});next();});owner.use(userGuard);
  owner.get('/',wrap(async(req,res)=>res.json({success:true,data:await team.list(pool,req.decode.uid)})));
  owner.post('/',wrap(async(req,res)=>res.status(201).json({success:true,data:await team.create(pool,req.decode.uid,req.body)})));
  owner.post('/:id/rotate',wrap(async(req,res)=>res.json({success:true,data:await team.rotate(pool,req.decode.uid,req.params.id)})));
  owner.post('/:id/cancel',wrap(async(req,res)=>res.json({success:true,data:await team.cancel(pool,req.decode.uid,req.params.id)})));
  owner.use((error,req,res,next)=>{if(res.headersSent)return next(error);errorHandler(req,res,error);});

  accept.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return next();if(req.get('Origin')!==origin)return res.status(403).json({success:false,code:'ORIGIN_DENIED'});next();});
  accept.get('/preview/:token',wrap(async(req,res)=>res.json({success:true,data:await team.preview(pool,req.params.token)})));
  accept.post('/accept',express.json({limit:'8kb',strict:true}),wrap(async(req,res)=>res.status(201).json({success:true,data:await team.accept(pool,req.body||{})})));
  accept.use((error,req,res,next)=>{if(res.headersSent)return next(error);errorHandler(req,res,error);});
  return {owner,accept};
}
module.exports={createTeamInvitationRouters};
