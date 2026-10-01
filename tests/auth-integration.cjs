const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const bcrypt=require('bcrypt');
const mysql=require('mysql2/promise');
const express=require('express');
const {createAuthRouter}=require('../modules/platform/auth-router');
const {createAuthentication}=require('../modules/platform/authentication');
const {loadSession,tokenHash}=require('../modules/platform/sessions');
const {totp}=require('../modules/platform/mfa');
module.exports=async function verifyAuth(db,config,{t1,i1}){
  const password=crypto.randomBytes(20).toString('base64url'),key=crypto.randomBytes(32);
  await db.query('UPDATE sx_identities SET password_hash=? WHERE id=?',[await bcrypt.hash(password,12),i1]);
  const pool=mysql.createPool({...config,connectionLimit:3}),app=express();
  const origin='http://127.0.0.1:3016',boundary=createAuthRouter({pool,key,origin,insecureLoopback:true});
  app.use('/auth',boundary.router);
  app.get('/protected',boundary.guard,(req,res)=>res.json({audience:req.businessContext.audience,identity:req.businessContext.identity.id}));
  app.post('/protected',boundary.guard,(req,res)=>res.json({ok:true}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const input={email:'a@example.invalid',password,audience:'tenant',tenantId:t1};
  async function request(path,options={}){return fetch(base+path,options);}
  const login=body=>request('/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    assert.equal((await request('/protected')).status,401);
    assert.equal((await request('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status,403);
    const wrong=await login({...input,password:'wrong-synthetic'});assert.equal(wrong.status,401);assert.deepEqual(await wrong.json(),{code:'AUTH_INVALID'});
    const foreign=await login({...input,tenantId:crypto.randomUUID()});assert.equal(foreign.status,401);
    const logged=await login(input);assert.equal(logged.status,200);
    const payload=await logged.json(),setCookie=logged.headers.get('set-cookie'),cookie=setCookie.split(';')[0],raw=cookie.slice(cookie.indexOf('=')+1);
    assert.match(setCookie,/HttpOnly/i);assert.match(setCookie,/SameSite=Strict/i);assert.ok(!('token' in payload));assert.ok(!JSON.stringify(payload).includes(password));
    assert.equal((await request('/protected',{headers:{Cookie:cookie}})).status,200);
    assert.equal((await request('/protected',{method:'POST',headers:{Cookie:cookie,Origin:origin}})).status,403);
    assert.equal((await request('/protected',{method:'POST',headers:{Cookie:cookie,Origin:'http://foreign.invalid','X-CSRF-Token':payload.csrfToken}})).status,403);
    assert.equal((await request('/protected',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':payload.csrfToken}})).status,200);
    const [[stored]]=await db.query('SELECT token_hash FROM sx_sessions WHERE token_hash=?',[tokenHash(raw)]);assert.equal(stored.token_hash,tokenHash(raw));assert.notEqual(stored.token_hash,raw);
    const platform=await login({email:input.email,password,audience:'platform'});assert.equal(platform.status,200);
    const platformPayload=await platform.json();assert.equal(platformPayload.mfaRequired,true);
    const platformCookie=platform.headers.get('set-cookie').split(';')[0],platformRaw=platformCookie.slice(platformCookie.indexOf('=')+1);
    assert.equal((await request('/protected',{headers:{Cookie:platformCookie}})).status,403);
    const mfaHeaders={Cookie:platformCookie,Origin:origin,'X-CSRF-Token':platformPayload.csrfToken,'Content-Type':'application/json'};
    const enrollment=await request('/auth/mfa/enroll',{method:'POST',headers:mfaHeaders,body:'{}'});assert.equal(enrollment.status,200);
    const seed=await enrollment.json();assert.equal(seed.enrolled,false);assert.ok(seed.uri.startsWith('otpauth://totp/'));
    // Decode enrollment output independently to generate a client authenticator code.
    let acc=0,bits=0,bytes=[];for(const letter of seed.secret){acc=(acc<<5)|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(letter);bits+=5;if(bits>=8){bits-=8;bytes.push((acc>>>bits)&255);}acc&=(1<<bits)-1;}
    const secret=Buffer.from(bytes),code=totp(secret,Math.floor(Date.now()/30000));
    const [[encrypted]]=await db.query('SELECT secret_encrypted FROM sx_mfa_credentials WHERE identity_id=?',[i1]);assert.notDeepEqual(encrypted.secret_encrypted,secret);
    const verified=await request('/auth/mfa/verify',{method:'POST',headers:mfaHeaders,body:JSON.stringify({code})});assert.equal(verified.status,200);
    const recovery=await verified.json();assert.equal(recovery.recoveryCodes.length,10);
    assert.equal((await loadSession(db,platformRaw)).mfaVerified,true);
    assert.equal((await request('/protected',{headers:{Cookie:platformCookie}})).status,200);
    assert.equal((await request('/auth/mfa/verify',{method:'POST',headers:mfaHeaders,body:JSON.stringify({code})})).status,403);
    assert.equal((await request('/auth/mfa/enroll',{method:'POST',headers:mfaHeaders,body:'{}'})).status,409);
    const recovered=await request('/auth/mfa/verify',{method:'POST',headers:mfaHeaders,body:JSON.stringify({recoveryCode:recovery.recoveryCodes[0]})});assert.equal(recovered.status,200);
    assert.equal((await request('/auth/mfa/verify',{method:'POST',headers:mfaHeaders,body:JSON.stringify({recoveryCode:recovery.recoveryCodes[0]})})).status,403);
    const recoveryRace=await Promise.all([0,1].map(()=>request('/auth/mfa/verify',{method:'POST',headers:mfaHeaders,body:JSON.stringify({recoveryCode:recovery.recoveryCodes[1]})})));
    assert.deepEqual(recoveryRace.map(r=>r.status).sort(),[200,403]);
    await db.query('UPDATE sx_mfa_credentials SET attempts=0 WHERE identity_id=?',[i1]);
    for(let n=0;n<8;n++)assert.equal((await request('/auth/mfa/verify',{method:'POST',headers:mfaHeaders,body:JSON.stringify({code:'invalid'})})).status,403);
    assert.equal((await request('/auth/mfa/verify',{method:'POST',headers:mfaHeaders,body:JSON.stringify({code:'invalid'})})).status,429);
    const logout=await request('/auth/logout',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':payload.csrfToken}});assert.equal(logout.status,204);
    assert.equal(await loadSession(db,raw),null);assert.equal((await request('/protected',{headers:{Cookie:cookie}})).status,401);
    // A separate account/IP isolates throttling evidence from the preceding UI calls.
    const auth=createAuthentication({key});
    for(let n=0;n<8;n++)await assert.rejects(auth.login(db,{email:'absent@example.invalid',password:'synthetic',audience:'platform'},'synthetic-address'),{code:'AUTH_INVALID'});
    await assert.rejects(auth.login(db,{email:'absent@example.invalid',password:'synthetic',audience:'platform'},'synthetic-address'),{code:'AUTH_RATE_LIMITED'});
    return {canonicalPasswordLogin:true,noPasswordClaims:true,hashedSessionStorage:true,cookieHttpOnly:true,csrfOriginAndToken:true,platformMfaGate:true,encryptedMfaEnrollment:true,totpReplayDenied:true,singleUseRecovery:true,authenticatedGuardContinuation:true,logoutRevokes:true,databaseLoginThrottling:true};
  }finally{await new Promise(resolve=>server.close(resolve));await pool.end();}
};
