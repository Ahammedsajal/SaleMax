'use strict';
const express=require('express');
const fileUpload=require('express-fileupload');
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const recruitment=require('./recruitment-applications');
const SALES_CATEGORY_FILTER=`(${recruitment.SALES_CATEGORY_KEYS.map(()=>'?').join(',')})`;
const {publicSubmissionError}=require('./recruitment-public-errors');
const COPY={
  companyName:'Sitta Arbaa Sitta for Software Solutions',crNumber:'251489',
  talabApple:'https://apps.apple.com/qa/app/%D8%B9%D8%B1%D8%B6-%D9%88-%D8%B7%D9%84%D8%A8-%D9%82%D8%B7%D8%B1-talab-qtr/id6744091784',
  talabAndroid:'https://play.google.com/store/apps/details?id=com.talab.white',
  role:'Remote IT/SaaS Sales Associate — India',
  roleSummary:'We are a Qatar-based software and marketing company. We build Talab, a Qatar marketplace app, and 7Network, custom business-management CRM software. You will speak with business leads supplied by us, explain 7Network on Google Meet, and help close annual subscriptions. You will work with the 7Network Sales Manager, who will guide your day-to-day sales activities and targets. The first 2–3 months are a commission-only trial with no base salary. Commission is 15% of each paid QAR 2,500 annual subscription (approximately INR 9,000–9,800 per paid sale). After the trial, successful associates may be considered for a full-time role with basic salary plus commission; this is not guaranteed.',
};
function createPublicRecruitmentRouter({pool,origin,key}){
 const router=express.Router(),wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
 router.use(express.json({limit:'8kb',strict:true}));
 router.get('/:tenantSlug/prefill/:token',wrap(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');const answers=await recruitment.getPrefill(pool,{tenantSlug:req.params.tenantSlug,token:req.params.token});res.json({success:true,data:answers});}));
 router.get('/:tenantSlug',wrap(async(req,res)=>{
  const [[tenant]]=await pool.query(`SELECT id,slug FROM sx_tenants WHERE slug=? AND category_key IN ${SALES_CATEGORY_FILTER} AND status='active' LIMIT 1`,[req.params.tenantSlug,...recruitment.SALES_CATEGORY_KEYS]);
  if(!tenant)return res.status(404).json({success:false,code:'TENANT_NOT_FOUND'});
  res.setHeader('Cache-Control','no-store');res.json({success:true,data:{companyName:'7Network',role:COPY.role,roleSummary:COPY.roleSummary,talabApple:COPY.talabApple,talabAndroid:COPY.talabAndroid,tenantSlug:tenant.slug,consent:recruitment.CONSENT}});
 }));
 router.post('/:tenantSlug',(req,res,next)=>{
  if(!require('./request-origin').matches(req,origin))return res.status(403).json({success:false,code:'ORIGIN_DENIED'});
  if(!req.is('multipart/form-data'))return res.status(400).json({success:false,code:'CV_FILE_REQUIRED'});
  return fileUpload({useTempFiles:true,tempFileDir:require('node:os').tmpdir(),limits:{fileSize:recruitment.MAX_CV_BYTES,files:1,fields:24},abortOnLimit:false})(req,res,next);
 },wrap(async(req,res)=>{
  const remote=req.socket.remoteAddress||'',chain=(req.get('X-Forwarded-For')||'').split(',').map(v=>v.trim()).filter(Boolean),last=chain.at(-1);
  const ip=remote==='127.0.0.1'||remote==='::1'||remote==='::ffff:127.0.0.1'?last||remote:remote;
  const visitorHash=crypto.createHmac('sha256',key).update(String(ip)).digest('hex');
  const file=req.files?.cv;if(Array.isArray(file))throw Object.assign(Error('INVALID_CV_FILE'),{code:'INVALID_CV_FILE'});
  try{const result=await recruitment.createPublic(pool,{tenantSlug:req.params.tenantSlug,body:req.body,file,visitorHash});res.status(result.repeated?200:201).json({success:true,data:{referenceCode:result.referenceCode,repeated:result.repeated,linkedLead:result.leadLinked||false,linkedContact:result.contactLinked||false,linkedChat:result.chatLinked||false}});}
  finally{if(file?.tempFilePath)await fs.rm(file.tempFilePath,{force:true}).catch(()=>{});}
 }));
 router.use((error,req,res,next)=>{if(res.headersSent)return next(error);const result=publicSubmissionError(error);if(result.status>=500){const requestId=crypto.randomUUID();console.error('[recruitment] Public application submission failed',JSON.stringify({requestId,diagnosticCode:result.body.diagnosticCode}));result.body.requestId=requestId;}res.status(result.status).json(result.body);});
 return router;
}

function createRecruitmentRouter({pool,origin,key,userGuard,canonicalGuard}){
 const router=express.Router(),wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);

 const owner=express.Router();owner.use(canonicalGuard);owner.use(express.json({limit:'12kb',strict:true}));owner.use((req,res,next)=>{res.setHeader('Cache-Control','private, no-store');try{recruitment.authorize(req.businessContext);next();}catch(error){next(error);}});
 owner.get('/',wrap(async(req,res)=>{const db=await pool.getConnection();try{const data=await recruitment.list(db,req.businessContext,req.query);const [[tenant]]=await db.query('SELECT slug FROM sx_tenants WHERE id=?',[req.businessContext.tenant.id]);const publicUrl=`${origin.replace(/\/$/,'')}/careers/${encodeURIComponent(tenant.slug)}`;res.json({success:true,data:{...data,publicUrl,role:COPY.role,companyName:COPY.companyName,crNumber:COPY.crNumber}});}finally{db.release();}}));
 owner.get('/screenings',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await recruitment.listScreenings(db,req.businessContext,req.query)});}finally{db.release();}}));
 owner.patch('/:id/status',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await recruitment.updateStatus(db,req.businessContext,req.params.id,req.body.expectedRevision,req.body.status)});}finally{db.release();}}));
 owner.get('/:id/cv',wrap(async(req,res)=>{const db=await pool.getConnection();try{const cv=await recruitment.getCv(db,req.businessContext,req.params.id);res.setHeader('Content-Type',cv.mimeType);res.setHeader('Content-Length',cv.bytes);res.setHeader('Content-Disposition',`attachment; filename="${path.basename(cv.fileName).replace(/["\\\r\n]/g,'_')}"`);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','private, no-store');res.sendFile(cv.filePath,error=>{if(error&&!res.headersSent)res.status(503).end();});}finally{db.release();}}));
 owner.use((error,req,res,next)=>{if(res.headersSent)return next(error);const code=error.code||'RECRUITMENT_UNAVAILABLE',status=Number(error.status)||(['PERMISSION_DENIED'].includes(code)?403:['APPLICATION_NOT_FOUND','TENANT_NOT_FOUND','CV_NOT_FOUND'].includes(code)?404:['STALE_REVISION'].includes(code)?409:['INVALID_','CONSENT_REQUIRED'].some(prefix=>code.startsWith(prefix))?400:503);res.status(status).json({success:false,code:status>=500?'RECRUITMENT_UNAVAILABLE':code});});
 router.use('/',owner);
 router.use((error,req,res,next)=>{if(res.headersSent)return next(error);const code=error.code||'RECRUITMENT_UNAVAILABLE',status=Number(error.status)||(['APPLICATION_RATE_LIMITED'].includes(code)?429:['INVALID_','CONSENT_REQUIRED'].some(prefix=>code.startsWith(prefix))?400:code==='TENANT_NOT_FOUND'?404:503);res.status(status).json({success:false,code:status>=500?'RECRUITMENT_UNAVAILABLE':code});});
 return router;
}
function createRecruitmentPageRouter(app,{pool,origin}){
 app.get('/careers/:tenantSlug',(req,res,next)=>Promise.resolve().then(async()=>{
  const [[tenant]]=await pool.query(`SELECT id FROM sx_tenants WHERE slug=? AND category_key IN ${SALES_CATEGORY_FILTER} AND status='active' LIMIT 1`,[req.params.tenantSlug,...recruitment.SALES_CATEGORY_KEYS]);
  if(!tenant)return res.status(404).send('Application page not found');
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  return res.sendFile(path.resolve(__dirname,'../../client/public/recruitment-application.html'));
 }).catch(next));
}
module.exports={createRecruitmentRouter,createPublicRecruitmentRouter,createRecruitmentPageRouter,COPY};
