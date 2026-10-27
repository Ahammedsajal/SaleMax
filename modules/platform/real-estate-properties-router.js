'use strict';
const express=require('express');
const properties=require('./real-estate-properties');
const inventory=require('./real-estate-inventory');
const media=require('./real-estate-unit-media');
const fs=require('node:fs/promises');

function createRouter({pool,authenticate}){
  const router=express.Router(),wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  let activeUploads=0;
  router.use(express.json({limit:'16kb',strict:true}));
  router.use(authenticate);
  router.get('/buildings',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await inventory.listBuildings(db,req.businessContext)});}finally{db.release();}}));
  router.post('/buildings',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.status(201).json({success:true,data:await inventory.createBuilding(db,req.businessContext,req.body)});}finally{db.release();}}));
  router.get('/units',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await inventory.listUnits(db,req.businessContext,req.query)});}finally{db.release();}}));
  router.get('/units/:id',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await inventory.getUnit(db,req.businessContext,req.params.id)});}finally{db.release();}}));
  router.get('/units/:id/media',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await media.list(db,req.businessContext,req.params.id)});}finally{db.release();}}));
  router.get('/units/:id/media/:mediaId/content',wrap(async(req,res)=>{const db=await pool.getConnection();let file;try{file=await media.getFile(db,req.businessContext,req.params.id,req.params.mediaId);}finally{db.release();}await fs.access(file.path);res.setHeader('Content-Type',file.mimeType);res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.setHeader('Content-Disposition',`${file.kind==='document'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`);res.sendFile(file.path,{dotfiles:'deny',acceptRanges:true},error=>{if(error&&!res.headersSent)res.status(error.statusCode||404).json({success:false,code:'MEDIA_NOT_FOUND'});});}));
  router.put('/units/:id/media/order',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await media.update(db,req.businessContext,req.params.id,req.body)});}finally{db.release();}}));
  router.delete('/units/:id/media/:mediaId',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await media.remove(db,req.businessContext,req.params.id,req.params.mediaId)});}finally{db.release();}}));
  router.post('/units/:id/media',async(req,res,next)=>{try{properties.authorize(req.businessContext,'properties.manage');if(activeUploads>=1)return res.status(429).json({success:false,code:'MEDIA_UPLOAD_BUSY'});activeUploads++;let released=false;const release=()=>{if(!released){released=true;activeUploads--;}};res.once('finish',release);res.once('close',release);await media.ensureDirectories();require('express-fileupload')({useTempFiles:true,tempFileDir:media.tempDirectory(),safeFileNames:true,limits:{fileSize:media.MAX_BYTES,files:1},abortOnLimit:false})(req,res,next);}catch(error){next(error);}},wrap(async(req,res)=>{const file=req.files?.file;if(!file||Array.isArray(file))throw Object.assign(Error('MEDIA_FILE_REQUIRED'),{code:'MEDIA_FILE_REQUIRED',status:400});const db=await pool.getConnection();try{res.status(201).json({success:true,data:await media.attach(db,req.businessContext,req.params.id,file)});}finally{db.release();if(file.tempFilePath)await fs.rm(file.tempFilePath,{force:true}).catch(()=>{});}}));
  router.put('/units/:id',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await inventory.updateUnit(db,req.businessContext,req.params.id,req.body)});}finally{db.release();}}));
  router.post('/units',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.status(201).json({success:true,data:await inventory.createUnit(db,req.businessContext,req.body)});}finally{db.release();}}));
  router.put('/units/:id/availability',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await inventory.setAvailability(db,req.businessContext,req.params.id,req.body)});}finally{db.release();}}));
  router.post('/listings',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.status(201).json({success:true,data:await inventory.createListing(db,req.businessContext,req.body)});}finally{db.release();}}));
  router.get('/',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await properties.list(db,req.businessContext,req.query)});}finally{db.release();}}));
  router.get('/assignees',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await properties.listAssignees(db,req.businessContext)});}finally{db.release();}}));
  router.post('/',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.status(201).json({success:true,data:await properties.create(db,req.businessContext,req.body)});}finally{db.release();}}));
  router.put('/:id',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await properties.update(db,req.businessContext,req.params.id,req.body)});}finally{db.release();}}));
  router.use(async(error,req,res,next)=>{if(res.headersSent)return next(error);const temporary=Object.values(req.files||{}).flat().filter(Boolean).map(file=>file.tempFilePath).filter(Boolean);await Promise.all(temporary.map(file=>fs.rm(file,{force:true}).catch(()=>{})));const code=error.code||'PROPERTY_SERVICE_UNAVAILABLE';const status=Number(error.status)||(['PERMISSION_DENIED'].includes(code)?403:['PROPERTY_NOT_FOUND'].includes(code)?404:['STALE_REVISION','INVALID_PROPERTY_TRANSITION','PROPERTY_ASSIGNEE_UNAVAILABLE'].includes(code)?409:code.startsWith('INVALID_')?400:503);res.status(status).json({success:false,code:status>=500?'PROPERTY_SERVICE_UNAVAILABLE':code});});
  return router;
}
module.exports={createRouter};
