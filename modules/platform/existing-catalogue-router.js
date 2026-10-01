const express=require('express');
const crypto=require('node:crypto');
const bridge=require('./catalogue-bridge');
const {platformDecision}=require('./policy');
const {trainingCenter}=require('./categories');
const {items}=require('./navigation');
function createExistingCatalogueRouter({pool,legacyGuard,canonicalGuard}){
  const router=express.Router();router.use(legacyGuard,canonicalGuard);router.use(express.json({limit:'24kb',strict:true}));
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
  function legacyId(req){const raw=req.params.legacyPlanId;if(typeof raw!=='string'||!/^\d+$/.test(raw))throw Object.assign(new Error(),{code:'INVALID_LEGACY_PLAN_ID'});return Number(raw);}
  async function use(fn){const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}}
  router.use(wrap(async(req,res,next)=>{
    const ctx=req.businessContext;
    if(ctx?.audience!=='platform')throw Object.assign(new Error(),{code:'PLATFORM_REQUIRED'});
    const [mapping]=await use(db=>db.query('SELECT legacy_uid,identity_id,status FROM sx_legacy_admin_identities WHERE legacy_admin_id=? AND legacy_uid_hash=?',[req.legacyAdminId,crypto.createHash('sha256').update(req.decode.uid).digest('hex')]));
    if(mapping.length!==1||mapping[0].legacy_uid!==req.decode.uid||mapping[0].identity_id!==ctx.identity.id||mapping[0].status!=='active')throw Object.assign(new Error(),{code:'VERIFIED_ADMIN_LINK_REQUIRED'});
    res.setHeader('Cache-Control','no-store');next();
  }));
  router.get('/context',wrap(async(req,res)=>{
    if(!platformDecision(req.businessContext,'plans.read'))return res.status(403).json({code:'PERMISSION_DENIED'});
    res.json({category:trainingCenter,features:items.map(({capability,label})=>({key:capability,label})).filter((feature,index,all)=>all.findIndex(other=>other.key===feature.key)===index),permissions:Object.fromEntries(['plans.read','plans.draft','plans.publish'].map(permission=>[permission,platformDecision(req.businessContext,permission)]))});
  }));
  router.get('/:legacyPlanId/versions',wrap(async(req,res)=>res.json({items:await use(db=>bridge.list(db,req.businessContext,legacyId(req)))})));
  router.post('/:legacyPlanId/drafts',wrap(async(req,res)=>res.status(201).json(await use(db=>bridge.createDraft(db,req.businessContext,{...req.body,legacyPlanId:legacyId(req)})))));
  router.post('/:legacyPlanId/publish',wrap(async(req,res)=>res.json(await use(db=>bridge.publish(db,req.businessContext,{...req.body,legacyPlanId:legacyId(req)})))));
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const code=error.code||'',status=['PERMISSION_DENIED','PLATFORM_REQUIRED','VERIFIED_ADMIN_LINK_REQUIRED'].includes(code)?403:code==='PLAN_NOT_FOUND'?404:['STALE_REVISION','STALE_COMMERCIAL_CONTRACT','PUBLISHED_PLAN_IMMUTABLE','IDEMPOTENCY_CONFLICT'].includes(code)?409:code.startsWith('INVALID_')||['ONE_OWNER_REQUIRED','CATEGORY_UNAVAILABLE','LEGACY_PLAN_INVALID'].includes(code)?400:error.type==='entity.parse.failed'?400:error.type==='entity.too.large'?413:503;
    const response={code:status===503?'CATALOGUE_UNAVAILABLE':error.type==='entity.parse.failed'?'INVALID_JSON':error.type==='entity.too.large'?'BODY_TOO_LARGE':code};
    if(!['GET','HEAD'].includes(req.method)&&req.businessContext?.identity?.id){
      use(db=>db.query("INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,'identity','catalogue.request-rejected','catalogue',?,?,?)",[crypto.randomUUID(),req.businessContext.identity.id,req.route?.path||'unknown',JSON.stringify(response),crypto.randomUUID()])).then(()=>res.status(status).json(response)).catch(()=>res.status(503).json({code:'AUDIT_UNAVAILABLE'}));
    }else res.status(status).json(response);
  });return router;
}
module.exports={createExistingCatalogueRouter};
