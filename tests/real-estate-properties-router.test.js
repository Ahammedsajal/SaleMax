'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const test=require('node:test');
const {createRouter}=require('../modules/platform/real-estate-properties-router');
const category=require('../modules/platform/categories').realEstate;
const tenantId='11111111-1111-4111-8111-111111111111';
const base={audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:category.key,categoryVersion:category.version},membership:{id:'33333333-3333-4333-8333-333333333333',tenantId,role:'owner',status:'active'},category,subscription:{status:'active',categoryKey:category.key,categoryVersion:category.version,capabilities:[...category.capabilities]},identity:{id:'22222222-2222-4222-8222-222222222222'}};
const listing={titleEn:'Test home',titleAr:'منزل اختبار',propertyType:'house',transactionType:'sale',status:'draft',priceMinor:100000,currency:'QAR',areaSqm:null,bedrooms:null,bathrooms:null,city:'Doha',descriptionEn:'Test listing',descriptionAr:'إعلان اختبار'};

async function start(context){
  const calls=[];
  const db={query:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT COUNT'))return [[{total:0}]];if(sql.startsWith('SELECT id,reference_code'))return [[]];if(sql.startsWith('INSERT INTO'))return [{affectedRows:1}];throw Error('UNEXPECTED_QUERY');},beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}};
  const app=express();app.use('/api/workspace/properties',createRouter({pool:{getConnection:async()=>db},authenticate(req,_res,next){req.businessContext=context;next();}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  return {origin:`http://127.0.0.1:${server.address().port}`,server,calls};
}

test('property HTTP routes enforce category/role boundaries and reject unknown fields',async t=>{
  const owner=await start(base);t.after(()=>new Promise(resolve=>owner.server.close(resolve)));
  const list=await fetch(owner.origin+'/api/workspace/properties');assert.equal(list.status,200);assert.deepEqual((await list.json()).data.items,[]);
  const created=await fetch(owner.origin+'/api/workspace/properties',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(listing)});
  assert.equal(created.status,201);assert.equal((await created.json()).data.status,'draft');
  const invalid=await fetch(owner.origin+'/api/workspace/properties',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...listing,tenantId:'foreign-tenant'})});
  assert.equal(invalid.status,400);assert.equal((await invalid.json()).code,'INVALID_PROPERTY');
  assert.ok(owner.calls.every(call=>!call.args?.includes('foreign-tenant')));
});

test('custom permissions cannot give agents tenant-wide property access',async t=>{
  const agent=await start({...base,membership:{...base.membership,role:'agent',customPermissions:['properties.read']}});t.after(()=>new Promise(resolve=>agent.server.close(resolve)));
  const response=await fetch(agent.origin+'/api/workspace/properties');assert.equal(response.status,403);assert.equal((await response.json()).code,'PERMISSION_DENIED');assert.equal(agent.calls.length,0);
});

test('a different category cannot use the property API',async t=>{
  const training=require('../modules/platform/categories').trainingCenter;
  const other={...base,tenant:{...base.tenant,categoryKey:training.key,categoryVersion:training.version},category:training,subscription:{...base.subscription,categoryKey:training.key,categoryVersion:training.version,capabilities:[...training.capabilities]}};
  const app=await start(other);t.after(()=>new Promise(resolve=>app.server.close(resolve)));
  const response=await fetch(app.origin+'/api/workspace/properties');assert.equal(response.status,404);assert.equal((await response.json()).code,'CATEGORY_UNAVAILABLE');assert.equal(app.calls.length,0);
});
