'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const test=require('node:test');
const requests=require('../modules/platform/real-estate-viewing-requests');
const {createRouter}=require('../modules/platform/real-estate-public-viewing-router');

async function start(){
  const originalMode=process.env.LOCAL_ONLY_MODE;process.env.LOCAL_ONLY_MODE='true';
  const originalGet=requests.publicProperty,originalSubmit=requests.submitPublic;
  const calls={get:0,submit:0};
  requests.publicProperty=async(_db,slug,id)=>{calls.get++;return {tenant:{name:'Synthetic Realty',slug},property:{id,titleEn:'Test home'},bookingMode:'request_only'};};
  requests.submitPublic=async(_pool,input)=>{calls.submit++;assert.equal(input.tenantSlug,'synthetic-realty');assert.match(input.visitorHash,/^[0-9a-f]{64}$/);return {referenceCode:'VR-1234ABCD',repeated:false,status:'requested',bookingMode:'request_only'};};
  const app=express();const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const origin=`http://127.0.0.1:${server.address().port}`;app.use('/api/public/real-estate/viewing-requests',createRouter({pool:{async getConnection(){return {release(){}};}},key:'test-hmac-key',origin}));
  return {origin,server,calls,restore(){requests.publicProperty=originalGet;requests.submitPublic=originalSubmit;if(originalMode===undefined)delete process.env.LOCAL_ONLY_MODE;else process.env.LOCAL_ONLY_MODE=originalMode;}};
}

test('public viewing HTTP endpoints enforce origin checks and return request-only guest outcomes',async t=>{
  const app=await start();t.after(()=>{app.restore();return new Promise(resolve=>app.server.close(resolve));});
  const path='/api/public/real-estate/viewing-requests/synthetic-realty/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const denied=await fetch(app.origin+path,{headers:{Origin:'https://attacker.example'}});assert.equal(denied.status,403);assert.equal((await denied.json()).code,'ORIGIN_DENIED');assert.equal(app.calls.get,0);
  const property=await fetch(app.origin+path,{headers:{Origin:app.origin}});assert.equal(property.status,200);assert.equal((await property.json()).data.bookingMode,'request_only');assert.equal(app.calls.get,1);
  const submitted=await fetch(app.origin+path,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({contactName:'Guest',phone:'+97455551234',consent:true})});assert.equal(submitted.status,201);const result=await submitted.json();assert.equal(result.data.status,'requested');assert.equal(result.data.bookingMode,'request_only');assert.equal(app.calls.submit,1);
});
