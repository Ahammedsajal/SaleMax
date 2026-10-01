'use strict';
const express=require('express');
const crypto=require('node:crypto');
const assignment=require('./business-contract-assignment');
const legacy=require('./legacy-plan-assignment');
const {platformDecision}=require('./policy');
function createExistingBusinessRouter({pool,legacyGuard,canonicalGuard}){
  const router=express.Router();router.use(legacyGuard,canonicalGuard);router.use(express.json({limit:'24kb',strict:true}));
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
  async function use(fn){const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}}
  router.use(wrap(async(req,res,next)=>{
    const ctx=req.businessContext;if(ctx?.audience!=='platform')throw Object.assign(new Error(),{code:'PLATFORM_REQUIRED'});
    const uidHash=crypto.createHash('sha256').update(req.decode.uid).digest('hex');
    const [links]=await use(db=>db.query('SELECT legacy_uid,identity_id,status FROM sx_legacy_admin_identities WHERE legacy_admin_id=? AND legacy_uid_hash=?',[req.legacyAdminId,uidHash]));
    if(links.length!==1||links[0].legacy_uid!==req.decode.uid||links[0].identity_id!==ctx.identity.id||links[0].status!=='active')throw Object.assign(new Error(),{code:'VERIFIED_ADMIN_LINK_REQUIRED'});
    res.setHeader('Cache-Control','no-store');next();
  }));
  router.get('/:userId/context',wrap(async(req,res)=>{
    if(!platformDecision(req.businessContext,'plans.read'))return res.status(403).json({code:'PERMISSION_DENIED'});
    if(!/^\d+$/.test(req.params.userId)||Number(req.params.userId)<1||Number(req.params.userId)>2147483647)return res.status(400).json({code:'INVALID_ASSIGNMENT'});
    const data=await use(async db=>{
      const user=await getUser(db,Number(req.params.userId));
      const [[mapping]]=await db.query("SELECT tenant_id,membership_id,legacy_uid_hash,verified_at FROM sx_legacy_ownership WHERE source_table='user' AND source_id=?",[String(user.id)]);
      if(!mapping)return {userId:user.id,uid:user.uid,name:user.name,current:legacy.summary(user.plan),expiresAt:user.plan_expire,linked:false,versions:[]};
      if(mapping.legacy_uid_hash!==crypto.createHash('sha256').update(user.uid).digest('hex'))throw Object.assign(new Error(),{code:'VERIFIED_BUSINESS_LINK_REQUIRED'});
      const [[tenant]]=await db.query('SELECT id,name,status,category_key,category_version,revision FROM sx_tenants WHERE id=?',[mapping.tenant_id]);
      if(!tenant)return {userId:user.id,uid:user.uid,name:user.name,current:legacy.summary(user.plan),expiresAt:user.plan_expire,linked:false,versions:[]};
      const state=crypto.createHash('sha256').update(JSON.stringify([user.plan==null?null:String(user.plan),user.plan_expire==null?null:String(user.plan_expire),mapping.tenant_id,mapping.membership_id,mapping.legacy_uid_hash,String(mapping.verified_at),String(tenant.revision)])).digest('hex');
      const [versions]=await db.query("SELECT v.id,v.version,v.category_key AS categoryKey,v.category_version AS categoryVersion,v.role_limits AS roleLimits,v.capabilities,c.commercial_snapshot AS commercial FROM sx_plan_versions v JOIN sx_legacy_plan_contracts c ON c.version_id=v.id WHERE v.status='published' AND v.category_key=? AND v.category_version=? ORDER BY c.legacy_plan_id,v.version DESC LIMIT 100",[tenant.category_key,tenant.category_version]);
      return {userId:user.id,uid:user.uid,name:user.name,current:legacy.summary(user.plan),expiresAt:user.plan_expire,linked:true,tenant,verifiedAt:mapping.verified_at,state,versions:versions.map(v=>({id:v.id,version:v.version,categoryKey:v.categoryKey,categoryVersion:v.categoryVersion,roleLimits:JSON.parse(v.roleLimits),capabilities:JSON.parse(v.capabilities),commercial:JSON.parse(v.commercial)}))};
    });
    data.permissions={read:platformDecision(req.businessContext,'plans.read'),assign:platformDecision(req.businessContext,'plans.assign')};res.json({success:true,data});
  }));
  router.post('/:userId/preview',wrap(async(req,res)=>{
    if(!/^\d+$/.test(req.params.userId)||Number(req.params.userId)<1||Number(req.params.userId)>2147483647)return res.status(400).json({code:'INVALID_ASSIGNMENT'});
    const data=await use(db=>assignment.preview(db,req.businessContext,{...req.body,userId:Number(req.params.userId)}));res.json({success:true,data});
  }));
  router.post('/:userId/assign',wrap(async(req,res)=>{
    if(!/^\d+$/.test(req.params.userId)||Number(req.params.userId)<1||Number(req.params.userId)>2147483647)return res.status(400).json({code:'INVALID_ASSIGNMENT'});
    const data=await use(db=>assignment.assign(db,req.businessContext,{...req.body,userId:Number(req.params.userId)}));res.json({success:true,data});
  }));
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const code=error.code||'',status=['PERMISSION_DENIED','PLATFORM_REQUIRED','VERIFIED_ADMIN_LINK_REQUIRED'].includes(code)?403:['USER_NOT_FOUND'].includes(code)?404:['STALE_ASSIGNMENT','PUBLISHED_PLAN_IMMUTABLE','IDEMPOTENCY_CONFLICT','AMBIGUOUS_BUSINESS_LINK','AMBIGUOUS_USER','VERIFIED_BUSINESS_LINK_REQUIRED','MAPPED_TENANT_REQUIRES_CONTRACT_ASSIGNMENT'].includes(code)?409:code.startsWith('INVALID_')||['ONE_OWNER_REQUIRED','CATEGORY_UNAVAILABLE','PUBLISHED_PLAN_REQUIRED','ACCOUNT_INACTIVE','PLAN_LIMIT_EXCEEDED','SEATS_IN_USE'].includes(code)?400:error.type==='entity.parse.failed'?400:error.type==='entity.too.large'?413:503;
    const body={code:status===503?'ASSIGNMENT_UNAVAILABLE':error.type==='entity.parse.failed'?'INVALID_JSON':error.type==='entity.too.large'?'BODY_TOO_LARGE':code};
    if(!['GET','HEAD'].includes(req.method)&&req.businessContext?.identity?.id){
      use(db=>db.query("INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,'identity','business-contract.request-rejected','business-account',?,?,?)",[crypto.randomUUID(),req.businessContext.identity.id,req.params.userId||'unknown',JSON.stringify(body),crypto.randomUUID()])).then(()=>res.status(status).json(body)).catch(()=>res.status(503).json({code:'AUDIT_UNAVAILABLE'}));
    }else res.status(status).json(body);
  });
  return router;
}
async function getUser(db,id){
  const [[user]]=await db.query('SELECT id,uid,name,plan,plan_expire FROM user WHERE id=?',[id]);
  if(!user)throw Object.assign(new Error(),{code:'USER_NOT_FOUND'});
  const [matches]=await db.query('SELECT id FROM user WHERE uid=?',[user.uid]);if(matches.length!==1)throw Object.assign(new Error(),{code:'AMBIGUOUS_USER'});
  return user;
}
module.exports={createExistingBusinessRouter};
