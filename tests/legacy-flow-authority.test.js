'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const runtimeAccessPath=require.resolve('../modules/platform/chatbot-runtime-access');
const authority=require('../modules/platform/legacy-flow-authority');

async function withAccess(state,run){
  const original=require.cache[runtimeAccessPath];
  require.cache[runtimeAccessPath]={id:runtimeAccessPath,filename:runtimeAccessPath,loaded:true,exports:{
    resolveOwnerAccess:async(db,uid,capability)=>{assert.equal(uid,'owner-a');assert.equal(capability,'automation.flows');return state.access;},
    sameBoundary:(prior,current)=>Boolean(prior&&current&&prior.boundaryKey===current.boundaryKey),
  }};
  const db={release(){}};const pool={getConnection:async()=>db};let activeChecks=0;
  const guard=authority.createLegacyFlowNodeGuard({uid:'owner-a',flowId:'flow-a',origin:state.origin||'qr',sessionId:'channel-a',webhook:state.webhook,pool,getActiveFlows:async()=>{activeChecks++;return state.active?[{flow_id:'flow-a'}]:[];},optionalFeatureEnabled:async()=>state.webhookEnabled});
  try{await run({guard,state,getActiveChecks:()=>activeChecks});}
  finally{if(original)require.cache[runtimeAccessPath]=original;else delete require.cache[runtimeAccessPath];}
}

test('unmapped legacy owners keep active shared flows while ownership has not changed',async()=>{
  const state={access:{linked:false,context:null},active:true};
  await withAccess(state,async({guard})=>{assert.equal(await guard(),'allowed');assert.equal(await guard(),'allowed');});
});

test('a linked flow stops when its current category, membership or plan assignment changes',async()=>{
  const state={access:{linked:true,context:{boundaryKey:'category-v1-owner-plan-a'}},active:true};
  await withAccess(state,async({guard})=>{
    assert.equal(await guard(),'allowed');
    state.access={linked:true,context:{boundaryKey:'category-v2-owner-plan-b'}};
    assert.equal(await guard(),false);
  });
});

test('a legacy flow stops when the owner disables it during an active conversation',async()=>{
  const state={access:{linked:false,context:null},active:true};
  await withAccess(state,async({guard})=>{assert.equal(await guard(),'allowed');state.active=false;assert.equal(await guard(),false);});
});

test('webhook automation is stopped when its optional feature is disabled mid-flow',async()=>{
  const state={access:{linked:false,context:null},active:true,origin:'webhook_automation',webhook:{webhook_id:'hook-a'},webhookEnabled:true};
  await withAccess(state,async({guard,getActiveChecks})=>{assert.equal(await guard(),'allowed');assert.equal(getActiveChecks(),1);state.webhookEnabled=false;assert.equal(await guard(),false);assert.equal(getActiveChecks(),1);});
});

test('authority lookup failures stop legacy flow execution before a side effect',async()=>{
  const original=require.cache[runtimeAccessPath];
  require.cache[runtimeAccessPath]={id:runtimeAccessPath,filename:runtimeAccessPath,loaded:true,exports:{resolveOwnerAccess:async()=>{throw Object.assign(Error('private'),{code:'DB_UNAVAILABLE'});},sameBoundary:()=>false}};
  const guard=authority.createLegacyFlowNodeGuard({uid:'owner-a',flowId:'flow-a',origin:'qr',sessionId:'channel-a',pool:{getConnection:async()=>({release(){}})},getActiveFlows:async()=>[{flow_id:'flow-a'}]});
  const prior=console.warn;console.warn=()=>{};
  try{assert.equal(await guard(),false);}finally{console.warn=prior;if(original)require.cache[runtimeAccessPath]=original;else delete require.cache[runtimeAccessPath];}
});
