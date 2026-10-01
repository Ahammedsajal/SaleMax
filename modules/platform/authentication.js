const crypto=require('node:crypto');
const bcrypt=require('bcrypt');
const {tokenHash,loadSession}=require('./sessions');
function fail(code){throw Object.assign(new Error(code),{code});}
const dummyHash=bcrypt.hashSync(crypto.randomBytes(32).toString('hex'),12);
function credentials(input){
  const email=typeof input?.email==='string'?input.email.trim().toLowerCase():'';
  const password=input?.password;
  if(!email||email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||typeof password!=='string'||!password.length||Buffer.byteLength(password,'utf8')>72)fail('AUTH_INVALID');
  if(!['tenant','platform'].includes(input.audience))fail('AUTH_INVALID');
  if(input.audience==='tenant'){
    if(Object.hasOwn(input,'tenantId')===Object.hasOwn(input,'tenantSlug'))fail('AUTH_INVALID');
    if(Object.hasOwn(input,'tenantId')&&(typeof input.tenantId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.tenantId)))fail('AUTH_INVALID');
    if(Object.hasOwn(input,'tenantSlug')&&(typeof input.tenantSlug!=='string'||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(input.tenantSlug)))fail('AUTH_INVALID');
  }
  if(input.audience==='platform'&&(Object.hasOwn(input,'tenantId')||Object.hasOwn(input,'tenantSlug')))fail('AUTH_INVALID');
  return {email,password,audience:input.audience,tenantId:input.tenantId,tenantSlug:input.tenantSlug};
}
function createAuthentication({key}){
  if(!Buffer.isBuffer(key)||key.length<32)fail('AUTH_KEY_REQUIRED');
  const secret=Buffer.from(key);
  const digest=value=>crypto.createHmac('sha256',secret).update(value).digest('hex');
  function csrf(token){return digest('csrf:'+token);}
  function validCsrf(token,supplied){
    if(!tokenHash(token)||typeof supplied!=='string'||! /^[a-f0-9]{64}$/.test(supplied))return false;
    return crypto.timingSafeEqual(Buffer.from(csrf(token),'hex'),Buffer.from(supplied,'hex'));
  }
  async function rate(db,email,address){
    if(typeof address!=='string'||!address||address.length>100)fail('AUTH_INVALID');
    await db.beginTransaction();let blocked=false;
    try {
      // Global lock order avoids inversions when two workers share an IP/account.
      const buckets=[[digest('account:'+email),8],[digest('address:'+address),40]].sort((a,b)=>a[0].localeCompare(b[0]));
      for(const [hash,max] of buckets){
        await db.query(`INSERT IGNORE INTO sx_login_rate(bucket_hash,attempts,window_end) VALUES (?,0,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE))`,[hash]);
        const [[bucket]]=await db.query('SELECT attempts,(window_end>UTC_TIMESTAMP(3)) AS current_window FROM sx_login_rate WHERE bucket_hash=? FOR UPDATE',[hash]);
        const attempts=bucket.current_window?Number(bucket.attempts)+1:1;
        await db.query(`UPDATE sx_login_rate SET attempts=?,window_end=CASE WHEN window_end>UTC_TIMESTAMP(3) THEN window_end ELSE DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE) END WHERE bucket_hash=?`,[attempts,hash]);
        if(attempts>max)blocked=true;
      }
      await db.commit();
    }catch(error){await db.rollback();throw error;}
    if(blocked)fail('AUTH_RATE_LIMITED');
  }
  async function login(db,input,address){
    const data=credentials(input);await rate(db,data.email,address);
    const [[identity]]=await db.query('SELECT id,password_hash,status,credential_version FROM sx_identities WHERE email_normalized=?',[data.email]);
    const hash=identity?.password_hash;
    const supported=typeof hash==='string'&&/^\$2[ab]\$(1[2-6])\$[./A-Za-z0-9]{53}$/.test(hash);
    const valid=await bcrypt.compare(data.password,supported?hash:dummyHash);
    if(!identity||identity.status!=='active'||!supported||!valid)fail('AUTH_INVALID');
    await db.beginTransaction();
    try {
      const [[current]]=await db.query('SELECT status,password_hash,credential_version FROM sx_identities WHERE id=? FOR UPDATE',[identity.id]);
      if(current.status!=='active'||current.password_hash!==hash||current.credential_version!==identity.credential_version)fail('AUTH_INVALID');
      let membershipId=null,tenantId=null;
      if(data.audience==='tenant'){
        const [[member]]=await db.query(`SELECT m.id,m.tenant_id FROM sx_memberships m JOIN sx_tenants t ON t.id=m.tenant_id AND t.status='active'
          WHERE ${data.tenantSlug?'t.slug':'m.tenant_id'}=? AND m.identity_id=? AND m.status='active'`,[data.tenantSlug||data.tenantId,identity.id]);
        if(!member)fail('AUTH_INVALID');membershipId=member.id;tenantId=member.tenant_id;
      }else{
        const [[platform]]=await db.query("SELECT identity_id FROM sx_platform_memberships WHERE identity_id=? AND status='active'",[identity.id]);
        if(!platform)fail('AUTH_INVALID');
      }
      const token=crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID();
      const seconds=data.audience==='platform'?900:28800;
      await db.query(`INSERT INTO sx_sessions(id,token_hash,identity_id,audience,tenant_id,membership_id,credential_version,authenticated_at,expires_at)
        VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND))`,[id,tokenHash(token),identity.id,data.audience,tenantId,membershipId,current.credential_version,seconds]);
      await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
        VALUES (?,?,?,'identity','session.password-authenticated','session',?,?,?)`,[crypto.randomUUID(),tenantId,identity.id,id,JSON.stringify({audience:data.audience,mfaRequired:data.audience==='platform'}),crypto.randomUUID()]);
      const context=await loadSession(db,token);if(!context)fail('AUTH_INVALID');
      await db.commit();return {token,csrfToken:csrf(token),context,maxAgeSeconds:seconds,mfaRequired:data.audience==='platform'};
    }catch(error){await db.rollback();throw error;}
  }
  async function logout(db,token){
    const context=await loadSession(db,token);if(!context)return;
    await db.beginTransaction();
    try {
      await db.query('UPDATE sx_sessions SET revoked_at=UTC_TIMESTAMP(3) WHERE id=? AND revoked_at IS NULL',[context.sessionId]);
      await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
        VALUES (?,?,?,'identity','session.revoked','session',?,'{}',?)`,[crypto.randomUUID(),context.tenant?.id||null,context.identity.id,context.sessionId,crypto.randomUUID()]);
      await db.commit();
    }catch(error){await db.rollback();throw error;}
  }
  return {login,logout,csrf,validCsrf};
}
module.exports={createAuthentication,credentials};
