'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const test=require('node:test');
const crypto=require('node:crypto');
const {createRouter}=require('../modules/platform/real-estate-viewings-router');
const category=require('../modules/platform/categories').realEstateV3;
const tenantId='11111111-1111-4111-8111-111111111111',ownerUid='synthetic-owner-viewings',uidHash=crypto.createHash('sha256').update(ownerUid).digest('hex');
const context={audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:category.key,categoryVersion:3},membership:{id:'33333333-3333-4333-8333-333333333333',tenantId,role:'owner',status:'active'},category,subscription:{status:'active',categoryKey:category.key,categoryVersion:3,capabilities:[...category.capabilities,'crm.leads']},identity:{id:'22222222-2222-4222-8222-222222222222'}};
async function start(businessContext=context){
  const calls=[],db={query:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT COUNT'))return [[{total:0}]];if(sql.startsWith('SELECT v.id'))return [[]];if(sql.startsWith('SELECT l.id,l.title'))return [[]];if(sql.startsWith('SELECT p.id,p.reference_code'))return [[]];if(sql.startsWith('SELECT m.id AS membershipId'))return [[]];throw Error('UNEXPECTED_QUERY');},beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}};
  const app=express();app.use('/api/workspace/real-estate/viewings',createRouter({pool:{getConnection:async()=>db},authenticate(req,_res,next){req.businessContext=businessContext;req.featureSession={ownerUid};next();}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));return {origin:`http://127.0.0.1:${server.address().port}`,server,calls};
}
test('authenticated viewing APIs keep reads under the tenant and verified owner hash',async t=>{
  const api=await start();t.after(()=>new Promise(resolve=>api.server.close(resolve)));
  for(const path of ['/','/leads','/properties']){const response=await fetch(api.origin+'/api/workspace/real-estate/viewings'+path);assert.equal(response.status,200);}
  assert.ok(api.calls.every(call=>call.args.includes(tenantId)||call.args.includes(uidHash)));
});
test('old category version cannot access viewings or reach the database',async t=>{
  const v2=require('../modules/platform/categories').realEstateV2,api=await start({...context,tenant:{...context.tenant,categoryVersion:2},category:v2,subscription:{...context.subscription,categoryVersion:2,capabilities:[...v2.capabilities,'crm.leads']}});t.after(()=>new Promise(resolve=>api.server.close(resolve)));
  const response=await fetch(api.origin+'/api/workspace/real-estate/viewings');assert.equal(response.status,404);assert.equal((await response.json()).code,'CATEGORY_UNAVAILABLE');assert.equal(api.calls.length,0);
});
