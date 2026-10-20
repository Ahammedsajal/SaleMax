'use strict';
const express=require('express');
const settings=require('./tenant-customization');
function createTenantCustomizationRouter({pool,origin,authenticate}) {
  const router=express.Router(),wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  router.use(authenticate,express.json({limit:'24kb',strict:true}));
  router.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');if(!['GET','HEAD'].includes(req.method)&&!require('./request-origin').matches(req,origin))return res.status(403).json({success:false,code:'ORIGIN_DENIED'});next();});
  async function use(req,fn) {
    const session=req.featureSession.refresh?await req.featureSession.refresh():req.featureSession;
    const db=await pool.getConnection();try{return await fn(db,session.context);}finally{db.release();}
  }
  router.get('/',wrap(async(req,res)=>res.json({success:true,data:await use(req,(db,ctx)=>settings.state(db,ctx))})));
  router.post('/preview',wrap(async(req,res)=>res.json({success:true,data:await use(req,(_db,ctx)=>settings.preview(ctx,req.body.document))})));
  for(const action of ['draft','publish','rollback'])router[action==='draft'?'put':'post']('/'+action,wrap(async(req,res)=>res.json({success:true,data:await use(req,(db,ctx)=>settings.mutate(db,ctx,req.body,action))})));
  router.use((error,req,res,next)=>{if(res.headersSent)return next(error);const status=error.status||(['entity.parse.failed'].includes(error.type)?400:error.type==='entity.too.large'?413:503);res.status(status).json({success:false,code:status>=500?'CUSTOMIZATION_UNAVAILABLE':error.code||(status===413?'BODY_TOO_LARGE':'INVALID_JSON')});});
  return router;
}
module.exports={createTenantCustomizationRouter};
