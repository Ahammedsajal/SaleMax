'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {Readable}=require('node:stream');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const logoMedia=require('../modules/platform/tenant-crm-logo-media');
const {createTenantCrmRouter}=require('../modules/platform/tenant-crm-router');

test('tenant CRM logos stream through managed storage only after tenant authorization',async t=>{
  const tenantA='11111111-1111-4111-8111-111111111111',tenantB='22222222-2222-4222-8222-222222222222',filename='33333333-3333-4333-8333-333333333333.png',opened=[];
  const previous=logoMedia.openManaged;
  logoMedia.openManaged=async(url,tenantId)=>{opened.push({url,tenantId});return {body:Readable.from(Buffer.from('synthetic')),contentType:'image/png',contentLength:9};};
  t.after(()=>{if(previous===undefined)delete logoMedia.openManaged;else logoMedia.openManaged=previous;});
  const app=express();
  app.use((req,res,next)=>{if(req.get('host')==='customer.example.test')req.crmTenantDomain={tenantId:tenantA,hostname:'customer.example.test'};next();});
  app.use('/api/crm',createTenantCrmRouter({pool:{},canonicalGuard:(req,res,next)=>{req.businessContext={tenant:{id:tenantA}};next();}}));
  const server=app.listen(0,'127.0.0.1');t.after(()=>new Promise(resolve=>server.close(resolve)));await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/crm/logos`;
  const publicLogo=await fetch(`${base}/${tenantA}/${filename}`,{headers:{Host:'customer.example.test'}});
  assert.equal(publicLogo.status,200);assert.equal(await publicLogo.text(),'synthetic');assert.equal(publicLogo.headers.get('content-type'),'image/png');assert.equal(publicLogo.headers.get('content-length'),'9');assert.equal(publicLogo.headers.get('cache-control'),'private, max-age=300');assert.equal(publicLogo.headers.get('x-content-type-options'),'nosniff');
  const streamedHead=await fetch(`${base}/${tenantA}/${filename}`,{method:'HEAD',headers:{Host:'customer.example.test'}});assert.equal(streamedHead.status,200);assert.equal(streamedHead.headers.get('content-type'),'image/png');assert.equal(streamedHead.headers.get('content-length'),'9');assert.equal(await streamedHead.text(),'');
  const foreign=await fetch(`${base}/${tenantB}/${filename}`,{headers:{Host:'customer.example.test'}});assert.equal(foreign.status,404);assert.equal(opened.length,2,'foreign tenant URL is rejected before storage access');
  const canonical=await fetch(`${base}/${tenantA}/${filename}`);assert.equal(canonical.status,200);assert.deepEqual(opened.map(item=>item.tenantId),[tenantA,tenantA,tenantA]);
  logoMedia.openManaged=async()=>{throw Object.assign(new Error('missing'),{code:'STORED_OBJECT_NOT_FOUND'});};
  const missing=await fetch(`${base}/${tenantA}/${filename}`);assert.equal(missing.status,404);assert.deepEqual(await missing.json(),{success:false,code:'STORED_OBJECT_NOT_FOUND'});
  logoMedia.openManaged=async()=>{throw Object.assign(new Error('storage down'),{code:'OBJECT_STORAGE_UNAVAILABLE'});};
  const unavailable=await fetch(`${base}/${tenantA}/${filename}`);assert.equal(unavailable.status,503);assert.deepEqual(await unavailable.json(),{success:false,code:'CRM_APPEARANCE_UNAVAILABLE'});
});

test('tenant CRM logo local-file fallback remains compatible without an object-storage adapter',async t=>{
  const tenantA='11111111-1111-4111-8111-111111111111',tenantB='22222222-2222-4222-8222-222222222222',filename='33333333-3333-4333-8333-333333333333.png';
  const previousOpen=logoMedia.openManaged,previousPath=logoMedia.managedPath,root=await fs.mkdtemp(path.join(os.tmpdir(),'7network-logo-fallback-')),file=path.join(root,'logo.png');
  await fs.writeFile(file,'local-logo');delete logoMedia.openManaged;const resolved=[];
  logoMedia.managedPath=(url,tenantId)=>{resolved.push({url,tenantId});return tenantId===tenantA?file:null;};
  t.after(async()=>{if(previousOpen===undefined)delete logoMedia.openManaged;else logoMedia.openManaged=previousOpen;logoMedia.managedPath=previousPath;await fs.rm(root,{recursive:true,force:true});});
  const app=express();app.use((req,res,next)=>{if(req.get('host')==='customer.example.test')req.crmTenantDomain={tenantId:tenantA,hostname:'customer.example.test'};next();});
  app.use('/api/crm',createTenantCrmRouter({pool:{},canonicalGuard:(req,res,next)=>{req.businessContext={tenant:{id:tenantA}};next();}}));
  const server=app.listen(0,'127.0.0.1');t.after(()=>new Promise(resolve=>server.close(resolve)));await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/crm/logos`,served=await fetch(`${base}/${tenantA}/${filename}`,{headers:{Host:'customer.example.test'}});
  assert.equal(served.status,200);assert.equal(await served.text(),'local-logo');
  const head=await fetch(`${base}/${tenantA}/${filename}`,{method:'HEAD',headers:{Host:'customer.example.test'}});assert.equal(head.status,200);assert.equal(head.headers.get('content-type'),'image/png');assert.equal(head.headers.get('content-length'),'10');assert.equal(await head.text(),'');
  const foreign=await fetch(`${base}/${tenantB}/${filename}`,{headers:{Host:'customer.example.test'}});assert.equal(foreign.status,404);assert.equal(resolved.length,2,'foreign tenant requests are denied before local path resolution');
});
