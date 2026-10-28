'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../client/public/workspace-api.js'),'utf8');
test('all feature requests share one credential selection and never switch identities on permission denial',async()=>{
 const calls=[],sandbox={window:{},location:{pathname:'/agent'},localStorage:{getItem:key=>key==='wacrm_agent'?'agent-token':null},FormData:class {},fetch:async(url,options)=>{calls.push({url,options});return {ok:false,json:async()=>({success:false,code:'PERMISSION_DENIED'})};}};
 vm.runInNewContext(source,sandbox);
 await assert.rejects(sandbox.window.SaleMaxWorkspace.request('finance','/accountant/receipts'),{message:'PERMISSION_DENIED'});
 assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/workspace/finance/receipts');assert.equal(calls[0].options.headers.Authorization,'Bearer agent-token');assert.equal(calls[0].options.headers['X-Salemax-Actor'],'agent');
});
test('business cookie sessions use the same feature URL with CSRF and no legacy token',async()=>{
 const calls=[],sandbox={window:{},location:{pathname:'/user'},localStorage:{getItem:()=>null},FormData:class {},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.endsWith('/me')?{context:{audience:'tenant'},csrfToken:'synthetic-csrf'}:{success:true,data:{saved:true}}};}};
 vm.runInNewContext(source,sandbox);await sandbox.window.SaleMaxWorkspace.request('phonebook','/settings',{method:'PUT',body:{labels:[]}});
 assert.equal(calls[1].url,'/api/workspace/phonebook/settings');assert.equal(calls[1].options.headers['X-CSRF-Token'],'synthetic-csrf');assert.equal(calls[1].options.credentials,'same-origin');assert.equal(calls[1].options.headers.Authorization,undefined);
});
test('cookie-only Courses access finishes the existing navigation admission check',async()=>{
 const screen=fs.readFileSync(path.join(__dirname,'../client/public/training-courses.js'),'utf8'),start=screen.indexOf('  async function checkCourseAccess(){'),end=screen.indexOf('  function addNav',start);
 const sandbox={getToken:()=>null,navToken:'canonical-session',navLoading:false,navChecked:false,navAllowed:false,api:async()=>{},addNav:()=>{},document:{querySelector:()=>null},window:{SaleMaxWorkspace:{session:async()=>({categoryKey:'training_center',modules:{courses:true}})}}};
 vm.runInNewContext(screen.slice(start,end),sandbox);await sandbox.checkCourseAccess();assert.equal(sandbox.navAllowed,true);assert.equal(sandbox.navChecked,true);
});
test('the common client loads before dependent existing screen scripts',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../client/public/index.html'),'utf8'),common=html.indexOf('/workspace-api.js?');assert.ok(common>=0);
 for(const module of ['training-courses','training-finance','training-forms','phonebook-workspace','course-quick-replies'])assert.ok(common<html.indexOf('/'+module+'.js?'));
});


test('late session responses cannot expose a previous business after a bearer identity switch',async()=>{
 let token='business-a';const pending=[];
 const sandbox={window:{},location:{pathname:'/user'},localStorage:{getItem:()=>token},FormData:class {},fetch:async()=>new Promise(resolve=>pending.push(resolve))};
 vm.runInNewContext(source,sandbox);
 const first=sandbox.window.SaleMaxWorkspace.session();await new Promise(resolve=>setImmediate(resolve));
 token='business-b';const second=sandbox.window.SaleMaxWorkspace.session();await new Promise(resolve=>setImmediate(resolve));
 pending[1]({ok:true,json:async()=>({success:true,data:{tenantId:'business-b',navigationLabels:{inbox:{en:'B'}}}})});
 assert.equal((await second).tenantId,'business-b');
 pending[0]({ok:true,json:async()=>({success:true,data:{tenantId:'business-a',navigationLabels:{inbox:{en:'A'}}}})});
 assert.equal((await first).tenantId,'business-b');
 assert.equal(pending.length,2);
});

function sessionHarness({cookie=false}={}){
 let now=0,token=cookie?null:'owner-token';const pending=[],calls=[];
 const sandbox={window:{},location:{pathname:'/user'},localStorage:{getItem:()=>token},Date:{now:()=>now},FormData:class {},fetch:async(url,options)=>{calls.push({url,options});return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};
 vm.runInNewContext(source,sandbox);
 return {api:sandbox.window.SaleMaxWorkspace,calls,pending,clock:value=>now=value,token:value=>token=value,flush:()=>new Promise(resolve=>setImmediate(resolve)),reply:(index,data)=>pending[index].resolve({ok:true,json:async()=>({success:true,data})})};
}
test('slow session request remains shared beyond five seconds and cache starts on completion',async()=>{
 const h=sessionHarness(),first=h.api.session();await h.flush();
 h.clock(6000);const second=h.api.session();await h.flush();assert.equal(h.calls.length,1);
 h.clock(14000);h.reply(0,{tenantId:'owner'});assert.equal((await first).tenantId,'owner');assert.equal((await second).tenantId,'owner');
 h.clock(18000);assert.equal((await h.api.session()).tenantId,'owner');assert.equal(h.calls.length,1);
 h.clock(19000);const refresh=h.api.session();await h.flush();assert.equal(h.calls.length,2);h.reply(1,{tenantId:'owner',revision:2});assert.equal((await refresh).revision,2);
});
test('invalidation during a pending request waits for current permissions and discards old result',async()=>{
 const h=sessionHarness(),old=h.api.session();await h.flush();h.api.invalidateSession();const current=h.api.session();await h.flush();
 h.reply(0,{tenantId:'owner',roleNavigation:['finance']});await h.flush();assert.equal(h.calls.length,2);
 h.reply(1,{tenantId:'owner',roleNavigation:['inbox']});assert.deepEqual([...(await old).roleNavigation],['inbox']);assert.deepEqual([...(await current).roleNavigation],['inbox']);
});
test('failed session can retry without caching the error',async()=>{
 const h=sessionHarness(),first=h.api.session();await h.flush();h.pending[0].reject(Error('offline'));await assert.rejects(first,/offline/);
 const retry=h.api.session();await h.flush();assert.equal(h.calls.length,2);h.reply(1,{tenantId:'owner'});assert.equal((await retry).tenantId,'owner');
});
test('cookie session reads go directly to the authenticated endpoint without CSRF preflight',async()=>{
 const h=sessionHarness({cookie:true}),pending=h.api.session();await h.flush();assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'/api/workspace/session');assert.equal(h.calls[0].options.credentials,'same-origin');assert.equal(h.calls[0].options.headers['X-CSRF-Token'],undefined);h.reply(0,{tenantId:'cookie-owner'});assert.equal((await pending).tenantId,'cookie-owner');
});
