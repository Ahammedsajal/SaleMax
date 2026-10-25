'use strict';
const express=require('express');const fileUpload=require('express-fileupload');const os=require('node:os');const fs=require('node:fs/promises');
const domains=require('./tenant-crm-domains');const logoMedia=require('./tenant-crm-logo-media');const businessProfile=require('./tenant-business-profile');
function createTenantCrmRouter({pool,canonicalGuard}){
 const router=express.Router(),temp=os.tmpdir(),wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
 router.use(express.json({limit:'12kb',strict:true}));router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
 async function use(fn){const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}}
 router.get('/tenant-context',wrap(async(req,res)=>{if(!req.crmTenantDomain)return res.status(404).json({success:false,code:'CRM_DOMAIN_NOT_FOUND'});const data=await use(db=>domains.publicBrand(db,req.crmTenantDomain.hostname));if(!data)return res.status(404).json({success:false,code:'CRM_DOMAIN_NOT_ACTIVE'});res.json({success:true,data});}));
 router.get('/appearance',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await use(db=>domains.getSettings(db,req.businessContext))})));
 router.get('/branding',canonicalGuard,wrap(async(req,res)=>res.json({success:true,data:await use(db=>domains.getBranding(db,req.businessContext))})));
 router.get('/logos/:tenantId/:filename',wrap(async(req,res)=>{const {tenantId,filename}=req.params;if(req.crmTenantDomain){if(req.crmTenantDomain.tenantId!==tenantId)return res.status(404).end();return sendLogo(res,tenantId,filename);}return canonicalGuard(req,res,()=>{if(req.businessContext?.tenant?.id!==tenantId)return res.status(404).end();return sendLogo(res,tenantId,filename);});}));
 router.put('/branding',(req,res,next)=>{if(!req.is('multipart/form-data'))return next();fileUpload({useTempFiles:true,tempFileDir:temp,limits:{fileSize:logoMedia.MAX_LOGO_BYTES,files:1,fields:2,fieldSize:20*1024},abortOnLimit:false})(req,res,next);},canonicalGuard,wrap(async(req,res)=>{
  const file=req.files?.logo||null,clear=req.body?.clearLogo==='true';if(Array.isArray(file))throw Object.assign(new Error('INVALID_LOGO_FILE'),{code:'INVALID_LOGO_FILE'});
  const ctx=req.businessContext,profile=await use(db=>businessProfile.get(db,ctx));const expected=Number(req.body?.expectedRevision);
  const data=await use(db=>businessProfile.save(db,ctx,expected,profile,{logoFile:file,clearLogo:clear}));res.json({success:true,data:{logoUrl:data.logoUrl,revision:data.revision}});
 }));
 router.put('/profile',(req,res,next)=>{if(!req.is('multipart/form-data'))return next();fileUpload({useTempFiles:true,tempFileDir:temp,limits:{fileSize:logoMedia.MAX_LOGO_BYTES,files:2,fields:1,fieldSize:24*1024},abortOnLimit:false})(req,res,next);},canonicalGuard,wrap(async(req,res)=>{
  let value;try{value=JSON.parse(req.body?.profile||'');}catch(_){throw Object.assign(new Error('INVALID_PROFILE'),{code:'INVALID_PROFILE'});}
  const logoFile=req.files?.logo||null,faviconFile=req.files?.favicon||null;if(Array.isArray(logoFile)||Array.isArray(faviconFile))throw Object.assign(new Error('INVALID_LOGO_FILE'),{code:'INVALID_LOGO_FILE'});
  const data=await use(db=>businessProfile.save(db,req.businessContext,value?.expectedRevision,value,{logoFile,faviconFile,clearLogo:value?.clearLogo===true,clearFavicon:value?.clearFavicon===true}));res.json({success:true,data});
 }));
 router.use((e,req,res,next)=>{if(res.headersSent)return next(e);const code=e.code||'CRM_APPEARANCE_UNAVAILABLE',status=Number.isInteger(e.status)?e.status:code==='PERMISSION_DENIED'?403:code==='STALE_REVISION'?409:code==='DOMAIN_NOT_FOUND'?404:code.startsWith('INVALID_')?400:503;const tmp=Object.values(req.files||{}).flat().filter(Boolean).map(f=>f.tempFilePath).filter(Boolean);Promise.all(tmp.map(f=>fs.rm(f,{force:true}).catch(()=>{}))).finally(()=>res.status(status).json({success:false,code:status>=500?'CRM_APPEARANCE_UNAVAILABLE':code}));});
 return router;
 function sendLogo(res,tenantId,filename){const url=`/api/crm/logos/${tenantId}/${filename}`,file=logoMedia.managedPath(url,tenantId);if(!file)return res.status(404).end();res.setHeader('Cache-Control','private, max-age=300');res.setHeader('X-Content-Type-Options','nosniff');return res.sendFile(file,error=>{if(error&&!res.headersSent)res.status(error.code==='ENOENT'?404:503).end();});}
}
module.exports={createTenantCrmRouter};
