'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const domains=require('../modules/platform/tenant-crm-domains');

test('CRM hostname validation canonicalizes safe subdomains and rejects reserved or malformed hosts',()=>{
  assert.equal(domains.normalizeHostname('CRM.Example.QA.'), 'crm.example.qa');
  for(const value of ['crm.salemax.qa','foo.salemax.qa','salemax.qa','localhost','127.0.0.1','*.example.qa','https://crm.example.qa','crm.example.qa:443','foo..example.qa','-bad.example.qa'])assert.throws(()=>domains.normalizeHostname(value));
  assert.equal(domains.requestHost({get:()=> 'crm.example.qa:443'}),'crm.example.qa');
  assert.equal(domains.requestHost({get:()=> 'invalid host'}),null);
});

test('CRM host middleware gates inactive domains and allows only CRM routes for active domains',async()=>{
  const rows={
    'pending.example.qa':{tenantId:'tenant-a',status:'pending',tlsReadyAt:null},
    'active.example.qa':{tenantId:'tenant-a',status:'active',tlsReadyAt:new Date()},
    'disabled.example.qa':{tenantId:'tenant-a',status:'disabled',tlsReadyAt:null},
  };
  const pool={getConnection:async()=>({query:async(_sql,[host])=>[[rows[host]||null].filter(Boolean)],release(){}})};
  const middleware=domains.middleware(pool);
  const run=async(host,path)=>{const req={method:'GET',path,get:name=>name==='host'?host:undefined};let called=false;const out={statusCode:200,status(n){this.statusCode=n;return this;},type(){return this;},send(body){this.body=body;return this;},end(){return this;},json(body){this.body=body;return this;}};await middleware(req,out,()=>{called=true;});return {req,out,called};};
  const pending=await run('pending.example.qa','/user');assert.equal(pending.out.statusCode,410);assert.equal(pending.called,false);
  const active=await run('active.example.qa','/user');assert.equal(active.called,true);assert.equal(active.req.crmTenantDomain.tenantId,'tenant-a');
  for(const path of ['/api/inbox/chats','/api/chat_flow/list','/api/templet/list','/api/broadcast/list','/api/pipeline/leads','/api/user/profile'])assert.equal((await run('active.example.qa',path)).called,true,path);
  const admin=await run('active.example.qa','/admin');assert.equal(admin.out.statusCode,404);assert.equal(admin.called,false);
  for(const path of ['/api/admin/plans','/api/public/forms','/api/web/get_web_public','/']){const blocked=await run('active.example.qa',path);assert.equal(blocked.out.statusCode,404,path);assert.equal(blocked.called,false,path);}
  const disabled=await run('disabled.example.qa','/api/user/me');assert.equal(disabled.out.statusCode,410);
  const root=await run('crm.salemax.qa','/');assert.equal(root.called,true);
});

test('CRM host context must match tenant and reviewed legacy ownership',async()=>{
  const req={crmTenantDomain:{hostname:'crm.example.qa',tenantId:'tenant-a'}};
  const db={query:async()=>[[{tenantId:'tenant-a',status:'active',tlsReadyAt:new Date()}]]};
  await domains.assertTenantHost(db,req,'tenant-a');
  await assert.rejects(domains.assertTenantHost(db,req,'tenant-b'),{code:'CRM_DOMAIN_TENANT_MISMATCH'});
  await assert.rejects(domains.assertLegacyHost(async()=>[{tenantId:'tenant-b'}],req,'user','22'),{code:'CRM_DOMAIN_TENANT_MISMATCH'});
  await domains.assertLegacyHost(async()=>[{tenantId:'tenant-a'}],req,'agents','23');
  await assert.rejects(domains.assertLegacyHost(async()=>[],req,'agents','24'),{code:'CRM_DOMAIN_TENANT_MISMATCH'});
});

test('tenant CRM logo storage is private and the appearance UI keeps the existing business panel',()=>{
  const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');
  const media=fs.readFileSync(path.join(root,'modules/platform/tenant-crm-logo-media.js'),'utf8');
  const router=fs.readFileSync(path.join(root,'modules/platform/tenant-crm-router.js'),'utf8');
  const ui=fs.readFileSync(path.join(root,'client/public/tenant-crm-appearance.js'),'utf8');
  const shell=fs.readFileSync(path.join(root,'client/public/index.html'),'utf8');
  const worker=fs.readFileSync(path.join(root,'client/public/worker.js'),'utf8');
  assert.match(media,/database\/local-runtime\/crm-tenant-logos/);
  assert.match(media,/MAX_LOGO_BYTES=5\*1024\*1024/);
  assert.match(media,/CRM_LOGO_SIGNATURE_INVALID/);
  assert.match(router,/canonicalGuard/);
  assert.match(router,/sendLogo/);
  assert.match(shell,/tenant-crm-appearance\.js\?v=20261010-tenant-crm1/);
  assert.match(ui,/These settings do not change your public website/);
  assert.match(ui,/separately from the logo used on your public forms and documents/);
  assert.match(worker,/Tenant domains are CRM-only origins/);
  assert.match(worker,/pathname\.startsWith\("\/api\/"\)/);
});
