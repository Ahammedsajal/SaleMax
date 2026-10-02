const express=require('express');
const {loadSession}=require('./sessions');
const {createAuthentication}=require('./authentication');
const {loadEntitlements}=require('./plans');
const {trainingCenter}=require('./categories');
const {createMfa}=require('./mfa');
const qrcode=require('qrcode');
function createAuthRouter({pool,key,origin,insecureLoopback=false,allowedAudience='any'}){
  if(!['any','platform','tenant'].includes(allowedAudience))throw new Error('AUTH_AUDIENCE_INVALID');
  const url=new URL(origin);
  if(url.origin!==origin||(!insecureLoopback&&url.protocol!=='https:')||(insecureLoopback&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('AUTH_ORIGIN_INVALID');
  const auth=createAuthentication({key}),router=express.Router();
  const mfa=createMfa({key});
  const cookieName=insecureLoopback?'salemax_dev_session':'__Host-salemax_session';
  const cookie={httpOnly:true,secure:!insecureLoopback,sameSite:'strict',path:'/'};
  function token(req){
    const values=(req.get('Cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(cookieName+'='));
    return values.length===1?values[0].slice(cookieName.length+1):null;
  }
  async function connection(fn){const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}}
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  const audienceMatches=context=>!!context&&(allowedAudience==='any'||context.audience===allowedAudience);
  router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('Origin')!==origin)return res.status(403).json({code:'ORIGIN_DENIED'});next();});
  router.use(express.json({limit:'8kb',strict:true}));
  router.post('/login',wrap(async(req,res)=>{
    if(allowedAudience!=='any'&&req.body?.audience!==allowedAudience)return res.status(400).json({code:'AUTH_INVALID'});
    const result=await connection(db=>auth.login(db,req.body,req.socket.remoteAddress));
    res.cookie(cookieName,result.token,{...cookie,maxAge:result.maxAgeSeconds*1000});
    res.json({context:result.context,csrfToken:result.csrfToken,mfaRequired:result.mfaRequired});
  }));
  router.get('/me',wrap(async(req,res)=>{
    const raw=token(req),context=await connection(db=>loadSession(db,raw));
    if(!audienceMatches(context))return res.status(401).json({code:'AUTH_REQUIRED'});
    res.json({context,csrfToken:auth.csrf(raw),mfaRequired:context.audience==='platform'&&!context.mfaVerified});
  }));
  // The existing administrator screen first validates its legacy account. It
  // uses this read-only policy to know whether that linked platform identity
  // must complete the canonical MFA challenge before entering the dashboard.
  router.get('/login-policy',wrap(async(req,res)=>{
    const adminId=Number(req.legacyAdminId),uid=req.decode?.uid;
    if(!Number.isSafeInteger(adminId)||adminId<1||typeof uid!=='string')return res.status(401).json({code:'AUTH_REQUIRED'});
    const uidHash=require('node:crypto').createHash('sha256').update(uid,'utf8').digest('hex');
    const required=await connection(async db=>{
      const [[row]]=await db.query(`SELECT m.role FROM sx_legacy_admin_identities l
        JOIN sx_identities i ON i.id=l.identity_id
        JOIN sx_platform_memberships m ON m.identity_id=i.id
        WHERE l.legacy_admin_id=? AND l.legacy_uid=? AND l.legacy_uid_hash=? AND l.status='active'
          AND i.status='active' AND m.status='active' AND m.role IN ('super_admin','platform_admin','staff') LIMIT 1`,[adminId,uid,uidHash]);
      return !!row;
    });
    res.json({mfaRequired:required});
  }));
  router.post('/logout',wrap(async(req,res)=>{
    const raw=token(req);if(!auth.validCsrf(raw,req.get('X-CSRF-Token')))return res.status(403).json({code:'CSRF_DENIED'});
    const context=await connection(db=>loadSession(db,raw));if(!audienceMatches(context))return res.status(401).json({code:'AUTH_REQUIRED'});
    await connection(db=>auth.logout(db,raw));res.clearCookie(cookieName,cookie);res.status(204).end();
  }));
  router.post('/mfa/enroll',wrap(async(req,res)=>{
    if(allowedAudience==='tenant')return res.status(404).json({code:'ROUTE_NOT_FOUND'});
    const raw=token(req);if(!auth.validCsrf(raw,req.get('X-CSRF-Token')))return res.status(403).json({code:'CSRF_DENIED'});
    const result=await connection(db=>mfa.begin(db,raw));
    res.json({...result,qrDataUrl:await qrcode.toDataURL(result.uri)});
  }));
  router.post('/mfa/verify',wrap(async(req,res)=>{
    if(allowedAudience==='tenant')return res.status(404).json({code:'ROUTE_NOT_FOUND'});
    const raw=token(req);if(!auth.validCsrf(raw,req.get('X-CSRF-Token')))return res.status(403).json({code:'CSRF_DENIED'});
    const result=await connection(db=>mfa.verify(db,raw,req.body));
    res.cookie(cookieName,raw,{...cookie,maxAge:28800*1000});res.json(result);
  }));
  async function contextFor(db,raw){
    const ctx=await loadSession(db,raw);if(!ctx)return null;
    if(ctx.audience==='tenant'){
      if(ctx.tenant.categoryKey!==trainingCenter.key||ctx.tenant.categoryVersion!==trainingCenter.version)return null;
      ctx.category=trainingCenter;ctx.subscription=await loadEntitlements(db,ctx.tenant.id);ctx.runtimeReady={};
    }
    return ctx;
  }
  async function requireContext(req,res){
    const raw=token(req);
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&(req.get('Origin')!==origin||!auth.validCsrf(raw,req.get('X-CSRF-Token'))))return res.status(403).json({code:'CSRF_DENIED'});
    const context=await connection(db=>contextFor(db,raw));
    if(!audienceMatches(context))return res.status(401).json({code:'AUTH_REQUIRED'});
    if(context.audience==='platform'&&!context.mfaVerified)return res.status(403).json({code:'MFA_REQUIRED'});
    req.businessContext=context;
    return true;
  }
  // Express guard must call next only after asynchronous validation succeeds.
  function guard(req,res,next){requireContext(req,res).then(allowed=>{if(allowed===true)next();}).catch(error=>{if(res.headersSent)return next(error);res.status(500).json({code:'AUTH_UNAVAILABLE'});});}
  router.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const status=error.code==='AUTH_INVALID'?401:['AUTH_RATE_LIMITED','MFA_RATE_LIMITED'].includes(error.code)?429:['MFA_INVALID','REAUTH_REQUIRED','MFA_NOT_ENROLLED'].includes(error.code)?403:error.code==='MFA_ALREADY_ENROLLED'?409:error.type==='entity.too.large'?413:error.type==='entity.parse.failed'?400:500;
    res.status(status).json({code:status===500?'AUTH_UNAVAILABLE':status===400?'INVALID_JSON':status===413?'BODY_TOO_LARGE':error.code});
  });
  return {router,guard,cookieName};
}
module.exports={createAuthRouter};
