'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{createCategoryRegistry}=require('../modules/platform/category-registry'),{capabilities}=require('../modules/platform/policy'),actors=require('../modules/platform/legacy-pipeline-actor'),categories=require('../modules/platform/categories');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const registry=createCategoryRegistry([{key:'future_property',version:2,title:{en:'Property fixture',ar:'عقار تجريبي'},public:false,planable:true,seatRoles:['owner','manager','agent'],capabilities:['crm.leads','team.tasks'],migration:'20261001_platform_identity.sql'}],capabilities),category=registry.get('future_property',2);
function fixture(role='manager'){
 const user={id:7,uid:'synthetic-'+role,email:role+'@example.invalid'},owner={id:1,uid:role==='owner'?user.uid:'synthetic-owner',email:'owner@example.invalid',timezone:'Asia/Qatar'};owner.ownerUidHash=sha(owner.uid);
 const linked={tenantId:'tenant-a',tenantStatus:'active',categoryKey:category.key,categoryVersion:2,membershipId:'member-'+role,identityId:'identity-'+role,role,membershipStatus:'active',identityEmail:user.email,identityStatus:'active',legacyUidHash:sha(user.uid),roleProfileId:null,assignedNavigation:null};
 const queries=[],db={query:async(sql,args)=>{queries.push({sql,args});if(sql.includes('SELECT u.uid,u.timezone'))return [[owner]];return [[linked]];},release(){}};
 const subscription={status:'active',categoryKey:category.key,categoryVersion:2,capabilities:category.capabilities};return {user,owner,linked,queries,pool:{getConnection:async()=>db},options:{categoryFor:registry.get,loadEntitlements:async()=>subscription},subscription};
}
test('future registered category versions resolve shared owner/manager actors without training or Sales identity',async()=>{
 for(const role of ['owner','manager']){const f=fixture(role),actor=await actors.resolve(f.pool,f.user,f.options);assert.equal(actor.uid,f.owner.uid);assert.equal(actor.role,role);assert.equal(actor.categoryVersion,2);assert.equal(actor.canonicalContext.category,category);assert.equal(actors.canUsePipeline(actor),true);assert.equal(actor.scopeAgentIds,undefined);assert.equal(f.queries.some(q=>q.sql.includes('sx_sales_org_history')),false);}
});
test('unregistered versions, missing capability, wrong plans and malformed scopes fail closed',async()=>{
 for(const [patch,expected] of [[{categoryVersion:3},'CATEGORY_UNAVAILABLE'],[{tenantStatus:'inactive'},'BUSINESS_ACCESS_INACTIVE'],[{assignedNavigation:'[]'},'PERMISSION_DENIED'],[{roleProfileId:'role-a',rolePermissions:'["leads.read"]',roleStatus:'disabled',seatRole:'manager'},'BUSINESS_LINK_INVALID']]){const f=fixture();Object.assign(f.linked,patch);assert.equal((await actors.resolve(f.pool,f.user,f.options)).code,expected);}
 const f=fixture();f.subscription.categoryVersion=1;assert.equal((await actors.resolve(f.pool,f.user,f.options)).code,'FEATURE_UNAVAILABLE');
 assert.equal(actors.pipelineCategory({...category,capabilities:['team.tasks']}),false);assert.equal(actors.pipelineCategory({...category,planable:false}),false);
});
test('future category agents bind owner, membership, category version and existing assigned-lead scope',async()=>{
 const f=fixture('owner'),agent={id:9,uid:'synthetic-agent',owner_uid:f.owner.uid,email:'agent@example.invalid'},agentLink={...f.linked,role:'agent',membershipId:'member-agent',identityId:'identity-agent',identityEmail:agent.email,legacyUidHash:sha(agent.uid)};
 const base=await f.pool.getConnection(),original=base.query;base.query=async(sql,args)=>{if(sql.startsWith('SELECT id,uid,email,timezone'))return [[{...f.user,timezone:'Asia/Qatar'}]];if(sql.includes("o.source_table='agents'"))return [[agentLink]];return original(sql,args);};
 const actor=await actors.resolveAgent(f.pool,agent,f.options);assert.equal(actor.agentId,9);assert.equal(actor.role,'agent');assert.equal(actor.canonicalContext.membership.id,'member-agent');assert.equal(actor.categoryVersion,2);assert.equal(actor.scopeAgentIds,undefined);
 agentLink.categoryVersion=1;assert.equal((await actors.resolveAgent(f.pool,agent,f.options)).code,'BUSINESS_ACCESS_INACTIVE');
});
test('legacy Sales category aliases retain team-leader Pipeline scope',async()=>{
 const sales=categories.salemaxSales,user={id:9,uid:'legacy-sales-leader',email:'leader@example.invalid'},owner={uid:'legacy-sales-owner',timezone:'Asia/Qatar',ownerUidHash:sha('legacy-sales-owner')};
 const linked={tenantId:'sales-tenant',tenantStatus:'active',categoryKey:'salemax_sales',categoryVersion:1,membershipId:'sales-leader',identityId:'identity-leader',role:'team_leader',membershipStatus:'active',identityEmail:user.email,identityStatus:'active',legacyUidHash:sha(user.uid),roleProfileId:null,assignedNavigation:null};
 const queries=[],db={query:async(sql,args)=>{queries.push({sql,args});if(sql.includes('SELECT u.uid,u.timezone'))return [[owner]];if(sql.includes('FROM agents a JOIN'))return [[]];if(sql.includes('SELECT DISTINCT m.identity_id'))return [[]];return [[linked]];},release(){}};
 const result=await actors.resolve({getConnection:async()=>db},user,{categoryFor:key=>key==='salemax_sales'?sales:null,loadEntitlements:async()=>({status:'active',categoryKey:sales.key,categoryVersion:sales.version,capabilities:[...sales.capabilities]})});
 assert.equal(result.role,'team_leader');assert.equal(result.categoryKey,'salemax_sales');assert.equal(result.canonicalContext.category.key,'7network_sales');assert.deepEqual(result.scopeAgentIds,[]);assert.ok(queries.some(({sql})=>sql.includes('sx_sales_org_history')));
});
