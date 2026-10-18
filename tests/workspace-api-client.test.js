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
