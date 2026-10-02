'use strict';
const crypto=require('node:crypto');
const express=require('express');
const staff=require('./staff-access');
const portfolios=require('./user-portfolio');

function createExistingPlatformAccessRouters({pool,origin}){
  const admin=express.Router(),accept=express.Router();
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
  async function use(fn){const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}}
  admin.use(express.json({limit:'16kb',strict:true}));
  admin.use((req,res,next)=>{
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body)))return res.status(400).json({code:'INVALID_BODY'});
    res.setHeader('Cache-Control','no-store');next();
  });
  admin.use(wrap(async(req,res,next)=>{
    const context=req.businessContext;
    if(context?.audience!=='platform')throw Object.assign(new Error(),{code:'PLATFORM_REQUIRED'});
    const uidHash=crypto.createHash('sha256').update(req.decode.uid,'utf8').digest('hex');
    const [links]=await use(db=>db.query('SELECT legacy_uid,identity_id,status FROM sx_legacy_admin_identities WHERE legacy_admin_id=? AND legacy_uid_hash=?',[req.legacyAdminId,uidHash]));
    if(links.length!==1||links[0].legacy_uid!==req.decode.uid||links[0].identity_id!==context.identity.id||links[0].status!=='active')throw Object.assign(new Error(),{code:'VERIFIED_ADMIN_LINK_REQUIRED'});
    next();
  }));
  admin.get('/staff',wrap(async(req,res)=>res.json({success:true,data:await use(db=>staff.list(db,req.businessContext))})));
  admin.post('/staff/invitations',wrap(async(req,res)=>res.status(201).json({success:true,data:await use(db=>staff.createInvite(db,req.businessContext,req.body))})));
  admin.post('/staff/invitations/:id/resend',wrap(async(req,res)=>res.json({success:true,data:await use(db=>staff.rotateInvite(db,req.businessContext,req.params.id))})));
  admin.post('/staff/invitations/:id/cancel',wrap(async(req,res)=>res.json({success:true,data:await use(db=>staff.cancelInvite(db,req.businessContext,req.params.id))})));
  admin.patch('/staff/:identityId',wrap(async(req,res)=>res.json({success:true,data:await use(db=>staff.updateStaff(db,req.businessContext,req.params.identityId,req.body))})));
  admin.get('/portfolios',wrap(async(req,res)=>{
    const context=req.businessContext;if(context?.membership?.role!=='super_admin')throw Object.assign(new Error(),{code:'PERMISSION_DENIED'});
    const data=await use(async db=>{
      const [admins]=await db.query(`SELECT i.id,i.email_normalized AS email,i.display_name AS displayName,COUNT(p.legacy_user_id) AS customerCount
        FROM sx_platform_memberships m JOIN sx_identities i ON i.id=m.identity_id
        LEFT JOIN sx_platform_user_portfolios p ON p.managed_by_identity_id=i.id
        WHERE m.role='platform_admin' AND m.status='active' AND i.status='active' GROUP BY i.id,i.email_normalized,i.display_name ORDER BY i.email_normalized`);
      const [[unassigned]]=await db.query(`SELECT COUNT(*) AS count FROM user u LEFT JOIN sx_platform_user_portfolios p ON p.legacy_user_id=u.id WHERE p.legacy_user_id IS NULL OR p.managed_by_identity_id IS NULL`);
      return {admins:admins.map(row=>({...row,customerCount:Number(row.customerCount||0)})),unassignedCount:Number(unassigned.count||0)};
    });res.json({success:true,data});
  }));
  admin.put('/portfolios/:userId',wrap(async(req,res)=>{
    const context=req.businessContext;if(context?.membership?.role!=='super_admin')throw Object.assign(new Error(),{code:'PERMISSION_DENIED'});
    if(!/^\d+$/.test(req.params.userId))throw Object.assign(new Error(),{code:'INVALID_USER_ID'});
    const result=await use(async db=>{await db.beginTransaction();try{const value=await portfolios.assign(db,context,req.params.userId,req.body?.managedByIdentityId??null);await db.commit();return value;}catch(error){await db.rollback();throw error;}});
    res.json({success:true,data:result});
  }));
  admin.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const code=error.code||'',status=['PERMISSION_DENIED','PLATFORM_REQUIRED','VERIFIED_ADMIN_LINK_REQUIRED'].includes(code)?403:['INVITE_NOT_FOUND','STAFF_NOT_FOUND','USER_NOT_FOUND'].includes(code)?404:['IDENTITY_EXISTS','LEGACY_ADMIN_EXISTS','INVITE_NOT_PENDING','STAFF_IDENTITY_INACTIVE','ADMIN_MANAGER_NOT_FOUND','PORTFOLIO_OWNER_NOT_FOUND'].includes(code)?409:code.startsWith('INVALID_')?400:error.type==='entity.parse.failed'?400:error.type==='entity.too.large'?413:503;
    const body={code:status===503?'PLATFORM_ACCESS_UNAVAILABLE':error.type==='entity.parse.failed'?'INVALID_JSON':error.type==='entity.too.large'?'BODY_TOO_LARGE':code};
    if(!['GET','HEAD'].includes(req.method)&&req.businessContext?.identity?.id){
      use(db=>db.query(`INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
        VALUES (?,?,'identity','platform.staff.request-rejected','platform-staff',?,?,?)`,[crypto.randomUUID(),req.businessContext.identity.id,req.params.identityId||req.params.id||'unknown',JSON.stringify(body),crypto.randomUUID()])).then(()=>res.status(status).json(body)).catch(()=>res.status(503).json({code:'AUDIT_UNAVAILABLE'}));
    }else res.status(status).json(body);
  });

  accept.use((req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='POST')return next();
    if(req.get('Origin')!==origin)return res.status(403).json({code:'ORIGIN_DENIED'});
    next();
  });
  accept.use(express.json({limit:'8kb',strict:true}));
  accept.post('/accept',wrap(async(req,res)=>{
    if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))return res.status(400).json({code:'INVALID_BODY'});
    const data=await use(db=>staff.acceptInvite(db,req.body));res.status(201).json({success:true,data});
  }));
  accept.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const code=error.code||'',status=code==='INVALID_PASSWORD'||code==='INVALID_DISPLAY_NAME'?400:code==='INVITE_INVALID'?410:error.type==='entity.parse.failed'?400:error.type==='entity.too.large'?413:503;
    res.status(status).json({code:status===503?'INVITATION_UNAVAILABLE':error.type==='entity.parse.failed'?'INVALID_JSON':error.type==='entity.too.large'?'BODY_TOO_LARGE':code});
  });
  return {admin,accept};
}
module.exports={createExistingPlatformAccessRouters};
