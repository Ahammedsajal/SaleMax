'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {createTrainingTurnstile,ACTION,SITEVERIFY_URL}=require('../modules/platform/training-turnstile');

const keys={siteKey:'0x4AAAAAAATestSiteKey1234567890',secretKey:'1x0000000000000000000000000000000AA',hostname:'crm.salemax.qa'};
const uuid=()=>crypto.randomUUID();

test('Turnstile is disabled without keys and makes no external request',async()=>{
  const guard=createTrainingTurnstile({hostname:keys.hostname,fetchImpl:()=>{throw Error('unexpected fetch');}});
  assert.equal(guard.enabled,false);assert.equal(guard.publicConfig,null);assert.deepEqual(await guard.verify(undefined,uuid()),{enabled:false,verified:false});
});

test('Turnstile requires a complete validated server key pair and exact hostname',()=>{
  assert.throws(()=>createTrainingTurnstile({siteKey:keys.siteKey,hostname:keys.hostname}),{code:'TURNSTILE_CONFIG_INVALID'});
  assert.throws(()=>createTrainingTurnstile({...keys,hostname:'crm.salemax.qa:443'}),{code:'TURNSTILE_HOST_INVALID'});
  assert.throws(()=>createTrainingTurnstile({...keys,secretKey:'short'}),{code:'TURNSTILE_CONFIG_INVALID'});
});

test('server verifies token, hostname and action and uses a stable private idempotency key',async()=>{
  const requests=[];
  const guard=createTrainingTurnstile({...keys,fetchImpl:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({success:true,hostname:keys.hostname,action:ACTION})};}});
  assert.equal(guard.enabled,true);assert.deepEqual(guard.publicConfig,{provider:'turnstile',siteKey:keys.siteKey,action:ACTION});
  const submissionToken=uuid(),scope={tenantSlug:'gcc-training',formSlug:'course-enquiry'};assert.deepEqual(await guard.verify('opaque-cloudflare-token',submissionToken,scope),{enabled:true,verified:true});
  assert.equal(requests[0].url,SITEVERIFY_URL);assert.equal(requests[0].options.method,'POST');
  const body=JSON.parse(requests[0].options.body);assert.equal(body.secret,keys.secretKey);assert.equal(body.response,'opaque-cloudflare-token');assert.match(body.idempotency_key,/^[0-9a-f-]{36}$/);assert.equal(Object.hasOwn(body,'remoteip'),false);
  await guard.verify('opaque-cloudflare-token',submissionToken,scope);assert.equal(JSON.parse(requests[1].options.body).idempotency_key,body.idempotency_key);
  await guard.verify('opaque-cloudflare-token',submissionToken,{tenantSlug:'gcc-training',formSlug:'walk-in'});assert.notEqual(JSON.parse(requests[2].options.body).idempotency_key,body.idempotency_key);
});

test('invalid or foreign Turnstile results fail closed without exposing provider detail',async()=>{
  for(const result of [{success:false,'error-codes':['timeout-or-duplicate']},{success:true,hostname:'attacker.example',action:ACTION},{success:true,hostname:keys.hostname,action:'login'}]){
    const guard=createTrainingTurnstile({...keys,fetchImpl:async()=>({ok:true,json:async()=>result})});
    await assert.rejects(guard.verify('token',uuid(),{tenantSlug:'gcc-training',formSlug:'course-enquiry'}),{code:'BOT_CHALLENGE_FAILED'});
  }
  const guard=createTrainingTurnstile({...keys,fetchImpl:async()=>{throw Error('network detail');}});
  await assert.rejects(guard.verify('token',uuid(),{tenantSlug:'gcc-training',formSlug:'course-enquiry'}),{code:'BOT_CHALLENGE_UNAVAILABLE'});
});

test('missing, oversized and non-UUID challenge requests are rejected before Siteverify',async()=>{
  let calls=0;const guard=createTrainingTurnstile({...keys,fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({success:true,hostname:keys.hostname,action:ACTION})};}});
  const scope={tenantSlug:'gcc-training',formSlug:'course-enquiry'};
  await assert.rejects(guard.verify('',uuid(),scope),{code:'BOT_CHALLENGE_REQUIRED'});
  await assert.rejects(guard.verify('x'.repeat(2049),uuid(),scope),{code:'BOT_CHALLENGE_REQUIRED'});
  await assert.rejects(guard.verify('token','not-a-uuid',scope),{code:'BOT_CHALLENGE_REQUIRED'});assert.equal(calls,0);
});

test('public forms expose and submit an explicit challenge only when configured',()=>{
  const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'../client/public');
  const router=fs.readFileSync(path.join(__dirname,'../modules/platform/training-form-router.js'),'utf8');
  const screen=fs.readFileSync(path.join(root,'training-public-form.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'training-form.html'),'utf8');
  assert.match(router,/SALEMAX_TURNSTILE_SITE_KEY/);assert.match(router,/challenge\.verify\(req\.body\.challengeToken,req\.body\.submissionToken,\{tenantSlug:req\.params\.tenantSlug,formSlug:req\.params\.formSlug\}\)/);assert.match(router,/botChallenge:challenge\.publicConfig/);
  assert.match(screen,/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/);assert.match(screen,/payload\.challengeToken\s*=\s*challengeToken/);assert.match(screen,/Complete the security check/);assert.match(screen,/أكمل التحقق الأمني/);
  assert.match(html,/training-public-form\.js\?v=20261018-staff-capture1/);
});

test('public submission route rejects an unverified challenge before opening the business database',async t=>{
  const express=require('express'),http=require('node:http');
  const {createPublicTrainingFormRouter}=require('../modules/platform/training-form-router');
  let databaseCalls=0,verificationCalls=0;
  const app=express();const challenge={enabled:true,publicConfig:{provider:'turnstile',siteKey:keys.siteKey,action:ACTION},verify:async(token,submissionToken,scope)=>{verificationCalls++;assert.equal(token,'forged');assert.equal(scope.tenantSlug,'gcc-training');assert.equal(scope.formSlug,'course-enquiry');throw Object.assign(new Error('BOT_CHALLENGE_FAILED'),{code:'BOT_CHALLENGE_FAILED'});}};
  const router=createPublicTrainingFormRouter({app,pool:{getConnection(){databaseCalls++;throw Error('database must not be reached');}},rateKey:Buffer.alloc(32,1),origin:'https://crm.salemax.qa',turnstile:challenge});
  app.use('/api/public/training/forms',router);
  const server=app.listen(0,'127.0.0.1');t.after(()=>new Promise(resolve=>server.close(resolve)));
  await new Promise(resolve=>server.once('listening',resolve));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/public/training/forms/gcc-training/course-enquiry/submissions`,{method:'POST',headers:{Origin:'https://crm.salemax.qa','Content-Type':'application/json'},body:JSON.stringify({submissionToken:uuid(),values:{},website:'',challengeToken:'forged'})});
  assert.equal(response.status,400);assert.deepEqual(await response.json(),{success:false,code:'BOT_CHALLENGE_FAILED'});assert.equal(verificationCalls,1);assert.equal(databaseCalls,0);
});
