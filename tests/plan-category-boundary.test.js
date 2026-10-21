'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const plans=require('../modules/platform/plans'),{decision}=require('../modules/platform/policy'),{trainingCenter,salemaxSales}=require('../modules/platform/categories'),{navigationFor}=require('../modules/platform/navigation');
function context(category){return {audience:'tenant',tenant:{id:'tenant-a',categoryKey:category.key,categoryVersion:category.version,status:'active'},category,membership:{id:'owner',tenantId:'tenant-a',status:'active',role:'owner'},subscription:{status:'active',categoryKey:category.key,categoryVersion:category.version,capabilities:[...category.capabilities]}};}
test('current entitlement lookup joins the owning tenant category and exact version',async()=>{
 let query;const db={query:async(sql,args)=>{query={sql,args};return [[]];}};
 assert.equal(await plans.loadEntitlements(db,'11111111-1111-4111-8111-111111111111'),null);assert.match(query.sql,/t.id=a.tenant_id/);assert.match(query.sql,/t.category_key=p.category_key/);assert.match(query.sql,/t.category_version=p.category_version/);assert.match(query.sql,/p.status='published'/);assert.match(query.sql,/current_tenant IS NOT NULL/);
});
test('explicit foreign, partial or stale category metadata cannot grant shared or domain features',()=>{
 for(const category of [trainingCenter,salemaxSales])for(const patch of [{categoryKey:'foreign'},{categoryVersion:2},{categoryVersion:'1'},{categoryKey:undefined},{categoryVersion:undefined}]){
  const ctx=context(category);Object.assign(ctx.subscription,patch);
  for(const capability of category.capabilities){const permission=require('../modules/platform/policy').capabilities[capability][0];assert.deepEqual(decision(ctx,{capability,permission}),{allowed:false,code:'FEATURE_UNAVAILABLE'});}
  assert.deepEqual(navigationFor(ctx),[]);
 }
});
test('matching plans retain role decisions and internal recruitment exceptions never bypass category binding',()=>{
 for(const category of [trainingCenter,salemaxSales]){const ctx=context(category);assert.equal(decision(ctx,{capability:'messaging.inbox',permission:'conversations.read'}).allowed,true);}
 const ctx=context(salemaxSales);ctx.subscription.capabilities=[];assert.equal(decision(ctx,{capability:'hr.recruitment',permission:'recruitment.manage'}).allowed,true);
 ctx.subscription.categoryKey='training_center';assert.equal(decision(ctx,{capability:'hr.recruitment',permission:'recruitment.manage'}).allowed,false);
});
