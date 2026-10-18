'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {profileValues,saveSelfProfile}=require('../modules/platform/self-profile');
const {createSelfProfileAuth}=require('../modules/platform/self-profile-auth');
const {isSelfProfileRequest}=require('../modules/platform/self-profile-policy');

test('self profile dispatcher sends each supported login type through its matching full validator',()=>{
  const calls=[];
  const guard=createSelfProfileAuth({verify:token=>({role:token}),userGuard:(req,res,next)=>{calls.push('user');next();},agentGuard:(req,res,next)=>{calls.push('agent');next();}});
  for(const role of ['user','agent']){
    let continued=false;
    const req={get:()=>`Bearer ${role}`};
    guard(req,{status(){throw Error('unexpected auth rejection');}},()=>{continued=true;});
    assert.equal(continued,true);
  }
  assert.deepEqual(calls,['user','agent']);
});

test('self profile dispatcher rejects non-business roles and missing credentials',()=>{
  const guard=createSelfProfileAuth({verify:()=>({role:'admin'}),userGuard:()=>assert.fail(),agentGuard:()=>assert.fail()});
  let status=0,body;
  const res={status(value){status=value;return this;},json(value){body=value;return value;}};
  guard({get:()=> 'Bearer token'},res,()=>assert.fail());
  assert.equal(status,403);
  assert.equal(body.success,false);
  status=0;
  guard({get:()=>''},res,()=>assert.fail());
  assert.equal(status,401);
});

test('password policy accepts blank-as-unchanged and enforces the shared team password bounds',()=>{
  const actor={id:4,uid:'uid',name:'Staff',email:'staff@example.qa',mobile_with_country_code:'+97412345678',timezone:'Asia/Qatar'};
  assert.equal(profileValues({newPassword:''},actor).password,'');
  assert.equal(profileValues({newPassword:'123456789012'},actor).password,'123456789012');
  assert.throws(()=>profileValues({newPassword:'short'},actor),{code:'INVALID_PASSWORD'});
  assert.throws(()=>profileValues({newPassword:'😀'.repeat(19)},actor),{code:'INVALID_PASSWORD'});
});

test('profile writer updates only the matching legacy account row for both user and agent identities',async()=>{
  const statements=[];
  const db={async query(sql,params){statements.push({sql,params});return sql.startsWith('SELECT')?[]:{affectedRows:1};}};
  const hashPassword=async value=>`hash:${value}`;
  const userResult=await saveSelfProfile(db,{accountType:'user',actor:{id:4,uid:'u1',name:'Owner',email:'owner@example.qa',mobile_with_country_code:'+97412345678'},input:{newPassword:'new-password-123'},hashPassword});
  const agentResult=await saveSelfProfile(db,{accountType:'agent',actor:{id:9,uid:'a1',name:'Agent',email:'agent@example.qa',mobile:'+97412345679'},input:{newPassword:'new-password-123'},hashPassword});
  assert.deepEqual(userResult,{passwordChanged:true,emailChanged:false,reloginRequired:true,accountType:'user'});
  assert.deepEqual(agentResult,{passwordChanged:true,emailChanged:false,reloginRequired:true,accountType:'agent'});
  assert.match(statements[1].sql,/UPDATE user SET .*WHERE id=\? AND uid=\?/);
  assert.deepEqual(statements[1].params.slice(-2),[4,'u1']);
  assert.match(statements[3].sql,/UPDATE agents SET .*WHERE id=\? AND uid=\? AND is_active=1/);
  assert.deepEqual(statements[3].params.slice(-2),[9,'a1']);
});

test('self profile updates bypass optional module permissions only on the authenticated own-profile endpoint',()=>{
  const request={baseUrl:'/api/user',path:'/update_profile',method:'POST'};
  assert.equal(isSelfProfileRequest(request,'user'),true);
  assert.equal(isSelfProfileRequest(request,'agents'),true);
  assert.equal(isSelfProfileRequest({...request,path:'/update_agent_profile'},'agents'),false);
  assert.equal(isSelfProfileRequest({...request,method:'GET'},'user'),false);
  assert.equal(isSelfProfileRequest({...request,baseUrl:'/api/agent'},'agents'),false);
});
