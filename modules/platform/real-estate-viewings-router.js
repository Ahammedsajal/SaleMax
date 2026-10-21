'use strict';
const crypto=require('node:crypto');
const express=require('express');
const viewings=require('./real-estate-viewings');
function createRouter({pool,authenticate}){
  const router=express.Router(),wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  const context=req=>{const ownerUid=req.featureSession?.ownerUid;return {...req.businessContext,legacyUidHash:typeof ownerUid==='string'?crypto.createHash('sha256').update(ownerUid,'utf8').digest('hex'):null};};
  router.use(express.json({limit:'16kb',strict:true}),authenticate);
  const withDb=fn=>wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await fn(db,context(req),req)});}finally{db.release();}});
  router.get('/assignees',withDb((db,ctx)=>viewings.listAssignees(db,ctx)));
  router.get('/leads',withDb((db,ctx)=>viewings.listLeads(db,ctx)));
  router.get('/properties',withDb((db,ctx)=>viewings.listProperties(db,ctx)));
  router.get('/',withDb((db,ctx,req)=>viewings.list(db,ctx,req.query)));
  router.post('/',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.status(201).json({success:true,data:await viewings.create(db,context(req),req.body)});}finally{db.release();}}));
  router.put('/:id',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await viewings.update(db,context(req),req.params.id,req.body)});}finally{db.release();}}));
  router.use((error,req,res,next)=>{if(res.headersSent)return next(error);const code=error.code||'VIEWING_SERVICE_UNAVAILABLE';const status=Number(error.status)||(['PERMISSION_DENIED'].includes(code)?403:['VIEWING_NOT_FOUND','VIEWING_LEAD_NOT_FOUND','VIEWING_PROPERTY_NOT_FOUND','VIEWING_REQUIREMENT_NOT_FOUND'].includes(code)?404:['STALE_REVISION','INVALID_VIEWING_TRANSITION','VIEWING_SLOT_UNAVAILABLE','VIEWING_ASSIGNEE_UNAVAILABLE','VIEWING_PROPERTY_UNAVAILABLE','VIEWING_LEAD_UNAVAILABLE'].includes(code)?409:code.startsWith('INVALID_')?400:503);res.status(status).json({success:false,code:status>=500?'VIEWING_SERVICE_UNAVAILABLE':code});});
  return router;
}
module.exports={createRouter};
