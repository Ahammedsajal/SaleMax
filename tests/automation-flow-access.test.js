'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const categories=require('../modules/platform/categories');
const policy=require('../modules/platform/policy');
const {createAutomationFlowAccess}=require('../modules/platform/automation-flow-access');

const moduleKey=ref=>`${ref.id}@${ref.version}`;
function context(category,role='owner',enabledModules=category.modules.map(moduleKey)){
  return {audience:'tenant',tenant:{id:'tenant-a',status:'active',categoryKey:category.key,categoryVersion:category.version},
    membership:{id:'member-a',tenantId:'tenant-a',role,status:'active',customPermissions:role==='agent'?['conversations.reply']:undefined},
    category,subscription:{status:'active',categoryKey:category.key,categoryVersion:category.version,capabilities:[...category.capabilities]},enabledModules};
}
function run(middleware,req={}){
  const result={next:false,status:null,body:null};
  return new Promise(resolve=>middleware(req,{status(code){result.status=code;return this;},json(body){result.body=body;resolve(result);}},error=>{result.error=error;result.next=!error;resolve(result);}));
}
const pool={getConnection(){throw new Error('injected context should not acquire a connection');}};

test('mapped shared CRM owner can use flows when the pinned module and plan allow them',async()=>{
  const guard=createAutomationFlowAccess({pool,resolveContext:async()=>context(categories.baseCrm)});
  const result=await run(guard,{decode:{userData:{id:1,uid:'owner-a',role:'user'}}});
  assert.equal(result.next,true);
});

test('mapped tenant cannot use flows after disabling its optional module',async()=>{
  const enabled=categories.baseCrm.modules.map(moduleKey).filter(key=>key!=='core.automation-flows@1');
  const guard=createAutomationFlowAccess({pool,resolveContext:async()=>context(categories.baseCrm,'owner',enabled)});
  const result=await run(guard,{decode:{userData:{id:1,uid:'owner-a',role:'user'}}});
  assert.equal(result.status,403);assert.deepEqual(result.body,{success:false,code:'MODULE_DISABLED'});
});

test('a category without automation flows is denied even if the user has a legacy flow route',async()=>{
  const guard=createAutomationFlowAccess({pool,resolveContext:async()=>context(categories.restaurantFixture)});
  const result=await run(guard,{decode:{userData:{id:1,uid:'owner-a',role:'user'}}});
  assert.equal(result.status,403);assert.equal(result.body.code,'CATEGORY_UNAVAILABLE');
});

test('agent session controls retain inbox scope but require the category flow module',async()=>{
  const req={decode:{userData:{id:9,uid:'agent-a',role:'agent'}}};
  const guard=createAutomationFlowAccess({pool,resolveContext:async()=>context(categories.baseCrm,'agent')});
  const result=await run(guard,req);
  assert.equal(result.next,true);assert.equal(req.automationFlowContext.tenant.id,'tenant-a');
  const disabled=categories.baseCrm.modules.map(moduleKey).filter(key=>key!=='core.automation-flows@1');
  const denied=await run(createAutomationFlowAccess({pool,resolveContext:async()=>context(categories.baseCrm,'agent',disabled)}),req);
  assert.equal(denied.status,403);assert.equal(denied.body.code,'MODULE_DISABLED');
});

test('unmapped legacy accounts keep their existing route behavior until reviewed adoption',async()=>{
  const guard=createAutomationFlowAccess({pool,resolveContext:async()=>null});
  assert.equal((await run(guard,{decode:{userData:{id:1,uid:'legacy-a',role:'user'}}})).next,true);
});

test('mapped access lookup failures fail closed with a support-safe response',async()=>{
  const guard=createAutomationFlowAccess({pool,resolveContext:async()=>{throw new Error('private database detail');}});
  const result=await run(guard,{decode:{userData:{id:1,uid:'owner-a',role:'user'}}});
  assert.equal(result.status,503);assert.deepEqual(result.body,{success:false,code:'AUTOMATION_FLOW_ACCESS_UNAVAILABLE'});
});
