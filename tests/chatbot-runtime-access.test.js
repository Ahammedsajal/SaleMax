'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const access=require('../modules/platform/chatbot-runtime-access'),{trainingCenter,salemaxSales}=require('../modules/platform/categories');
function fixture(category=trainingCenter){
 const uid='synthetic-owner',id='11111111-1111-4111-8111-111111111111';
 const state={calls:[],initial:[{id:7,uid,tenantId:id,tenantSlug:'synthetic'}],linked:{uidHash:crypto.createHash('sha256').update(uid).digest('hex'),tenantId:id,tenantStatus:'active',categoryKey:category.key,categoryVersion:1,membershipId:'owner-member',identityId:'owner-identity',role:'owner',membershipStatus:'active',identityStatus:'active',roleProfileId:null,delegatedPermissions:'[]',assignedNavigation:null},plan:{id:'current-plan',status:'active',current_period:1,role_limits:JSON.stringify(Object.fromEntries(category.seatRoles.map(r=>[r,r==='owner'?1:3]))),capabilities:JSON.stringify(category.capabilities),category_key:category.key,category_version:1},assigned:true};
 const db={query:async(sql,args)=>{state.calls.push({sql,args});if(sql.includes('SELECT u.id,u.uid'))return [state.initial];if(sql.includes('o.legacy_uid_hash AS uidHash'))return [[state.linked]];if(sql.includes('FROM sx_plan_assignments'))return [state.plan?[state.plan]:[]];if(sql.includes('sx_tenant_customization_heads'))return [[]];if(sql.includes('sx_chatbot_channel_assignments'))return [state.assigned?[{found:1}]:[]];throw Error('UNEXPECTED_QUERY');}};
 return {state,db,uid};
}
test('bot owner context uses current period, published plan and exact category rather than historical active assignments',async()=>{
 for(const category of [trainingCenter,salemaxSales]){
  const f=fixture(category),result=await access.resolveOwnerAccess(f.db,f.uid);assert.equal(result.context.category.key,category.key);assert.equal(result.context.tenant.slug,'synthetic');assert.equal(result.context.subscription.assignmentId,'current-plan');
  const sql=f.state.calls.find(c=>c.sql.includes('FROM sx_plan_assignments')).sql;assert.match(sql,/current_tenant IS NOT NULL/);assert.match(sql,/p.status='published'/);assert.match(sql,/expires_at>UTC_TIMESTAMP/);
  f.state.plan.current_period=0;assert.equal((await access.resolveOwnerAccess(f.db,f.uid)).context,null);
  f.state.plan.current_period=1;f.state.plan.category_key=category.key==='training_center'?'7network_sales':'training_center';f.state.plan.role_limits=JSON.stringify({owner:1,manager:3,accountant:3,agent:3});assert.equal((await access.resolveOwnerAccess(f.db,f.uid)).context,null);
 }
});
test('owner identity, exact ownership, membership and navigation restrictions are respected',async()=>{
 for(const patch of [{uidHash:'foreign'},{role:'manager'},{membershipStatus:'revoked'},{identityStatus:'inactive'},{assignedNavigation:'[]'},{tenantStatus:'inactive'}]){
  const f=fixture();Object.assign(f.state.linked,patch);const result=await access.resolveOwnerAccess(f.db,f.uid);assert.equal(result.context,null,JSON.stringify(patch));assert.equal(result.linked,true);
 }
 const f=fixture();f.state.initial=[];assert.equal((await access.resolveOwnerAccess(f.db,f.uid)).linked,false);
 const duplicate=fixture();duplicate.state.initial.push({...duplicate.state.initial[0]});assert.equal((await access.resolveOwnerAccess(duplicate.db,duplicate.uid)).code,'BUSINESS_LINK_INVALID');
});
test('legacy Flow Builder authority resolves against the shared flows capability',async()=>{
 const f=fixture(),result=await access.resolveOwnerAccess(f.db,f.uid,'automation.flows');assert.equal(result.context.category.key,trainingCenter.key);assert.equal(result.context.subscription.capabilities.includes('automation.flows'),true);
});
test('a running turn cannot send under a replaced plan, category, tenant, owner identity or membership',async()=>{
 const f=fixture(),prior=(await access.resolveOwnerAccess(f.db,f.uid)).context;assert.equal(access.sameBoundary(prior,structuredClone(prior)),true);
 for(const mutate of [c=>c.tenant.id='foreign',c=>c.tenant.categoryVersion=2,c=>c.tenant.categoryKey='7network_sales',c=>c.membership.id='replacement',c=>c.identity.id='replacement',c=>c.subscription.assignmentId='replacement']){const current=structuredClone(prior);mutate(current);assert.equal(access.sameBoundary(prior,current),false);}
 assert.equal(access.sameBoundary(prior,null),false);
});
test('denied assigned bot cannot fall through while unrelated legacy channels retain their flow path',async()=>{
 const f=fixture();f.state.plan.current_period=0;const denied=await access.resolveOwnerAccess(f.db,f.uid);
 assert.equal(await access.blocksFallback(f.db,denied,'qr','channel-a'),true);assert.deepEqual(f.state.calls.at(-1).args,[denied.tenantId,'qr','channel-a']);assert.match(f.state.calls.at(-1).sql,/p.tenant_id=a.tenant_id/);
 f.state.assigned=false;assert.equal(await access.blocksFallback(f.db,denied,'qr','channel-b'),false);assert.equal(await access.blocksFallback(f.db,{linked:false},'qr','legacy'),false);
});
