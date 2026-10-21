'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const policy=require('../modules/platform/policy'),team=require('../modules/platform/team-invitations'),{trainingCenter}=require('../modules/platform/categories');
const access=require('../modules/platform/agent-workspace-access');
const ctx=permissions=>({audience:'tenant',tenant:{id:'tenant',status:'active',categoryKey:'training_center',categoryVersion:1},identity:{id:'agent-identity'},membership:{id:'agent-member',tenantId:'tenant',status:'active',role:'agent',customPermissions:permissions,assignedNavigation:null},category:trainingCenter,subscription:{status:'active',capabilities:trainingCenter.capabilities}});
test('custom staff roles can grant business modules without granting platform authority or changing default scope',()=>{
 const catalog=team.permissionsFor('agent',trainingCenter,{capabilities:trainingCenter.capabilities});
 for(const key of ['channels.configure','automation.manage','campaigns.manage','templates.manage','courses.manage','contacts.manage','invoices.read','payments.verify','forms.manage','team.invite'])assert.ok(catalog.includes(key),key);
 assert.equal(policy.scopeFor({role:'agent'},'channels.configure'),null);
 assert.equal(policy.scopeFor({role:'agent',customPermissions:['channels.configure']},'channels.configure'),'tenant');
 assert.equal(policy.scopeFor({role:'agent',customPermissions:['conversations.read']},'conversations.read'),'assigned');
 assert.equal(policy.platformDecision({...ctx(catalog),audience:'tenant',mfaVerified:true},'staff.manage'),false);
 const session={context:ctx(catalog),agent:true};
 assert.equal(access.authorize({baseUrl:'/api/qr',path:'/gen_qr',method:'POST'},session).permission,'channels.configure');
 assert.equal(access.authorize({baseUrl:'/api/workspace/channels/qr',path:'/gen_qr',method:'POST'},session).permission,'channels.configure');
 assert.equal(access.authorize({baseUrl:'/api/ai',path:'/suggest_reply',method:'POST'},session).scope,'assigned');
 assert.throws(()=>access.authorize({baseUrl:'/api/user',path:'/unknown_privileged_operation',method:'POST'},session),{code:'TEAM_ROLE_ROUTE_UNMAPPED'});
});
test('revoked grants, removed sidebar screens and disabled plan capabilities deny the same APIs',()=>{
 const context=ctx(['channels.configure']);const request={baseUrl:'/api/qr',path:'/gen_qr',method:'POST'};
 context.membership.assignedNavigation=['inbox'];assert.throws(()=>access.authorize(request,{context,agent:true}),{code:'PERMISSION_DENIED'});
 context.membership.assignedNavigation=null;context.membership.customPermissions=[];assert.throws(()=>access.authorize(request,{context,agent:true}),{code:'PERMISSION_DENIED'});
 context.membership.customPermissions=['channels.configure'];context.subscription.capabilities=[];assert.throws(()=>access.authorize(request,{context,agent:true}),{code:'FEATURE_UNAVAILABLE'});
});
test('agent shell profile never returns owner credentials or changes the actor identity',()=>{
 const data=access.profile({context:ctx([]),actor:{id:2,uid:'agent',name:'Synthetic Agent',email:'agent@example.invalid',password:'agent-secret'},owner:{id:1,uid:'owner',email:'owner@example.invalid',password:'owner-secret',api_key:'owner-api',plan:'{}',plan_expire:123}});
 assert.equal(data.uid,'agent');assert.equal(data.workspaceRole,'agent');assert.equal(data.role,'user');assert.ok(!JSON.stringify(data).includes('secret'));assert.ok(!JSON.stringify(data).includes('owner@'));assert.equal(data.api_key,undefined);
});
function browserSandbox(url){
 class Storage{constructor(){this.data=new Map();}getItem(k){return this.data.get(k)||null;}setItem(k,v){this.data.set(k,String(v));}removeItem(k){this.data.delete(k);}}
 const localStorage=new Storage(),sessionStorage=new Storage(),u=new URL(url),calls=[],redirects=[];
 localStorage.setItem('wacrm_user','manager-token');localStorage.setItem('wacrm_agent','agent-token');
 class XHR{open(){}send(){}setRequestHeader(){}}
 const box={Storage,localStorage,sessionStorage,URL,URLSearchParams,Request,Headers,XMLHttpRequest:XHR,history:{pushState(){},replaceState(){}},addEventListener(){},setInterval(){},queueMicrotask:fn=>fn(),location:{pathname:u.pathname,search:u.search,href:url,origin:u.origin,replace:target=>redirects.push(target)},window:{fetch:async(input,init)=>calls.push({input,init})}};
 const originalGet=Storage.prototype.getItem;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../client/public/agent-workspace.js'),'utf8'),box);return {box,calls,redirects,originalGet};
}
test('shared business shell uses the Agent credential and preserves a separate Manager session',async()=>{
 const {box,calls,originalGet}=browserSandbox('https://crm.example.invalid/user?actor=agent&page=courses');
 assert.equal(box.localStorage.getItem('wacrm_user'),'agent-token');assert.equal(originalGet.call(box.localStorage,'wacrm_user'),'manager-token');
 await box.window.fetch('/api/workspace/courses',{headers:{Authorization:'Bearer agent-token'}});assert.equal(calls[0].init.headers.get('X-Salemax-Actor'),'agent');
 await box.window.fetch('https://external.invalid/api/resource');assert.equal(calls[1].init.headers,undefined);
 box.localStorage.removeItem('wacrm_user');assert.equal(originalGet.call(box.localStorage,'wacrm_user'),'manager-token');assert.equal(originalGet.call(box.localStorage,'wacrm_agent'),null);
});
test('existing agent entry point opens the shared shell; a normal business tab is unchanged',()=>{
 assert.deepEqual(browserSandbox('https://crm.example.invalid/agent?page=chat').redirects,['/user?actor=agent&page=inbox']);
 const {box,redirects}=browserSandbox('https://crm.example.invalid/user?page=courses');assert.equal(box.window.SaleMaxActor,undefined);assert.equal(box.localStorage.getItem('wacrm_user'),'manager-token');assert.deepEqual(redirects,[]);
});

test('shared Task endpoints preserve assigned scope and deny removed Task grants',()=>{
 const session={context:ctx(['tasks.read','tasks.manage']),agent:true};
 for(const baseUrl of ['/api/workspace/tasks','/api/user/training/tasks']){
  assert.equal(access.authorize({baseUrl,path:'/',method:'GET'},session).scope,'assigned');
  assert.equal(access.authorize({baseUrl,path:'/id/status',method:'PATCH'},session).permission,'tasks.manage');
  session.context.membership.customPermissions=[];
  assert.throws(()=>access.authorize({baseUrl,path:'/',method:'GET'},session),{code:'PERMISSION_DENIED'});
  session.context.membership.customPermissions=['tasks.read','tasks.manage'];
 }
});
