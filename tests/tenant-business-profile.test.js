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
    const target=path.join(temp,'index.html'),sidebar=path.join(temp,'training-sidebar.js'),mount=path.join(temp,'mount-existing-upgrade.js');
    fs.writeFileSync(target,'<script src="/training-sidebar.js?v=20261025-sales-business-settings-crm-appearance1"></script><script src="/tenant-crm-appearance.js?v=20270102-admin-domains1"></script><script src="/static/js/live-production.js"></script>');
    fs.writeFileSync(sidebar,"['settings','Business Settings','إعدادات الأعمال','crm-appearance']; const routes={'Business Settings':'crm-appearance'};");
    fs.writeFileSync(mount,"  app.use(tenantCrmDomains.middleware(pool));\n  require('../web/public-website');\n");
    const result=spawnSync(process.execPath,[path.join(root,'deploy/patch-tenant-business-profile-cache.cjs'),target,sidebar,mount],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
    const html=fs.readFileSync(target,'utf8'),menu=fs.readFileSync(sidebar,'utf8'),router=fs.readFileSync(mount,'utf8');
    assert.match(html,/training-sidebar\.js\?v=20270103-business-profile1/);assert.match(html,/tenant-crm-appearance\.js\?v=20270103-business-profile1/);assert.match(html,/\/static\/js\/live-production\.js/);
    assert.match(menu,/Business Profile','ملف النشاط التجاري/);assert.match(menu,/Business Profile':'crm-appearance','Business Settings/);assert.match(router,/tenant-business-profile-shell/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('partial business-profile migration recovery is exact-state gated and records the corrected checksum',async()=>{
  const recovery=require('../deploy/recover-tenant-business-profile-migration.cjs');
  const migration=require('../database/migration-runner').discover(path.join(__dirname,'../database/migrations')).find(item=>item.file===recovery.MIGRATION);
  const columns=['tenant_id','business_name_en','business_name_ar','cr_number','email','phone','website_url','address_en','address_ar','google_maps_url','logo_url','favicon_url','meta_title_en','meta_title_ar','meta_description_en','meta_description_ar','revision','updated_by_identity_id','updated_at'];
  const calls=[];let committed=false,profileCountCalls=0;
  const db={beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{},query:async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql==='SELECT DATABASE() AS db')return [[{db:'synthetic'}],[]];
    if(sql.startsWith('SELECT GET_LOCK'))return [[{acquired:1}],[]];
    if(sql==='SELECT migration_name,checksum,status FROM salemax_schema_migrations')return [[],[]];
    if(sql.includes('FROM salemax_schema_migrations'))return [[{migration_name:recovery.MIGRATION,checksum:recovery.PARTIAL_CHECKSUM,status:'failed',statements_completed:2,statement_count:3,error_code:'ER_NON_UNIQ_ERROR'}],[]];
    if(sql.includes('information_schema.columns'))return [columns.map(name=>({name})),[]];
    if(sql.includes('COUNT(*) AS count FROM sx_tenant_business_profiles'))return [[{count:profileCountCalls++===0?0:2}],[]];
    if(sql.includes('COUNT(*) AS count FROM sx_tenant_crm_branding'))return [[{count:0}],[]];
    if(sql.includes('COUNT(DISTINCT tenant_id)'))return [[{count:2}],[]];
    return [[],[]];
  }};
  const result=await recovery.recover(db);
  assert.equal(committed,true);assert.equal(result.status,'applied');assert.equal(result.profileRows,2);assert.equal(result.checksum,migration.checksum);
  assert.ok(calls.some(call=>call.sql===migration.statements[2]));
  assert.deepEqual(calls.at(-2).params,[migration.checksum,'applied',3,recovery.MIGRATION]);
});

test('the active business logo survives sidebar refresh and resets to platform branding without a tenant logo',()=>{
  const root=path.join(__dirname,'..');
  const sidebar=fs.readFileSync(path.join(root,'client/public/training-sidebar.js'),'utf8');
  const appearance=fs.readFileSync(path.join(root,'client/public/tenant-crm-appearance.js'),'utf8');
  assert.match(appearance,/window\.SaleMaxBusinessBrand=\{logoUrl:/);
  assert.match(appearance,/salemax:business-brand-updated/);
  assert.match(sidebar,/window\.SaleMaxBusinessBrand\?\.logoUrl\?window\.SaleMaxBusinessBrand:null/);
  assert.match(sidebar,/logo\.removeAttribute\('data-seven-network-brand'\)/);
  assert.match(sidebar,/window\.addEventListener\('salemax:business-brand-updated',\s*schedule\)/);
  assert.match(sidebar,/logo\.removeAttribute\('data-sx-business-brand'\)/);
});

test('business-logo deploy patch bumps only the two production shell asset references',()=>{
  const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'sx-business-logo-cache-'));
  try{
    const target=path.join(temp,'index.html');fs.writeFileSync(target,'<script src="/training-sidebar.js?v=20270103-business-profile1"></script><script src="/tenant-crm-appearance.js?v=20270103-business-profile1"></script><script src="/static/js/live-production.js"></script>');
    const result=spawnSync(process.execPath,[path.join(root,'deploy/patch-business-logo-sidebar-cache.cjs'),target],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
    const html=fs.readFileSync(target,'utf8');assert.match(html,/training-sidebar\.js\?v=20270103-business-sidebar-logo1/);assert.match(html,/tenant-crm-appearance\.js\?v=20270103-business-sidebar-logo1/);assert.match(html,/\/static\/js\/live-production\.js/);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
