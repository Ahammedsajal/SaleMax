'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test'),vm=require('node:vm');
const common=fs.readFileSync(path.join(__dirname,'../client/public/workspace-api.js'),'utf8');
const adapter=fs.readFileSync(path.join(__dirname,'../client/public/tasks/tasks-session.js'),'utf8');
function browser({actor='user',token='active-token',cookie=true,status=200}={}){
  const calls=[],removed=[];
  const window={SaleMaxActor:actor,fetch:async(input,init)=>{
    calls.push({url:new URL(String(input),'https://crm.example.invalid'),headers:new Headers(init?.headers),init});
    if(String(input).includes('/business-auth/me'))return {ok:cookie,json:async()=>({context:{audience:'tenant'},csrfToken:'cookie-csrf'})};
    return {ok:status===200,status,json:async()=>({success:status===200})};
  }};
  const context={window,localStorage:{getItem:key=>key===(actor==='agent'?'wacrm_agent':'wacrm_user')?token:key==='wacrm_user'?'other-account-token':null,removeItem:key=>removed.push(key)},location:{pathname:'/tasks/',href:'https://crm.example.invalid/tasks/',origin:'https://crm.example.invalid'},URL,Headers,Request,FormData};
  context.fetch=(...args)=>window.fetch(...args);
  vm.runInNewContext(common,context);vm.runInNewContext(adapter,context);
  return {window,calls,removed,context};
}
test('Agent Tasks uses its current bearer without probing or borrowing the business cookie',async()=>{
  const {window,calls}=browser({actor:'agent'});
  for(const suffix of ['', '/participants', '/preferences','/task-id/messages'])await window.fetch('/api/pipeline/tasks'+suffix,{headers:{Authorization:'Bearer stale-user','X-Trace':'kept'}});
  assert.equal(calls.length,4);
  for(const call of calls){assert.ok(call.url.pathname.startsWith('/api/workspace/tasks'));assert.equal(call.headers.get('Authorization'),'Bearer active-token');assert.equal(call.headers.get('X-Salemax-Actor'),'agent');assert.equal(call.headers.get('X-Trace'),'kept');assert.equal(call.init.credentials,'same-origin');}
});
test('business bearer Tasks also reuses the panel credential and does not switch to a different cookie identity',async()=>{
  const {window,calls}=browser();
  await window.fetch('/api/pipeline/tasks?scope=mine&status=open');
  assert.equal(calls.length,1);assert.equal(calls[0].headers.get('Authorization'),'Bearer active-token');assert.equal(calls[0].headers.get('X-Salemax-Actor'),'user');assert.equal(calls[0].url.search,'?scope=mine&status=open');
});
test('cookie-only Tasks keeps CSRF and the same shared API for reads and writes',async()=>{
  const {window,calls}=browser({token:null});
  await window.fetch('/api/pipeline/tasks/id/status',{method:'PATCH',headers:{Authorization:'Bearer stale','X-Salemax-Actor':'agent'},body:'{"status":"completed"}'});
  assert.equal(calls.length,2);const call=calls[1];assert.equal(call.url.pathname,'/api/workspace/tasks/id/status');assert.equal(call.headers.get('Authorization'),null);assert.equal(call.headers.get('X-CSRF-Token'),'cookie-csrf');assert.equal(call.headers.get('X-Salemax-Actor'),null);assert.equal(call.init.method,'PATCH');assert.equal(call.init.body,'{"status":"completed"}');
});
test('denied and expired Tasks requests do not retry or clear an active panel credential',async()=>{
  for(const status of [401,403]){const {window,calls,removed}=browser({actor:'agent',status});const response=await window.fetch('/api/pipeline/tasks');assert.equal(response.status,status);assert.equal(calls.length,1);assert.deepEqual(removed,[]);}
});
test('unrelated and foreign-origin requests retain their original URL and headers',async()=>{
  const {window,calls}=browser();
  for(const url of ['/api/pipeline/board?limit=100','https://external.invalid/api/pipeline/tasks'])await window.fetch(url,{headers:{Authorization:'Bearer original'}});
  assert.equal(calls.length,2);for(const call of calls)assert.equal(call.headers.get('Authorization'),'Bearer original');
  assert.equal(calls[1].url.origin,'https://external.invalid');
});
test('only explicit recovery clears a stale token; normal Task requests leave sign-in intact',()=>{
  let handler;const {context,removed}=browser();context.document={addEventListener:(type,fn)=>{handler=fn;}};vm.runInNewContext(adapter,context);
  handler({target:{closest:()=>({href:'https://outside.invalid/user/login'})}});assert.deepEqual(removed,[]);
  handler({target:{closest:()=>({href:'https://crm.example.invalid/user/login'})}});assert.deepEqual(removed,['wacrm_user']);
});
