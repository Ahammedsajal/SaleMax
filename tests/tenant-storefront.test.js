'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const storefront=require('../modules/platform/tenant-storefront');
const ctx={audience:'tenant',tenant:{id:'tenant-demo'},membership:{tenantId:'tenant-demo',role:'owner',status:'active'},identity:{id:'identity-demo'}};

test('storefront accepts bounded typed content and excludes executable properties',()=>{
  const content=storefront.normalize({headline:'Courses',headlineAr:'الدورات',description:'Learn safely',primaryColor:'#1768D4',sections:[{type:'about',title:'About',body:'A center'},{type:'script',body:'alert(1)'},{type:'about',title:'x'.repeat(150),body:'y'.repeat(1500)}],script:'alert(1)',html:'<script>alert(1)</script>'});
  assert.equal(content.version,1);assert.equal(content.primaryColor,'#1768d4');assert.equal(content.sections.length,2);assert.equal(content.sections[1].title.length,100);assert.equal(content.sections[1].body.length,1000);assert.equal(Object.hasOwn(content,'script'),false);assert.equal(Object.hasOwn(content,'html'),false);
});

test('storefront rejects malformed colors, contact addresses, and phone numbers',()=>{
  assert.throws(()=>storefront.normalize({primaryColor:'red'}),{code:'INVALID_BRAND_COLOR'});assert.throws(()=>storefront.normalize({contactEmail:'not-an-email'}),{code:'INVALID_EMAIL'});assert.throws(()=>storefront.normalize({whatsappNumber:'555-1234'}),{code:'INVALID_WHATSAPP_NUMBER'});
});

test('storefront reads fail closed unless the tenant has an enabled grant row',async()=>{
  const db={query:async()=>[[null]]};
  const result=await storefront.get(db,ctx);
  assert.deepEqual(result,{enabled:false,draft:null,published:null,revision:0,publishedRevision:null,publishedAt:null,history:[]});
});

test('enabled storefront reports publish readiness only for a healthy primary domain',async()=>{
  const db={query:async(sql)=>sql.includes('SELECT enabled,draft_json')?[[{enabled:1,draft:'{}',published:null,revision:0,publishedRevision:null,publishedAt:null}]]:sql.includes('SELECT revision,published_at')?[[]]:sql.includes('SELECT id FROM sx_tenant_crm_domains')?[[{id:'domain-demo'}]]:(()=>{throw new Error('UNEXPECTED_QUERY')})()};
  const result=await storefront.get(db,ctx);
  assert.equal(result.enabled,true);assert.equal(result.domainReady,true);
});

test('disabled tenant cannot create a draft, publish, or rollback',async()=>{
  const db={beginTransaction:async()=>{},rollback:async()=>{},commit:async()=>{},query:async(sql)=>{if(/SELECT enabled,revision/.test(sql))return [[{enabled:0,revision:0}]];if(/SELECT draft_json/.test(sql))return [[null]];throw new Error('UNEXPECTED_QUERY');}};
  await assert.rejects(()=>storefront.saveDraft(db,ctx,{content:{headline:'Demo'},expectedRevision:0}),{code:'STOREFRONT_DISABLED',status:403});
  await assert.rejects(()=>storefront.publish(db,ctx,{expectedRevision:1}),{code:'STOREFRONT_DISABLED',status:403});
  await assert.rejects(()=>storefront.rollback(db,ctx),{code:'STOREFRONT_DISABLED',status:403});
});

test('public renderer escapes content, forbids scripts, and varies output by host and language',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../modules/web/public-website.js'),'utf8');
  assert.match(source,/replace\(\/\[&<>"'\]\/g/);assert.match(source,/script-src 'none'/);assert.match(source,/Vary","Host, Accept-Language/);
  const storefront=fs.readFileSync(path.join(__dirname,'../modules/platform/tenant-storefront.js'),'utf8');assert.match(storefront,/s\.enabled=1 AND s\.published_json IS NOT NULL/);assert.match(storefront,/d\.tls_ready_at IS NOT NULL/);
});
