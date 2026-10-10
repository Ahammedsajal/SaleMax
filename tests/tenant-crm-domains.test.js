'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const domains=require('../modules/platform/tenant-crm-domains');

test('CRM hostname validation canonicalizes safe subdomains and rejects reserved or malformed hosts',()=>{
  assert.equal(domains.normalizeHostname('CRM.Example.QA.'), 'crm.example.qa');
  for(const value of ['crm.salemax.qa','foo.salemax.qa','salemax.qa','localhost','127.0.0.1','*.example.qa','https://crm.example.qa','crm.example.qa:443','foo..example.qa','-bad.example.qa'])assert.throws(()=>domains.normalizeHostname(value));
  for(const value of ['example.com','example.co.uk','example.qa'])assert.throws(()=>domains.normalizeHostname(value),{code:'HOSTNAME_MUST_BE_SUBDOMAIN'});
  assert.equal(domains.normalizeHostname('crm.example.co.uk'),'crm.example.co.uk');
  assert.equal(domains.requestHost({get:()=> 'crm.example.qa:443'}),'crm.example.qa');
  assert.equal(domains.requestHost({get:()=> 'invalid host'}),null);
});

test('custom CRM write origins are exact-host and remain separate from canonical origin',()=>{
  const matches=require('../modules/platform/request-origin').matches,canonical='https://crm.salemax.qa',host='crm.example.qa';
  const request=origin=>({crmTenantDomain:{hostname:host},get:()=>origin});
  assert.equal(matches({get:()=>canonical},canonical),true);
  assert.equal(matches({get:()=> 'https://attacker.example'},canonical),false);
  assert.equal(matches(request(`https://${host}`),canonical),true);
  assert.equal(matches(request('https://other.example'),canonical),false);
  assert.equal(matches(request(`http://${host}`),canonical),false);
  assert.equal(matches({...request(`https://${host}`),crmTenantDomain:null},canonical),false);
});

test('CRM host middleware gates inactive domains and allows only CRM routes for active domains',async()=>{
  const rows={
    'pending.example.qa':{tenantId:'tenant-a',status:'pending',tlsReadyAt:null},
    'active.example.qa':{tenantId:'tenant-a',status:'active',tlsReadyAt:new Date(),tenantStatus:'active',dnsHealthStatus:'healthy'},
    'suspended.example.qa':{tenantId:'tenant-a',status:'active',tlsReadyAt:new Date(),tenantStatus:'suspended',dnsHealthStatus:'healthy'},
    'stale.example.qa':{tenantId:'tenant-a',status:'active',tlsReadyAt:new Date(),tenantStatus:'active',dnsHealthStatus:'stale'},
    'disabled.example.qa':{tenantId:'tenant-a',status:'disabled',tlsReadyAt:null},
  };
  const pool={getConnection:async()=>({query:async(_sql,[host])=>[[rows[host]||null].filter(Boolean)],release(){}})};
  const middleware=domains.middleware(pool);
  const run=async(host,path)=>{const req={method:'GET',path,get:name=>name==='host'?host:undefined};let called=false;const out={statusCode:200,status(n){this.statusCode=n;return this;},type(){return this;},send(body){this.body=body;return this;},end(){return this;},json(body){this.body=body;return this;}};await middleware(req,out,()=>{called=true;});return {req,out,called};};
  const pending=await run('pending.example.qa','/user');assert.equal(pending.out.statusCode,410);assert.equal(pending.called,false);
  const active=await run('active.example.qa','/user');assert.equal(active.called,true);assert.equal(active.req.crmTenantDomain.tenantId,'tenant-a');
  const suspended=await run('suspended.example.qa','/user');assert.equal(suspended.out.statusCode,410);assert.equal(suspended.called,false);
  const stale=await run('stale.example.qa','/user');assert.equal(stale.out.statusCode,410);assert.equal(stale.called,false);
  for(const path of ['/api/inbox/chats','/api/chat_flow/list','/api/templet/list','/api/broadcast/list','/api/pipeline/leads','/api/user/profile'])assert.equal((await run('active.example.qa',path)).called,true,path);
  const admin=await run('active.example.qa','/admin');assert.equal(admin.out.statusCode,404);assert.equal(admin.called,false);
  for(const path of ['/api/admin/plans','/api/public/forms','/api/web/get_web_public','/healthz','/']){const blocked=await run('active.example.qa',path);assert.equal(blocked.out.statusCode,404,path);assert.equal(blocked.called,false,path);}
  const disabled=await run('disabled.example.qa','/api/user/me');assert.equal(disabled.out.statusCode,410);
  const root=await run('crm.salemax.qa','/');assert.equal(root.called,true);
});

test('CRM host context must match tenant and reviewed legacy ownership',async()=>{
  const req={crmTenantDomain:{hostname:'crm.example.qa',tenantId:'tenant-a'}};
  const db={query:async()=>[[{tenantId:'tenant-a',status:'active',tlsReadyAt:new Date(),tenantStatus:'active',dnsHealthStatus:'healthy'}]]};
  await domains.assertTenantHost(db,req,'tenant-a');
  await assert.rejects(domains.assertTenantHost(db,req,'tenant-b'),{code:'CRM_DOMAIN_TENANT_MISMATCH'});
  const activeMember={tenantId:'tenant-a',membershipStatus:'active',tenantStatus:'active',identityStatus:'active',domainStatus:'active',tlsReadyAt:new Date(),dnsHealthStatus:'healthy',role:'agent'};
  await assert.rejects(domains.assertLegacyHost(async()=>[{...activeMember,tenantId:'tenant-b'}],req,'agents','22'),{code:'CRM_DOMAIN_TENANT_MISMATCH'});
  await domains.assertLegacyHost(async()=>[activeMember],req,'agents','23');
  await assert.rejects(domains.assertLegacyHost(async()=>[{...activeMember,membershipStatus:'inactive'}],req,'agents','25'),{code:'CRM_DOMAIN_TENANT_MISMATCH'});
  await assert.rejects(domains.assertLegacyHost(async()=>[{...activeMember,tenantStatus:'suspended'}],req,'agents','26'),{code:'CRM_DOMAIN_TENANT_MISMATCH'});
  await assert.rejects(domains.assertLegacyHost(async()=>[{...activeMember,dnsHealthStatus:'stale'}],req,'agents','27'),{code:'CRM_DOMAIN_TENANT_MISMATCH'});
  await assert.rejects(domains.assertLegacyHost(async()=>[],req,'agents','24'),{code:'CRM_DOMAIN_TENANT_MISMATCH'});
});

test('DNS record checks compare the stored token hash and require SaleMaX CNAME',async()=>{
  const crypto=require('node:crypto'),token='synthetic-random-token',tokenHash=crypto.createHash('sha256').update(token).digest('hex');
  const healthy=await domains.checkDnsRecords({hostname:'crm.example.qa',tokenHash},{resolveTxt:async name=>{assert.equal(name,'_salemax-verification.crm.example.qa');return [[`salemax-domain-verification=${token}`]];},resolveCname:async()=>['crm.salemax.qa.']});assert.deepEqual(healthy,{healthy:true,txtOk:true,cnameOk:true});
  const stale=await domains.checkDnsRecords({hostname:'crm.example.qa',tokenHash},{resolveTxt:async()=>[],resolveCname:async()=>['other.example.qa.']});assert.deepEqual(stale,{healthy:false,txtOk:false,cnameOk:false});
});

test('scheduled DNS audit records stale/restored transitions and preserves healthy state',async()=>{
  const crypto=require('node:crypto'),token='audit-synthetic-token',tokenHash=crypto.createHash('sha256').update(token).digest('hex');
  async function run(initial,records){let health=initial;const actions=[];const db={async query(sql,params){if(sql.includes("WHERE status='active'"))return [[{id:'domain-a',tenantId:'tenant-a',hostname:'crm.example.qa',tokenHash,dnsHealthStatus:health}]];if(sql.includes('SELECT status,dns_health_status')&&sql.includes('FOR UPDATE'))return [[{status:'active',dnsHealthStatus:health}]];if(sql.startsWith('UPDATE sx_tenant_crm_domains SET dns_health_status=')){health=params[0];return [[]];}if(sql.includes('INSERT INTO sx_audit_events')){actions.push(params[2]);return [[]];}throw new Error(`Unexpected SQL: ${sql}`);},async beginTransaction(){},async commit(){},async rollback(){}};const result=await domains.auditActiveDns(db,{resolveTxt:async()=>records.txt,resolveCname:async()=>records.cname});return {result,health,actions};}
  const stale=await run('healthy',{txt:[],cname:['crm.salemax.qa.']});assert.equal(stale.result.stale,1);assert.equal(stale.health,'stale');assert.deepEqual(stale.actions,['tenant.crm-domain.dns-stale']);
  const restored=await run('stale',{txt:[[`salemax-domain-verification=${token}`]],cname:['crm.salemax.qa.']});assert.equal(restored.result.stale,0);assert.equal(restored.health,'healthy');assert.deepEqual(restored.actions,['tenant.crm-domain.dns-restored']);
  const stillHealthy=await run('healthy',{txt:[[`salemax-domain-verification=${token}`]],cname:['crm.salemax.qa.']});assert.equal(stillHealthy.actions.length,0);
});

test('operator retirement is allowed only after the tenant disabled its domain',async()=>{
  let status='active';
  const db={query:async()=>[[{status}]]};
  const gone=async()=>{throw Object.assign(new Error('no CNAME'),{code:'ENODATA'});};
  await assert.rejects(domains.assertRetiredForOps(db,'crm.example.qa',{resolveCname:gone}),{code:'DOMAIN_MUST_BE_DISABLED'});
  status='disabled';
  await assert.rejects(domains.assertRetiredForOps(db,'crm.example.qa',{resolveCname:async()=>['crm.salemax.qa.']}),{code:'DOMAIN_DNS_STILL_POINTS_TO_SALEMAX'});
  await assert.rejects(domains.assertRetiredForOps(db,'crm.example.qa',{resolveCname:async()=>{throw Object.assign(new Error('resolver unavailable'),{code:'ESERVFAIL'});}}),{code:'DOMAIN_DNS_REMOVAL_UNVERIFIED'});
  assert.deepEqual(await domains.assertRetiredForOps(db,'crm.example.qa',{resolveCname:gone}),{hostname:'crm.example.qa',status:'disabled',saleMaxCnameAbsent:true});
  const fs=require('node:fs'),path=require('node:path'),script=fs.readFileSync(path.join(__dirname,'../deploy/tenant-domain-retire.sh'),'utf8');
  assert.match(script,/check-retire/);assert.match(script,/Refusing to remove an unrelated Nginx site/);assert.match(script,/certbot delete --non-interactive --cert-name/);
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
  assert.match(shell,/tenant-crm-appearance\.js\?v=20261010-tenant-crm2/);
  assert.match(ui,/These settings do not change your public website/);
  assert.match(ui,/separately from the logo used on your public forms and documents/);
  assert.match(worker,/Tenant domains are CRM-only origins/);
  assert.match(worker,/pathname\.startsWith\("\/api\/"\)/);
});
