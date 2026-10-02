'use strict';

const crypto=require('node:crypto');
const jwt=require('jsonwebtoken');

function createSuperAdminMfaGate({runQuery,key}){
  if(typeof runQuery!=='function')throw new TypeError('runQuery is required');
  return async function superAdminMfaGate(req,res,next){
    const header=req.get('Authorization');
    if(typeof header!=='string'||!/^Bearer \S+$/.test(header))return next();
    let claims;
    try{claims=jwt.verify(header.slice(7),typeof key==='function'?key():key);}catch(_){return next();}
    if(typeof claims?.email!=='string'||typeof claims?.password!=='string'||typeof claims?.uid!=='string')return next();
    try{
      const admins=await runQuery('SELECT id,uid FROM admin WHERE email=? AND password=? AND uid=? AND role=\'admin\' LIMIT 1',[claims.email,claims.password,claims.uid]);
      if(admins.length!==1)return next();
      const admin=admins[0],uidHash=crypto.createHash('sha256').update(claims.uid,'utf8').digest('hex');
      const links=await runQuery(`SELECT i.id AS identity_id,m.role FROM sx_legacy_admin_identities l
        JOIN sx_identities i ON i.id=l.identity_id JOIN sx_platform_memberships m ON m.identity_id=i.id
        WHERE l.legacy_admin_id=? AND l.legacy_uid=? AND l.legacy_uid_hash=? AND l.status='active'
          AND i.status='active' AND m.status='active' AND m.role IN ('super_admin','platform_admin','staff') LIMIT 1`,[admin.id,claims.uid,uidHash]);
      if(!links.length)return next();
      const cookies=(req.get('Cookie')||'').split(';').map(v=>v.trim());
      const configuredOrigin=process.env.SALEMAX_PLATFORM_ORIGIN;
      const loopback=process.env.LOCAL_ONLY_MODE==='true'&&configuredOrigin&&(()=>{try{const u=new URL(configuredOrigin);return u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname);}catch(_){return false;}})();
      const cookieName=loopback?'salemax_dev_session':'__Host-salemax_session';
      const values=cookies.filter(v=>v.startsWith(cookieName+'='));
      const raw=values.length===1?values[0].slice(cookieName.length+1):'';
      const hash=/^[A-Za-z0-9_-]{43}$/.test(raw)?crypto.createHash('sha256').update(raw).digest('hex'):'';
      const sessions=hash?await runQuery(`SELECT s.id FROM sx_sessions s
        JOIN sx_identities i ON i.id=s.identity_id
        JOIN sx_platform_memberships m ON m.identity_id=i.id
        JOIN sx_legacy_admin_identities l ON l.identity_id=i.id
        WHERE s.token_hash=? AND s.audience='platform' AND s.mfa_verified_at IS NOT NULL
          AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP(3)
          AND s.credential_version=i.credential_version AND i.status='active'
          AND m.status='active' AND m.role IN ('super_admin','platform_admin','staff')
          AND l.legacy_admin_id=? AND l.legacy_uid=? AND l.legacy_uid_hash=? AND l.status='active' LIMIT 1`,[hash,admin.id,claims.uid,uidHash]):[];
      if(!sessions.length)return res.status(403).json({success:false,code:'MFA_REQUIRED',msg:'Complete authenticator verification at administrator sign-in'});
      req.platformMfaSession=sessions[0].id;
      return next();
    }catch(error){
      if(error.code==='ER_NO_SUCH_TABLE'&&process.env.SALEMAX_PLATFORM_ENABLED!=='true')return next();
      return res.status(503).json({success:false,code:'MFA_STATUS_UNAVAILABLE',msg:'Administrator security status is temporarily unavailable'});
    }
  };
}

module.exports={createSuperAdminMfaGate};
