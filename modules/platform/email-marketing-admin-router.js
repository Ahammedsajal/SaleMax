'use strict';

const crypto=require('node:crypto');
const express=require('express');
const provider=require('./email-marketing-provider-settings');

function createEmailMarketingAdminRouter({pool,key,origin}={}){
  const router=express.Router(),wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
  const withDb=async fn=>{const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}};
  router.use(express.json({limit:'8kb',strict:true}));
  router.use((req,res,next)=>{
    res.setHeader('Cache-Control','no-store, max-age=0');
    res.setHeader('Pragma','no-cache');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!require('./request-origin').matches(req,origin))return res.status(403).json({success:false,code:'ORIGIN_DENIED'});
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body)))return res.status(400).json({success:false,code:'INVALID_BODY'});
    next();
  });
  router.use(wrap(async(req,res,next)=>{
    const context=req.businessContext;
    if(context?.audience!=='platform'||context.membership?.role!=='super_admin'||!require('./policy').platformDecision(context,'providers.configure'))throw Object.assign(Error('PERMISSION_DENIED'),{code:'PERMISSION_DENIED',status:403});
    if(!req.legacyAdminId||typeof req.decode?.uid!=='string')throw Object.assign(Error('VERIFIED_ADMIN_LINK_REQUIRED'),{code:'VERIFIED_ADMIN_LINK_REQUIRED',status:403});
    const uidHash=crypto.createHash('sha256').update(req.decode.uid,'utf8').digest('hex');
    const [links]=await withDb(db=>db.query('SELECT legacy_uid,identity_id,status FROM sx_legacy_admin_identities WHERE legacy_admin_id=? AND legacy_uid_hash=?',[req.legacyAdminId,uidHash]));
    if(links.length!==1||links[0].legacy_uid!==req.decode.uid||links[0].identity_id!==context.identity.id||links[0].status!=='active')throw Object.assign(Error('VERIFIED_ADMIN_LINK_REQUIRED'),{code:'VERIFIED_ADMIN_LINK_REQUIRED',status:403});
    next();
  }));
  router.get('/access',(req,res)=>res.json({success:true,data:{authorized:true}}));
  router.get('/',wrap(async(req,res)=>res.json({success:true,data:await withDb(db=>provider.status(db,key,req.businessContext))})));
  router.put('/credentials',wrap(async(req,res)=>{
    const data=await withDb(db=>provider.save(db,key,req.businessContext,req.body));
    res.json({success:true,data});
  }));
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const code=error.code||'',status=Number.isInteger(error.status)?error.status:
      ['PERMISSION_DENIED','VERIFIED_ADMIN_LINK_REQUIRED'].includes(code)?403:
      code==='STALE_REVISION'?409:code.startsWith('INVALID_')||code==='AWS_CREDENTIALS_REQUIRED'?400:503;
    const known=new Set(['PERMISSION_DENIED','VERIFIED_ADMIN_LINK_REQUIRED','INVALID_SES_REGION','INVALID_AWS_CREDENTIALS','AWS_CREDENTIALS_REQUIRED','AWS_CREDENTIALS_UNAVAILABLE','AWS_SES_PERMISSION_DENIED','SES_THROTTLED','SES_PROVIDER_UNAVAILABLE','EMAIL_PROVIDER_KEY_UNAVAILABLE','EMAIL_PROVIDER_SETTINGS_UNAVAILABLE','STALE_REVISION']);
    res.status(status).json({success:false,code:known.has(code)?code:status===403?'PERMISSION_DENIED':'SES_PROVIDER_UNAVAILABLE'});
  });
  return router;
}

module.exports={createEmailMarketingAdminRouter};
