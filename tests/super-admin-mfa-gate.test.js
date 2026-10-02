'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const jwt=require('jsonwebtoken');
const {createSuperAdminMfaGate}=require('../middlewares/super-admin-mfa-gate');
const key='test-admin-mfa-key';
const uid='reviewed-legacy-uid';
const claims={email:'owner@example.invalid',password:'legacy-hash',uid,role:'admin'};
function response(){return {code:200,body:null,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}
function request(token,cookie=''){return {get(name){return name==='Authorization'&&token?'Bearer '+token:name==='Cookie'?cookie:undefined;},originalUrl:'/api/admin/get_dashboard_for_user',method:'GET'};}
test('linked platform administrators need a verified canonical MFA session for legacy admin APIs',async()=>{
  const calls=[];const runQuery=async(sql,args)=>{calls.push(sql);if(sql.startsWith('SELECT id,uid FROM admin'))return [{id:8,uid}];if(sql.includes('FROM sx_legacy_admin_identities l')&&sql.includes('SELECT i.id AS identity_id'))return [{identity_id:'identity-owner',role:'super_admin'}];if(sql.includes('FROM sx_sessions s'))return [];throw new Error('unexpected query');};
  const gate=createSuperAdminMfaGate({runQuery,key}),next=()=>{next.called=true;};next.called=false;
  const res=response();await gate(request(jwt.sign(claims,key)),res,next);
  assert.equal(res.code,403);assert.equal(res.body.code,'MFA_REQUIRED');assert.equal(next.called,false);assert.equal(calls.length,2);
});
test('a verified canonical MFA cookie grants the rest of that session without another challenge',async()=>{
  const raw='a'.repeat(43);const runQuery=async sql=>sql.startsWith('SELECT id,uid FROM admin')?[{id:8,uid}]:sql.includes('SELECT i.id AS identity_id')?[{identity_id:'identity-owner',role:'super_admin'}]:[{id:'verified-session'}];
  const gate=createSuperAdminMfaGate({runQuery,key}),req=request(jwt.sign(claims,key),'__Host-salemax_session='+raw),res=response();let passed=false;
  await gate(req,res,()=>{passed=true;});assert.equal(passed,true);assert.equal(req.platformMfaSession,'verified-session');
});
test('unlinked legacy administrators retain the existing login behavior',async()=>{
  const runQuery=async sql=>sql.startsWith('SELECT id,uid FROM admin')?[{id:8,uid}]:[];
  const gate=createSuperAdminMfaGate({runQuery,key}),res=response();let passed=false;
  await gate(request(jwt.sign(claims,key)),res,()=>{passed=true;});assert.equal(passed,true);assert.equal(res.body,null);
});
