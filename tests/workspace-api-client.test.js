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
test('Pipeline CSV downloads use common bearer selection and credentials policy',async()=>{
 const calls=[],blob={type:'text/csv'},sandbox={window:{},location:{pathname:'/pipeline/'},localStorage:{getItem:key=>key==='wacrm_user'?'owner-token':null},FormData:class {},fetch:async(url,options)=>{calls.push({url,options});return {ok:true,blob:async()=>blob};}};
 vm.runInNewContext(source,sandbox);assert.equal(await sandbox.window.SaleMaxWorkspace.requestBlob('pipeline','/leads/export?search=test'),blob);
 assert.equal(calls[0].url,'/api/workspace/pipeline/leads/export?search=test');assert.equal(calls[0].options.headers.Authorization,'Bearer owner-token');assert.equal(calls[0].options.headers['X-Salemax-Actor'],'user');assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.cache,'no-store');
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
test('the embedded existing Pipeline screen loads its common API client before Pipeline logic',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../client/public/pipeline/index.html'),'utf8'),common=html.indexOf('/workspace-api.js?'),pipeline=html.indexOf('/pipeline/pipeline.js?');assert.ok(common>=0&&common<pipeline);
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
