'use strict';
const express=require('express');
const net=require('node:net');
const requests=require('./real-estate-viewing-requests');
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};

function createRouter({pool,key,origin}){
  const router=express.Router();
  router.use((req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    if(!require('./request-origin').matches(req,origin))return res.status(403).json({success:false,code:'ORIGIN_DENIED'});
    return next();
  });
  router.use(express.json({limit:'8kb',strict:true}));
  router.get('/:tenantSlug/:propertyId',async(req,res,next)=>{
    const db=await pool.getConnection();try{const result=await requests.publicProperty(db,req.params.tenantSlug,req.params.propertyId);if(!result)return res.status(404).json({success:false,code:'PROPERTY_NOT_AVAILABLE'});return res.json({success:true,data:result});}catch(error){return next(error);}finally{db.release();}
  });
  router.post('/:tenantSlug/:propertyId',async(req,res,next)=>{
    try{
      const forwarded=String(req.get('X-Forwarded-For')||'').split(',').at(-1)?.trim();
      const remote=req.socket.remoteAddress||'unknown';
      const trustedProxy=/^(?:127\.|::1$|::ffff:127\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(remote);
      const visitor=trustedProxy&&net.isIP(forwarded||'')?forwarded:remote;
      const visitorHash=require('node:crypto').createHmac('sha256',key).update(visitor).digest('hex');
      const result=await requests.submitPublic(pool,{tenantSlug:req.params.tenantSlug,propertyId:req.params.propertyId,input:req.body,visitorHash});
      return res.status(result.repeated?200:201).json({success:true,data:result});
    }catch(error){return next(error);}
  });
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const code=error.code||'VIEWING_REQUEST_UNAVAILABLE';
    const status=Number(error.status)||(code==='ORIGIN_DENIED'?403:code==='TENANT_NOT_FOUND'||code==='PROPERTY_NOT_AVAILABLE'||code==='CATEGORY_UNAVAILABLE'||code==='FEATURE_UNAVAILABLE'?404:code==='VIEWING_RATE_LIMITED'?429:code==='IDEMPOTENCY_CONFLICT'?409:code.startsWith('INVALID_')||code.endsWith('_REQUIRED')?400:503);
    res.status(status).json({success:false,code:status>=500?'VIEWING_REQUEST_UNAVAILABLE':code});
  });
  return router;
}
module.exports={createRouter};
