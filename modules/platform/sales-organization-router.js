'use strict';
const express=require('express');
const organization=require('./sales-organization');
function createSalesOrganizationRouter({pool,canonicalGuard}){
  const router=express.Router();
  router.use(express.json({limit:'8kb',strict:true}),canonicalGuard,(req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  async function use(fn){const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}}
  router.get('/',wrap(async(req,res)=>res.json({success:true,data:await use(db=>organization.list(db,req.businessContext))})));
  router.post('/:membershipId/reassign',wrap(async(req,res)=>res.json({success:true,data:await use(db=>organization.reassign(db,req.businessContext,req.params.membershipId,req.body||{}))})));
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const code=error.code||'',status=['PERMISSION_DENIED','CATEGORY_UNAVAILABLE'].includes(code)?403:['MEMBER_NOT_FOUND'].includes(code)?404:['INVALID_ASSIGNMENT','INVALID_REASON','INVALID_MANAGER','INVALID_TEAM_LEADER','TEAM_LEADER_OUTSIDE_MANAGER','TEAM_LEADER_ASSIGNMENT_INVALID'].includes(code)?400:error.type==='entity.parse.failed'?400:error.type==='entity.too.large'?413:503;
    res.status(status).json({success:false,code:status===503?'SALES_ORGANIZATION_UNAVAILABLE':error.type==='entity.parse.failed'?'INVALID_JSON':error.type==='entity.too.large'?'BODY_TOO_LARGE':code});
  });
  return router;
}
module.exports={createSalesOrganizationRouter};
