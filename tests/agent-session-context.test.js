'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const context=require('../modules/platform/agent-session-context');
test('Agent bootstrap never requests business credentials or exposes password fields',async()=>{
  let result,queries=0;
  const response={json:value=>{result=value;}};
  await context(()=>{throw Error('anonymous guard');},()=>{throw Error('anonymous query');})({get:()=>null},response);
  assert.deepEqual(result,{success:false,data:null});
  await context((req,res)=>res.json({logout:true,token:'private'}),()=>{})({get:()=> 'Bearer invalid'},response);
  assert.deepEqual(result,{success:false,data:null,code:'AGENT_SIGN_IN_REQUIRED'});
  await context(async(req,res,next)=>{req.decode={uid:'agent'};return next();},async(sql,args)=>{queries++;assert.doesNotMatch(sql,/password/);assert.deepEqual(args,['agent']);return [{uid:'agent',owner_uid:'owner'}];})({get:()=> 'Bearer valid'},response);
  assert.equal(result.success,true);assert.equal(queries,1);
});
test('existing XHR bootstrap is adapted only on same-origin Agent pages',()=>{
  class XHR{open(method,url){this.url=url;}setRequestHeader(k,v){this.headers??={};this.headers[k]=v;}send(){this.sent=true;}}
  const location={origin:'https://example.test',pathname:'/agent'};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../client/public/agent-session-context.js'),'utf8'),{window:{},location,XMLHttpRequest:XHR,URL,WeakSet,localStorage:{getItem:key=>{assert.equal(key,'wacrm_agent');return 'agent-token';}}});
  let request=new XHR();request.open('GET','/api/user/get_me');request.setRequestHeader('Authorization','business-token');request.send();
  assert.equal(request.url,'https://example.test/api/agent/session-context');assert.equal(request.headers.Authorization,'Bearer agent-token');
  for(const [page,url] of [['/user','/api/user/get_me'],['/agent','https://external.test/api/user/get_me'],['/agent','/api/user/other']]){location.pathname=page;request=new XHR();request.open('GET',url);request.setRequestHeader('Authorization','original');request.send();assert.equal(request.url,url);assert.equal(request.headers.Authorization,'original');}
});
