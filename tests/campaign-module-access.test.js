'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const categories=require('../modules/platform/categories');
const {resolveCampaignModuleAccess}=require('../modules/platform/campaign-module-access');
const moduleKey=ref=>`${ref.id}@${ref.version}`;
function context(category,enabledModules=category.modules.map(moduleKey)){
  return {audience:'tenant',tenant:{id:'tenant-a',status:'active',categoryKey:category.key,categoryVersion:category.version},
    membership:{id:'member-a',tenantId:'tenant-a',role:'owner',status:'active'},category,
    subscription:{status:'active',categoryKey:category.key,categoryVersion:category.version,capabilities:[...category.capabilities]},enabledModules};
}
function database({ownerRows=[{id:1,uid:'owner-a',role:'user'}],links=[{tenantId:'tenant-a'}]}={}){
  return {async query(sql){if(sql.includes('FROM user'))return [ownerRows];if(sql.includes('FROM sx_legacy_ownership'))return [links];throw Error(`unexpected query ${sql}`);}};
}
test('campaign authority allows a mapped workspace with the active module and plan',async()=>{
  const result=await resolveCampaignModuleAccess(database(), 'owner-a',{resolveContext:async()=>context(categories.baseCrm)});
  assert.equal(result.allowed,true);assert.equal(result.context.tenant.id,'tenant-a');
});
test('campaign authority denies a mapped workspace when its module is disabled',async()=>{
  const enabled=categories.baseCrm.modules.map(moduleKey).filter(key=>key!=='core.campaigns@1');
  const result=await resolveCampaignModuleAccess(database(),'owner-a',{resolveContext:async()=>context(categories.baseCrm,enabled)});
  assert.deepEqual(result,{allowed:false,code:'MODULE_DISABLED'});
});
test('campaign authority denies a category without the campaign capability',async()=>{
  const result=await resolveCampaignModuleAccess(database(),'owner-a',{resolveContext:async()=>context(categories.restaurantFixture)});
  assert.deepEqual(result,{allowed:false,code:'CATEGORY_UNAVAILABLE'});
});
test('unmapped existing owners retain legacy scheduled campaign delivery',async()=>{
  const result=await resolveCampaignModuleAccess(database({links:[]}), 'owner-a',{resolveContext:async()=>{throw Error('must not resolve an unmapped owner');}});
  assert.deepEqual(result,{allowed:true,compatibility:true});
});
test('missing owners, ambiguous links and failed tenant lookup deny outbound sends',async()=>{
  assert.equal((await resolveCampaignModuleAccess(database({ownerRows:[]}), 'owner-a')).allowed,false);
  assert.deepEqual(await resolveCampaignModuleAccess(database({links:[{tenantId:'tenant-a'},{tenantId:'tenant-b'}]}),'owner-a'),{allowed:false,code:'BUSINESS_LINK_INVALID'});
  assert.deepEqual(await resolveCampaignModuleAccess(database(),'owner-a',{resolveContext:async()=>{throw Object.assign(Error('private detail'),{code:'DB_LOOKUP_FAILED'});}}),{allowed:false,code:'DB_LOOKUP_FAILED'});
});
