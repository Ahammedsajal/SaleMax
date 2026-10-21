'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const service=require('../modules/platform/lead-workspace-contract'),{trainingCenter,salemaxSales}=require('../modules/platform/categories');
const entitlement=(category,extra={})=>({status:'active',categoryKey:category.key,categoryVersion:category.version,capabilities:[...category.capabilities],...extra});
test('shared Sales contracts never inherit training controls or workflows',()=>{
 const sales=service.definition(salemaxSales,entitlement(salemaxSales,{capabilities:[...salemaxSales.capabilities,...trainingCenter.capabilities]}));
 assert.equal(sales.profile,'shared');assert.deepEqual(sales.workflows,{courses:false,forms:false,saleReviews:false});
 assert.deepEqual(service.definition(null,null),{version:1,category:null,profile:'shared',workflows:{courses:false,forms:false,saleReviews:false}});
});
test('training workflow visibility requires matching active plan capabilities',()=>{
 const active=service.definition(trainingCenter,entitlement(trainingCenter));assert.equal(active.profile,'training');assert.deepEqual(active.workflows,{courses:true,forms:true,saleReviews:true});
 for(const subscription of [null,entitlement(trainingCenter,{status:'expired'}),entitlement(salemaxSales),entitlement(trainingCenter,{categoryVersion:2})])assert.deepEqual(service.definition(trainingCenter,subscription).workflows,{courses:false,forms:false,saleReviews:false});
 assert.deepEqual(service.definition(trainingCenter,entitlement(trainingCenter,{capabilities:['training.courses']})).workflows,{courses:true,forms:false,saleReviews:false});
});
test('owner-derived lookup isolates tenants and refuses broken ownership/category state',async()=>{
 const saved=process.env.SALEMAX_PLATFORM_ENABLED,plans=require('../modules/platform/plans'),original=plans.loadEntitlements;process.env.SALEMAX_PLATFORM_ENABLED='true';
 const rows=new Map(['a','b'].map((uid,i)=>[uid,{tenant_id:'tenant-'+uid,legacy_uid_hash:crypto.createHash('sha256').update(uid).digest('hex'),tenant_status:'active',category_key:i?'7network_sales':'training_center',category_version:1,owner_role:'owner',membership_status:'active',identity_status:'active'}]));
 const lookups=[];plans.loadEntitlements=async(db,id)=>{lookups.push(id);return entitlement(id==='tenant-a'?trainingCenter:salemaxSales);};
 const db={query:async(sql,args)=>{assert.match(sql,/m.tenant_id=o.tenant_id/);assert.match(sql,/WHERE u.uid=\?/);return [rows.has(args[0])?[rows.get(args[0])]:[]];}};
 try{
  assert.equal((await service.forOwner(db,'a')).profile,'training');assert.equal((await service.forOwner(db,'b')).profile,'shared');assert.deepEqual(lookups,['tenant-a','tenant-b']);
  assert.equal((await service.forOwner(db,'unmapped')).category,null);
  for(const patch of [{legacy_uid_hash:'foreign'},{owner_role:'manager'},{membership_status:'revoked'},{identity_status:'disabled'}]){const old=rows.get('a');rows.set('a',{...old,...patch});await assert.rejects(service.forOwner(db,'a'),{code:'BUSINESS_LINK_INVALID'});rows.set('a',old);}
  rows.get('a').category_version=77;await assert.rejects(service.forOwner(db,'a'),{code:'CATEGORY_UNAVAILABLE'});rows.get('a').category_version=1;
  rows.get('a').tenant_status='suspended';await assert.rejects(service.forOwner(db,'a'),{code:'ACCOUNT_INACTIVE'});
 }finally{plans.loadEntitlements=original;if(saved===undefined)delete process.env.SALEMAX_PLATFORM_ENABLED;else process.env.SALEMAX_PLATFORM_ENABLED=saved;}
});
