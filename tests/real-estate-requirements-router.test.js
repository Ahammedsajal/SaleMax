'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const express=require('express');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const {createRouter}=require('../modules/platform/real-estate-requirements-router');
const category=require('../modules/platform/categories').realEstateV2;
const tenantId='11111111-1111-4111-8111-111111111111',ownerUid='synthetic-owner-7network',uidHash=crypto.createHash('sha256').update(ownerUid).digest('hex');
const leadId='44444444-4444-4444-8444-444444444444';
const context={audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:category.key,categoryVersion:category.version},membership:{id:'33333333-3333-4333-8333-333333333333',tenantId,role:'owner',status:'active'},category,subscription:{status:'active',categoryKey:category.key,categoryVersion:category.version,capabilities:[...category.capabilities]},identity:{id:'22222222-2222-4222-8222-222222222222'}};
const input={leadId,transactionType:'sale',propertyType:'apartment',minPriceMinor:50000000,maxPriceMinor:100000000,currency:'QAR',minAreaSqm:70,maxAreaSqm:120,minBedrooms:2,preferredCity:'Doha'};
async function start(businessContext=context){
  const calls=[],db={query:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT COUNT'))return [[{total:0}]];if(sql.startsWith('SELECT r.id'))return [[]];if(sql.startsWith('SELECT l.id'))return [[{id:leadId,owner_agent_id:null,leadAssignee:null}]];if(sql.startsWith('SELECT r.*'))return [[]];if(sql.startsWith('SELECT p.id'))return [[]];if(sql.startsWith('INSERT INTO'))return [{affectedRows:1}];throw Error('UNEXPECTED_QUERY');},beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){}};
  const app=express();app.use('/api/workspace/real-estate/requirements',createRouter({pool:{getConnection:async()=>db},authenticate(req,_res,next){req.businessContext=businessContext;req.featureSession={ownerUid};next();}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));return {origin:`http://127.0.0.1:${server.address().port}`,server,calls};
}

test('authenticated existing-workspace router lists only the verified owner hash and tenant',async t=>{
  const service=await start();t.after(()=>new Promise(resolve=>service.server.close(resolve)));
  const response=await fetch(service.origin+'/api/workspace/real-estate/requirements');assert.equal(response.status,200);assert.deepEqual((await response.json()).data.items,[]);
  assert.ok(service.calls.every(call=>call.args.includes(tenantId)&&call.args.includes(uidHash)));
});

test('private v2 API refuses v1 tenants before database access',async t=>{
  const v1=require('../modules/platform/categories').realEstate;
  const service=await start({...context,tenant:{...context.tenant,categoryVersion:1},category:v1,subscription:{...context.subscription,categoryVersion:1,capabilities:[...v1.capabilities]}});t.after(()=>new Promise(resolve=>service.server.close(resolve)));
  const response=await fetch(service.origin+'/api/workspace/real-estate/requirements');assert.equal(response.status,409);assert.ok((await response.json()).code);assert.equal(service.calls.length,0);
});

test('create route accepts typed requirements and returns no duplicated customer PII',async t=>{
  const service=await start();t.after(()=>new Promise(resolve=>service.server.close(resolve)));
  const response=await fetch(service.origin+'/api/workspace/real-estate/requirements',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  assert.equal(response.status,201);const result=await response.json();assert.equal(result.data.status,'open');assert.equal(result.data.leadId,leadId);assert.equal(Object.hasOwn(result.data,'contactName'),false);
  const leadQuery=service.calls.find(call=>call.sql.includes('FROM pipeline_leads l'));assert.deepEqual(leadQuery.args,[tenantId,uidHash,leadId]);
});

test('route is mounted under the shared workspace and protected by the existing role mapper',()=>{
  const mount=fs.readFileSync(path.join(__dirname,'../modules/platform/mount-existing-upgrade.js'),'utf8');
  assert.match(mount,/\/api\/workspace\/real-estate\/requirements/);
  assert.match(mount,/real-estate-requirements-router/);
  const client=fs.readFileSync(path.join(__dirname,'../client/public/property-listings/properties.js'),'utf8');
  const workspaceApi=fs.readFileSync(path.join(__dirname,'../client/public/workspace-api.js'),'utf8');
  const page=fs.readFileSync(path.join(__dirname,'../client/public/property-listings/index.html'),'utf8');
  assert.match(client,/Buyer requirements/);assert.match(client,/Find matching properties/);assert.match(client,/existing Pipeline leads/i);
  assert.match(workspaceApi,/requirements:'\/api\/workspace\/real-estate\/requirements'/);assert.match(page,/workspace-api\.js\?v=20261022-requirements2/);
});
