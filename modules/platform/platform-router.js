const crypto=require('node:crypto');
const express=require('express');
const plans=require('./plans');
const {platformDecision}=require('./policy');
const {trainingCenter}=require('./categories');
const {items:nav}=require('./navigation');
function createPlatformRouter({pool,guard}){
  const router=express.Router();router.use(guard);router.use(express.json({limit:'24kb',strict:true}));
  router.use((req,res,next)=>{
    if(!['GET','HEAD'].includes(req.method)&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body)))return next(Object.assign(new Error(),{code:'INVALID_BODY'}));
    next();
  });
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  async function use(fn){const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}}
  function authorized(req,key){if(!platformDecision(req.businessContext,key))throw Object.assign(new Error('PERMISSION_DENIED'),{code:'PERMISSION_DENIED'});}
  router.get('/context',wrap(async(req,res)=>{
    authorized(req,'plans.read');
    res.json({identity:req.businessContext.identity,category:trainingCenter,features:nav.map(({capability,label})=>({key:capability,label})).filter((v,i,a)=>a.findIndex(x=>x.key===v.key)===i),permissions:Object.fromEntries(['plans.read','plans.draft','plans.publish','plans.assign','tenants.read'].map(k=>[k,platformDecision(req.businessContext,k)]))});
  }));
  router.get('/plans',wrap(async(req,res)=>res.json(await use(db=>plans.listVersions(db,req.businessContext,{search:req.query.search??'',status:req.query.status??'',offset:req.query.offset===undefined?0:Number(req.query.offset)})))));
  router.get('/plans/:id',wrap(async(req,res)=>res.json(await use(db=>plans.getVersion(db,req.businessContext,req.params.id)))));
  router.post('/plans',wrap(async(req,res)=>res.status(201).json(await use(db=>plans.createDraft(db,req.businessContext,req.body)))));
  router.put('/plans/:id',wrap(async(req,res)=>res.json(await use(db=>plans.updateDraft(db,req.businessContext,req.params.id,req.body.revision,req.body)))));
  router.post('/plans/:id/publish',wrap(async(req,res)=>res.json(await use(db=>plans.publish(db,req.businessContext,req.params.id,req.body.revision)))));
  router.get('/tenants',wrap(async(req,res)=>{
    authorized(req,'tenants.read');const offset=req.query.offset===undefined?0:Number(req.query.offset),search=req.query.search??'';if(!Number.isSafeInteger(offset)||offset<0||offset>10000||typeof search!=='string'||search.length>100)throw Object.assign(new Error(),{code:'INVALID_QUERY'});
    const rows=await use(async db=>{const [rows]=await db.query('SELECT id,name,slug,status,category_key AS categoryKey FROM sx_tenants WHERE name LIKE ? OR slug LIKE ? ORDER BY name,id LIMIT 51 OFFSET ?',['%'+search+'%','%'+search+'%',offset]);return rows;});
    res.json({items:rows.slice(0,50),nextOffset:rows.length>50?offset+50:null});
  }));
  router.post('/assignments/preview',wrap(async(req,res)=>{
    authorized(req,'plans.assign');if(!Number.isSafeInteger(req.body.durationDays)||req.body.durationDays<1||req.body.durationDays>3650)throw Object.assign(new Error(),{code:'INVALID_DURATION'});
    res.json(await use(db=>plans.previewAssignment(db,req.businessContext,req.body)));
  }));
  router.post('/assignments',wrap(async(req,res)=>res.status(201).json(await use(db=>plans.assign(db,req.businessContext,req.body)))));
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const code=error.code||'',status=code==='PERMISSION_DENIED'?403:['PLAN_NOT_FOUND','TENANT_NOT_FOUND'].includes(code)?404:['STALE_REVISION','PUBLISHED_PLAN_IMMUTABLE','PLAN_LIMIT_EXCEEDED','SEATS_IN_USE'].includes(code)?409:code.startsWith('INVALID_')||['ONE_OWNER_REQUIRED','CATEGORY_UNAVAILABLE','PUBLISHED_PLAN_REQUIRED','ACCOUNT_INACTIVE'].includes(code)?400:error.type==='entity.parse.failed'?400:error.type==='entity.too.large'?413:500;
    const response={code:status===500?'PLATFORM_UNAVAILABLE':error.type==='entity.parse.failed'?'INVALID_JSON':error.type==='entity.too.large'?'BODY_TOO_LARGE':code};
    // Denied/rejected mutations are logged outside the rolled-back business transaction.
    if(!['GET','HEAD'].includes(req.method)&&req.businessContext?.identity?.id){
      use(db=>db.query(`INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
        VALUES (?,?,'identity','platform.request-rejected','platform',?,?,?)`,[crypto.randomUUID(),req.businessContext.identity.id,req.route?.path||'unknown',JSON.stringify({code:response.code}),crypto.randomUUID()])).then(()=>res.status(status).json(response)).catch(()=>res.status(503).json({code:'AUDIT_UNAVAILABLE'}));
    }else res.status(status).json(response);
  });return router;
}
module.exports={createPlatformRouter};
