'use strict';
const express=require('express');
const properties=require('./real-estate-properties');

function createRouter({pool,authenticate}){
  const router=express.Router(),wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  router.use(express.json({limit:'16kb',strict:true}));
  router.use(authenticate);
  router.get('/',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await properties.list(db,req.businessContext,req.query)});}finally{db.release();}}));
  router.get('/assignees',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await properties.listAssignees(db,req.businessContext)});}finally{db.release();}}));
  router.post('/',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.status(201).json({success:true,data:await properties.create(db,req.businessContext,req.body)});}finally{db.release();}}));
  router.put('/:id',wrap(async(req,res)=>{const db=await pool.getConnection();try{res.json({success:true,data:await properties.update(db,req.businessContext,req.params.id,req.body)});}finally{db.release();}}));
  router.use((error,req,res,next)=>{if(res.headersSent)return next(error);const code=error.code||'PROPERTY_SERVICE_UNAVAILABLE';const status=Number(error.status)||(['PERMISSION_DENIED'].includes(code)?403:['PROPERTY_NOT_FOUND'].includes(code)?404:['STALE_REVISION','INVALID_PROPERTY_TRANSITION','PROPERTY_ASSIGNEE_UNAVAILABLE'].includes(code)?409:code.startsWith('INVALID_')?400:503);res.status(status).json({success:false,code:status>=500?'PROPERTY_SERVICE_UNAVAILABLE':code});});
  return router;
}
module.exports={createRouter};
