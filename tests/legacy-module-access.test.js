'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const categories=require('../modules/platform/categories');
const {createLegacyModuleAccess}=require('../modules/platform/legacy-module-access');
const moduleKey=ref=>`${ref.id}@${ref.version}`;
function context(category,enabledModules=category.modules.map(moduleKey)){
  return {audience:'tenant',tenant:{id:'tenant-a',status:'active',categoryKey:category.key,categoryVersion:category.version},
    membership:{id:'member-a',tenantId:'tenant-a',role:'owner',status:'active'},category,
    subscription:{status:'active',categoryKey:category.key,categoryVersion:category.version,capabilities:[...category.capabilities]},enabledModules};
}
const pool={getConnection(){throw new Error('test context resolver does not use the database');}};
async function run(guard,req={}){
  const out={};await new Promise(resolve=>guard(req,{status(code){out.status=code;return this;},json(body){out.body=body;resolve();}},error=>{out.error=error;resolve();}));return out;
}
function chatbotGuard(resolveContext){return createLegacyModuleAccess({pool,capability:'automation.chatbot',permission:'automation.manage',resolveContext});}

test('legacy chatbot endpoints allow mapped categories with the enabled chatbot module',async()=>{
  const req={decode:{userData:{id:1,uid:'owner-a',role:'user'}}};
  const result=await run(chatbotGuard(async()=>context(categories.baseCrm)),req);
  assert.equal(result.error,undefined);assert.equal(req.legacyModuleContext.tenant.id,'tenant-a');
});

test('legacy chatbot endpoints deny a disabled module without changing tenant data',async()=>{
  const modules=categories.baseCrm.modules.map(moduleKey).filter(key=>key!=='core.chatbot@1');
  const result=await run(chatbotGuard(async()=>context(categories.baseCrm,modules)),{decode:{userData:{id:1,uid:'owner-a',role:'user'}}});
  assert.equal(result.status,403);assert.deepEqual(result.body,{success:false,code:'MODULE_DISABLED'});
});

test('legacy chatbot endpoints deny categories that do not include the chatbot capability',async()=>{
  const result=await run(chatbotGuard(async()=>context(categories.restaurantFixture)),{decode:{userData:{id:1,uid:'owner-a',role:'user'}}});
  assert.equal(result.status,403);assert.equal(result.body.code,'CATEGORY_UNAVAILABLE');
});

test('unmapped legacy users keep existing chatbot behavior until reviewed adoption',async()=>{
  const result=await run(chatbotGuard(async()=>null),{decode:{userData:{id:1,uid:'legacy-a',role:'user'}}});
  assert.equal(result.error,undefined);
});
