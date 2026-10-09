'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('Agent QR selector uses Agent credentials and preserves unrelated authentication',()=>{
  class XHR{open(method,url){this.url=url;}setRequestHeader(k,v){this.headers??={};this.headers[k]=v;}send(){this.sent=true;}}
  const location={origin:'https://example.test',pathname:'/agent'};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../client/public/agent-session-context.js'),'utf8'),{window:{},location,XMLHttpRequest:XHR,URL,WeakSet,localStorage:{getItem:key=>{assert.equal(key,'wacrm_agent');return 'agent-token';}}});
  let request=new XHR();request.open('GET','/api/qr/get_all_agent');request.setRequestHeader('Authorization','business-token');request.send();
  assert.equal(request.url,'/api/qr/get_all_agent');assert.equal(request.headers.Authorization,'Bearer agent-token');
  for(const [page,url] of [['/user','/api/qr/get_all_agent'],['/agent','https://external.test/api/qr/get_all_agent'],['/agent','/api/user/get_me']]){location.pathname=page;request=new XHR();request.open('GET',url);request.setRequestHeader('Authorization','original');request.send();assert.equal(request.url,url);assert.equal(request.headers.Authorization,'original');}
});
