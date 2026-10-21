'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const categories=require('../modules/platform/categories');
const {createLegacyModuleAccess}=require('../modules/platform/legacy-module-access');
const {createInboxModuleAccess,withInboxModuleAccess}=require('../modules/platform/inbox-module-access');
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
function templateGuard(resolveContext){return createLegacyModuleAccess({pool,capability:'messaging.templates',permission:'templates.manage',resolveContext});}
function assistantGuard(resolveContext){return createLegacyModuleAccess({pool,capability:'messaging.inbox',permission:'conversations.reply',resolveContext});}
function inboxGuard(resolveContext){return createInboxModuleAccess({pool,resolveContext});}

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

test('shared templates are independently gated by category, plan and tenant activation',async()=>{
  const allowed=await run(templateGuard(async()=>context(categories.baseCrm)),{decode:{userData:{id:1,uid:'owner-a',role:'user'}}});
  assert.equal(allowed.status,undefined);
  const modules=categories.baseCrm.modules.map(moduleKey).filter(key=>key!=='core.templates@1');
  const disabled=await run(templateGuard(async()=>context(categories.baseCrm,modules)),{decode:{userData:{id:1,uid:'owner-a',role:'user'}}});
  assert.equal(disabled.status,403);assert.equal(disabled.body.code,'MODULE_DISABLED');
  const unsupported=await run(templateGuard(async()=>context(categories.restaurantFixture)),{decode:{userData:{id:1,uid:'owner-a',role:'user'}}});
  assert.equal(unsupported.status,403);assert.equal(unsupported.body.code,'CATEGORY_UNAVAILABLE');
});

test('shared AI assistant is available only when the tenant has the shared Inbox module and entitlement',async()=>{
  const allowed=await run(assistantGuard(async()=>context(categories.baseCrm)),{decode:{userData:{id:1,uid:'owner-a',role:'user'}}});
  assert.equal(allowed.status,undefined);
  const noEntitlement=context(categories.baseCrm);noEntitlement.subscription.capabilities=[];
  const denied=await run(assistantGuard(async()=>noEntitlement),{decode:{userData:{id:1,uid:'owner-a',role:'user'}}});
  assert.equal(denied.status,403);assert.equal(denied.body.code,'FEATURE_UNAVAILABLE');
});

test('legacy Inbox reads and sends require the corresponding permission and shared module',async()=>{
  const resolve=async()=>context(categories.baseCrm);
  const readReq={baseUrl:'/api/inbox',path:'/get_chats',method:'GET',decode:{userData:{id:1,uid:'owner-a',role:'user'}}};
  const read=await run(inboxGuard(resolve),readReq);
  assert.equal(read.error,undefined);assert.equal(readReq.inboxModuleContextPermission,'conversations.read');
  const sendReq={baseUrl:'/api/inbox',path:'/send_text',method:'POST',decode:{userData:{id:1,uid:'owner-a',role:'user'}}};
  const send=await run(inboxGuard(resolve),sendReq);
  assert.equal(send.error,undefined);assert.equal(sendReq.inboxModuleContextPermission,'conversations.reply');
  const conversationReq={baseUrl:'/api/inbox',path:'/get_convo',method:'POST',decode:{userData:{id:1,uid:'owner-a',role:'user'}}};
  const conversation=await run(inboxGuard(resolve),conversationReq);
  assert.equal(conversation.error,undefined);assert.equal(conversationReq.inboxModuleContextPermission,'conversations.read');
  const disabled=context(categories.baseCrm,categories.baseCrm.modules.map(moduleKey).filter(key=>key!=='core.inbox@1'));
  const denied=await run(inboxGuard(async()=>disabled),{baseUrl:'/api/inbox',path:'/send_text',method:'POST',decode:{userData:{id:1,uid:'owner-a',role:'user'}}});
  assert.equal(denied.status,403);assert.equal(denied.body.code,'MODULE_DISABLED');
  const noInboxCategory={...categories.baseCrm,key:'no_inbox_fixture',capabilities:categories.baseCrm.capabilities.filter(key=>key!=='messaging.inbox'),modules:categories.baseCrm.modules.filter(ref=>moduleKey(ref)!=='core.inbox@1')};
  const unsupported=await run(inboxGuard(async()=>context(noInboxCategory)),{baseUrl:'/api/inbox',path:'/get_chats',method:'GET',decode:{userData:{id:1,uid:'owner-a',role:'user'}}});
  assert.equal(unsupported.status,403);assert.equal(unsupported.body.code,'CATEGORY_UNAVAILABLE');
  const otherTenant=await run(inboxGuard(async()=>context(categories.baseCrm)),{baseUrl:'/api/inbox',path:'/get_chats',method:'GET',decode:{userData:{id:2,uid:'owner-b',role:'user'}}});
  assert.equal(otherTenant.error,undefined,'another tenant keeps its own enabled Inbox setting');
  const noPlan=context(categories.baseCrm);noPlan.subscription.capabilities=[];
  const planDenied=await run(inboxGuard(async()=>noPlan),{baseUrl:'/api/inbox',path:'/get_chats',method:'GET',decode:{userData:{id:1,uid:'owner-a',role:'user'}}});
  assert.equal(planDenied.status,403);assert.equal(planDenied.body.code,'FEATURE_UNAVAILABLE');
  const unmapped=await run(inboxGuard(async()=>null),{baseUrl:'/api/inbox',path:'/get_chats',method:'GET',decode:{userData:{id:1,uid:'historic-a',role:'user'}}});
  assert.equal(unmapped.error,undefined);
  const unknownRoute=await run(inboxGuard(resolve),{baseUrl:'/api/inbox',path:'/not-inventory-reviewed',method:'POST',decode:{userData:{id:1,uid:'owner-a',role:'user'}}});
  assert.equal(unknownRoute.status,403);assert.equal(unknownRoute.body.code,'LEGACY_MODULE_ROUTE_UNMAPPED');
});

test('legacy Inbox policy runs after authentication and before the existing handler',async()=>{
  let authenticated=false,handlerReached=false;
  const authenticate=(_req,_res,next)=>{authenticated=true;next();};
  const guard=withInboxModuleAccess(authenticate,inboxGuard(async()=>context(categories.baseCrm)));
  const req={baseUrl:'/api/inbox',path:'/send_text',method:'POST',decode:{userData:{id:1,uid:'owner-a',role:'user'}}};
  await new Promise(resolve=>guard(req,{status(code){this.code=code;return this;},json(){resolve();}},error=>{assert.equal(error,undefined);handlerReached=true;resolve();}));
  assert.equal(authenticated,true);assert.equal(handlerReached,true);
  let deniedAuthenticated=false,deniedHandlerReached=false;
  const deniedGuard=withInboxModuleAccess((_req,_res,next)=>{deniedAuthenticated=true;next();},inboxGuard(async()=>context(categories.baseCrm,categories.baseCrm.modules.map(moduleKey).filter(key=>key!=='core.inbox@1'))));
  const denied=await new Promise(resolve=>deniedGuard({...req,path:'/get_chats',method:'GET'},{status(code){return {json:body=>resolve({status:code,body})};},json:body=>resolve({status:200,body})},()=>{deniedHandlerReached=true;resolve({next:true});}));
  assert.equal(denied.status,403);assert.equal(denied.body.code,'MODULE_DISABLED');
  assert.equal(deniedAuthenticated,true);assert.equal(deniedHandlerReached,false);
});
