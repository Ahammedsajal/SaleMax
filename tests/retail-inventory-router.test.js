'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const categories=require('../modules/platform/categories');
const {createRouter}=require('../modules/platform/retail-inventory-router');

const tenantId='11111111-1111-4111-8111-111111111111';
const identityId='22222222-2222-4222-8222-222222222222';
const membershipId='33333333-3333-4333-8333-333333333333';
function context(category=categories.retailShop,role='owner'){
  return {audience:'tenant',identity:{id:identityId},tenant:{id:tenantId,status:'active',categoryKey:category.key,categoryVersion:category.version},membership:{id:membershipId,tenantId,role,status:'active'},category,subscription:{status:'active',categoryKey:category.key,categoryVersion:category.version,capabilities:category.capabilities}};
}
async function start(ctx,query=async()=>[[]]){
  const calls=[];let releases=0;
  const db={query:async(sql,args)=>{calls.push({sql,args});return query(sql,args);},beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){releases++;}};
  const app=express();app.use('/api/workspace/inventory',createRouter({pool:{getConnection:async()=>db},authenticate(req,_res,next){req.businessContext=ctx;next();}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  return {origin:`http://127.0.0.1:${server.address().port}`,server,calls,get releases(){return releases;}};
}

test('inventory HTTP reads use the authenticated tenant and return bounded JSON',async t=>{
  const app=await start(context(),async(sql,args)=>sql.includes('sx_retail_locations')?[[{id:'44444444-4444-4444-8444-444444444444',code:'MAIN',nameEn:'Main',nameAr:'الرئيسي',status:'active',createdAt:'2026-10-22 00:00:00'}]]:[[]]);
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const response=await fetch(app.origin+'/api/workspace/inventory/locations');
  assert.equal(response.status,200);assert.equal((await response.json()).data[0].code,'MAIN');
  assert.equal(app.calls[0].args[0],tenantId);assert.equal(app.releases,1);
});

test('only owners and managers can adjust inventory and other categories cannot enter the API',async t=>{
  const agent=await start(context(categories.retailShop,'agent'));t.after(()=>new Promise(resolve=>agent.server.close(resolve)));
  const denied=await fetch(agent.origin+'/api/workspace/inventory/adjustments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})});
  assert.equal(denied.status,403);assert.equal((await denied.json()).code,'PERMISSION_DENIED');assert.equal(agent.calls.length,0);
  const training=await start(context(categories.trainingCenter));t.after(()=>new Promise(resolve=>training.server.close(resolve)));
  const crossCategory=await fetch(training.origin+'/api/workspace/inventory/locations');
  assert.equal(crossCategory.status,404);assert.equal((await crossCategory.json()).code,'CATEGORY_UNAVAILABLE');assert.equal(training.calls.length,0);
});

test('database errors return a stable customer-safe response without SQL details',async t=>{
  const app=await start(context(),async()=>{throw Object.assign(Error('private SQL and tenant detail'),{code:'ER_BAD_FIELD_ERROR'});});
  t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const response=await fetch(app.origin+'/api/workspace/inventory/locations');
  const payload=await response.json();assert.equal(response.status,503);assert.deepEqual(payload,{success:false,code:'INVENTORY_SERVICE_UNAVAILABLE'});
  assert.doesNotMatch(JSON.stringify(payload),/private SQL|tenant detail/);
});
