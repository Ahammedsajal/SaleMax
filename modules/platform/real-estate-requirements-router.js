'use strict';
const crypto=require('node:crypto');
const express=require('express');
const requirements=require('./real-estate-requirements');
function createRouter({pool,authenticate}){
  const router=express.Router(),wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  const context=req=>{
    const ownerUid=req.featureSession?.ownerUid;
    return {...req.businessContext,legacyUidHash:typeof ownerUid==='string'?crypto.createHash('sha256').update(ownerUid,'utf8').digest('hex'):null};
  };
  router.use(express.json({limit:'16kb',strict:true}));router.use(authenticate);
  router.get('/assignees',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await requirements.listAssignees(db,context(req))});}finally{db.release();}}));
  router.get('/lead-options',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await requirements.leadOptions(db,context(req))});}finally{db.release();}}));
  router.get('/',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await requirements.list(db,context(req),req.query)});}finally{db.release();}}));
  router.post('/',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.status(201).json({success:true,data:await requirements.create(db,context(req),req.body)});}finally{db.release();}}));
  router.put('/:id',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await requirements.update(db,context(req),req.params.id,req.body)});}finally{db.release();}}));
  router.get('/:id/matches',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await requirements.matches(db,context(req),req.params.id)});}finally{db.release();}}));
  router.use((error,req,res,next)=>{if(res.headersSent)return next(error);const code=error.code||'REQUIREMENT_SERVICE_UNAVAILABLE';const status=Number(error.status)||(['PERMISSION_DENIED'].includes(code)?403:['REQUIREMENT_NOT_FOUND','REQUIREMENT_LEAD_NOT_FOUND'].includes(code)?404:['ER_DUP_ENTRY','STALE_REVISION','INVALID_REQUIREMENT_TRANSITION','REQUIREMENT_ASSIGNEE_UNAVAILABLE','REQUIREMENT_LEAD_UNAVAILABLE'].includes(code)?409:code.startsWith('INVALID_')?400:503);res.status(status).json({success:false,code:code==='ER_DUP_ENTRY'?'REQUIREMENT_ALREADY_EXISTS':status>=500?'REQUIREMENT_SERVICE_UNAVAILABLE':code});});
  return router;
}
module.exports={createRouter};
