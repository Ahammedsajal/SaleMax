'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const profile=require('../modules/platform/tenant-business-profile');
const profileShell=require('../modules/platform/tenant-business-profile-shell');
const owner={audience:'tenant',tenant:{id:'tenant-1'},membership:{tenantId:'tenant-1',status:'active',role:'owner'},identity:{id:'identity-1'}};
const values={businessNameEn:'Example Trading',businessNameAr:'شركة المثال',crNumber:'CR-123',email:'hello@example.com',phone:'+974 5555 1234',websiteUrl:'https://example.com/',addressEn:'Doha, Qatar',addressAr:'الدوحة، قطر',googleMapsUrl:'https://maps.google.com/?q=Doha',metaTitleEn:'Example Trading | Doha',metaTitleAr:'شركة المثال | الدوحة',metaDescriptionEn:'A short business description.',metaDescriptionAr:'وصف مختصر للنشاط.'};

test('business profile validates public URLs and rejects scripts, credentials and non-Google map links',()=>{
  assert.deepEqual(profile.normalize(values),values);
  assert.throws(()=>profile.normalize({...values,websiteUrl:'javascript:alert(1)'}),{code:'INVALID_WEBSITE_URL'});
  assert.throws(()=>profile.normalize({...values,websiteUrl:'https://user:pass@example.com'}),{code:'INVALID_WEBSITE_URL'});
  assert.throws(()=>profile.normalize({...values,googleMapsUrl:'https://attacker.example/map'}),{code:'INVALID_MAPS_URL'});
  assert.throws(()=>profile.normalize({...values,email:'not-an-email'}),{code:'INVALID_EMAIL'});
});

test('profile edits require the active tenant owner',async()=>{
  let queries=0;const db={query:async()=>{queries++;return [[],[]];},beginTransaction:async()=>{throw new Error('must not start');}};
  await assert.rejects(profile.get(db,{...owner,membership:{...owner.membership,role:'agent'}}),{code:'PERMISSION_DENIED'});
  await assert.rejects(profile.save(db,{...owner,membership:{...owner.membership,role:'manager'}},0,values),{code:'PERMISSION_DENIED'});
  assert.equal(queries,0);
});

test('business profile save locks the tenant, checks revisions, mirrors the CRM logo and audits without field values',async()=>{
  const sql=[],db={beginTransaction:async()=>sql.push('BEGIN'),commit:async()=>sql.push('COMMIT'),rollback:async()=>sql.push('ROLLBACK'),query:async(statement,params)=>{sql.push({statement,params});if(statement.startsWith('SELECT logo_url AS logoUrl,favicon_url'))return [[{logoUrl:'/old-logo',faviconUrl:'/old-icon',revision:4}],[]];return [[],[]];}};
  const saved=await profile.save(db,owner,4,values);
  assert.equal(saved.revision,5);assert.equal(saved.businessNameEn,values.businessNameEn);assert.equal(saved.logoUrl,'/old-logo');assert.equal(saved.faviconUrl,'/old-icon');
  assert.ok(sql.findIndex(item=>typeof item==='object'&&item.statement.includes('SELECT id FROM sx_tenants'))<sql.findIndex(item=>typeof item==='object'&&item.statement.startsWith('SELECT logo_url AS logoUrl')));
  assert.ok(sql.some(item=>typeof item==='object'&&item.statement.includes('INSERT INTO sx_tenant_business_profiles')));
  assert.ok(sql.some(item=>typeof item==='object'&&item.statement.includes('INSERT INTO sx_tenant_crm_branding')));
  const audit=sql.find(item=>typeof item==='object'&&item.statement.includes('INSERT INTO sx_audit_events'));
  assert.match(audit.statement,/tenant\.business-profile\.updated/);assert.doesNotMatch(audit.params[4],/Example Trading|hello@example/);
  assert.equal(sql.at(-1),'COMMIT');
});

test('stale profile revisions roll back without writing profile data',async()=>{
  const sql=[],db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>sql.push('ROLLBACK'),query:async(statement)=>{sql.push(statement);if(statement.startsWith('SELECT logo_url AS logoUrl,favicon_url'))return [[{revision:7}],[]];return [[],[]];}};
  await assert.rejects(profile.save(db,owner,6,values),{code:'STALE_REVISION'});
  assert.equal(sql.some(statement=>typeof statement==='string'&&statement.includes('INSERT INTO sx_tenant_business_profiles')),false);
  assert.ok(sql.includes('ROLLBACK'));
});

test('public profile projection excludes CR, address, email and phone',async()=>{
  const db={query:async()=>[[{tenantId:'tenant-1',tenantName:'Old name',businessNameEn:'Public name',businessNameAr:'الاسم',profileLogoUrl:'/logo.png',faviconUrl:'/favicon.png',metaTitleEn:'Public title',metaTitleAr:'عنوان',metaDescriptionEn:'Public description',metaDescriptionAr:'وصف',revision:4,legacyLogoUrl:'/legacy.png'}],[]]};
  const data=await profile.getPublicForTenant(db,'tenant-1');
  assert.equal(data.name,'Public name');assert.equal(data.logoUrl,'/logo.png');assert.equal(data.faviconUrl,'/favicon.png');assert.equal(data.metaDescriptionAr,'وصف');
  for(const key of ['crNumber','addressEn','addressAr','email','phone','websiteUrl'])assert.equal(Object.hasOwn(data,key),false,key);
});

test('verified-domain HTML gets escaped server-side tab metadata and safe favicon without private profile fields',()=>{
  const source='<html><head><title>7Network</title><link rel="icon" href="/old.ico"><meta name="description" content="platform"><meta property="og:title" content="7Network"><link rel="canonical" href="https://7network.live/"></head><body></body></html>';
  const html=profileShell.renderShell(source,{nameEn:'<script>alert(1)</script>',metaTitleEn:'<img src=x onerror=alert(1)>',metaDescriptionEn:'Public description',faviconUrl:'javascript:alert(1)',logoUrl:'/api/crm/logos/tenant-1/logo.png'},{hostname:'brand.example.qa',pathname:'/user/login'});
  assert.match(html,/<title>&lt;img src=x onerror=alert\(1\)&gt;<\/title>/);
  assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);
  assert.match(html,/og:url" content="https:\/\/brand\.example\.qa\/user\/login/);
  assert.match(html,/rel="icon" href="\/api\/crm\/logos\/tenant-1\/logo\.png"/);
  assert.match(html,/content="Public description"/);
  assert.doesNotMatch(html,/hello@example\.com|CR-123|Doha, Qatar/);
});

test('business profile migration and cache patch remain additive and preserve live-only shell content',()=>{
  const root=path.join(__dirname,'..');
  const migration=require('../database/migration-runner').discover(path.join(root,'database/migrations')).find(item=>item.file==='20270103_tenant_business_profiles.sql');
  assert.ok(migration);assert.equal(migration.statements.some(statement=>/^\s*(DROP|TRUNCATE)\b/i.test(statement)),false);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sx-business-profile-cache-'));
  try{
    const target=path.join(temp,'index.html');fs.writeFileSync(target,'<script src="/training-sidebar.js?v=20261025-sales-business-settings-crm-appearance1"></script><script src="/tenant-crm-appearance.js?v=20270102-admin-domains1"></script><script src="/static/js/live-production.js"></script>');
    const result=spawnSync(process.execPath,[path.join(root,'deploy/patch-tenant-business-profile-cache.cjs'),target],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
    const html=fs.readFileSync(target,'utf8');assert.match(html,/training-sidebar\.js\?v=20270103-business-profile1/);assert.match(html,/tenant-crm-appearance\.js\?v=20270103-business-profile1/);assert.match(html,/\/static\/js\/live-production\.js/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
