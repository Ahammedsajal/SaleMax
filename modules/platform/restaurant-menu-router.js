'use strict';
const express=require('express');
const menu=require('./restaurant-menu');

function createRouter({pool,authenticate}){
  const router=express.Router(),wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  router.use(express.json({limit:'16kb',strict:true}),authenticate);
  const use=async fn=>{const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}};
  router.get('/',wrap(async(req,res)=>res.json({success:true,data:await use(db=>menu.list(db,req.businessContext))})));
  router.post('/items',wrap(async(req,res)=>res.status(201).json({success:true,data:await use(db=>menu.createMenuItem(db,req.businessContext,req.body))})));
  router.put('/items/:id',wrap(async(req,res)=>res.json({success:true,data:await use(db=>menu.updateMenuItem(db,req.businessContext,req.params.id,req.body))})));
  router.post('/items/:id/groups',wrap(async(req,res)=>res.status(201).json({success:true,data:await use(db=>menu.createGroup(db,req.businessContext,req.params.id,req.body))})));
  router.put('/groups/:id',wrap(async(req,res)=>res.json({success:true,data:await use(db=>menu.updateGroup(db,req.businessContext,req.params.id,req.body))})));
  router.post('/groups/:id/options',wrap(async(req,res)=>res.status(201).json({success:true,data:await use(db=>menu.createOption(db,req.businessContext,req.params.id,req.body))})));
  router.put('/options/:id',wrap(async(req,res)=>res.json({success:true,data:await use(db=>menu.updateOption(db,req.businessContext,req.params.id,req.body))})));
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const code=error.type==='entity.parse.failed'?'INVALID_JSON':error.type==='entity.too.large'?'BODY_TOO_LARGE':error.code||'RESTAURANT_MENU_UNAVAILABLE';
    const status=Number(error.status)||(error.type==='entity.too.large'?413:error.type==='entity.parse.failed'?400:code==='PERMISSION_DENIED'?403:code==='CATEGORY_UNAVAILABLE'?404:['STALE_REVISION','RESTAURANT_MENU_ITEM_EXISTS','RESTAURANT_BRANCH_UNAVAILABLE','RESTAURANT_MODIFIER_GROUP_LIMIT','RESTAURANT_MODIFIER_OPTION_LIMIT','MODIFIER_OPTIONS_BELOW_REQUIRED_MINIMUM'].includes(code)?409:code.endsWith('_NOT_FOUND')?404:code.startsWith('INVALID_')?400:503);
    return res.status(status).json({success:false,code:status>=500?'RESTAURANT_MENU_UNAVAILABLE':code});
  });
  return router;
}
module.exports={createRouter};
