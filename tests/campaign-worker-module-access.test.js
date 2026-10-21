'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');

async function withWorker(run){
  const state={queries:[],sends:[],campaignStatus:'PENDING',paused:[],logs:[{id:1,campaign_id:'campaign-a',contact_mobile:'+97455550001',status:'PENDING'},{id:2,campaign_id:'campaign-a',contact_mobile:'+97455550002',status:'PENDING'}]};
  const fakeQuery=async(sql,args=[])=>{
    state.queries.push({sql,args});
    if(sql.includes("WHERE status='PAUSED'"))return state.paused.filter(row=>row.id>Number(args[0]||0));
    if(sql.includes("SET status='PAUSED'")){state.campaignStatus='PAUSED';return {affectedRows:1};}
    if(sql.includes("SET status='PENDING'")&&sql.includes("status='PAUSED'")){state.campaignStatus='PENDING';state.paused=state.paused.filter(row=>row.campaign_id!==args[0]);return {affectedRows:1};}
    if(sql.includes("SET status = 'IN_PROGRESS'")){state.campaignStatus='IN_PROGRESS';return {affectedRows:1};}
    if(sql.includes('SELECT * FROM beta_campaign_logs'))return state.logs.filter(row=>row.status==='PENDING');
    if(sql.includes('SELECT * FROM meta_api'))return [{business_phone_number_id:'phone-a',access_token:'synthetic'}];
    if(sql.includes('SELECT * FROM contact'))return [{name:'Synthetic contact'}];
    if(sql.includes("SET status = 'SENT'")){const row=state.logs.find(item=>item.id===args[1]);if(row)row.status='SENT';return [{affectedRows:1}];}
    if(sql.includes("SET status = 'FAILED'")){const row=state.logs.find(item=>item.id===args[1]);if(row)row.status='FAILED';return [{affectedRows:1}];}
    if(sql.includes('SELECT COUNT(*)'))return [{count:0}];
    return {affectedRows:1};
  };
  const fakePool={getConnection:async()=>({query:async()=>[[],[]],release(){}})};
  const stubs={
    '../database/dbpromise':{query:fakeQuery},
    '../database/config':{promise:()=>fakePool},
    '../functions/function':{sendTemplateMessage:async(...args)=>{state.sends.push(args);return {messages:[{id:`meta-${state.sends.length}`}]} ;}},
    '../modules/platform/campaign-module-access':{createCampaignModuleAccess:()=>async()=>({allowed:true})},
  };
  const cacheKeys=[];
  for(const [specifier,exports] of Object.entries(stubs)){const filename=require.resolve(path.join(__dirname,'../loops',specifier));cacheKeys.push(filename);require.cache[filename]={id:filename,filename,loaded:true,exports};}
  const workerPath=require.resolve('../loops/campaignBeta.js');cacheKeys.push(workerPath);delete require.cache[workerPath];
  const worker=require('../loops/campaignBeta.js');
  try{await run(worker,state);}finally{for(const filename of cacheKeys)delete require.cache[filename];}
}
const campaign={campaign_id:'campaign-a',uid:'owner-a',status:'PENDING',phonebook_id:4,body_variables:'[]',header_variable:null,button_variables:'[]',template_name:'approved_template',template_language:'en'};

test('a disabled campaign module prevents a queued campaign from beginning',async()=>{
  await withWorker(async(worker,state)=>{
    const result=await worker.processSingleCampaign(campaign,{canSendCampaign:async()=>({allowed:false,code:'MODULE_DISABLED'})});
    assert.equal(result,undefined);assert.equal(state.campaignStatus,'PAUSED');assert.equal(state.sends.length,0);
    assert.ok(state.queries.some(item=>item.sql.includes("SET status='PAUSED'")));
  });
});

test('worker rechecks access before sending each recipient and persists prior Meta acceptance',async()=>{
  await withWorker(async(worker,state)=>{
    let check=0;await worker.processSingleCampaign(campaign,{messageDelay:0,canSendCampaign:async()=>++check<3?{allowed:true}:{allowed:false,code:'MODULE_DISABLED'}});
    assert.equal(state.sends.length,1);
    assert.equal(state.logs[0].status,'SENT');assert.equal(state.logs[1].status,'PENDING');
    assert.ok(state.queries.some(item=>item.sql.includes("SET status = 'SENT'")&&item.args[1]===1));
    assert.equal(state.campaignStatus,'PAUSED');
  });
});

test('paused campaigns resume in bounded ID batches after module access returns',async()=>{
  await withWorker(async(worker,state)=>{
    state.paused=[{id:20,campaign_id:'paused-a',uid:'owner-a'},{id:21,campaign_id:'paused-b',uid:'owner-a'}];
    await worker.resumeEligiblePausedCampaigns();
    assert.deepEqual(state.paused,[]);assert.equal(state.campaignStatus,'PENDING');
    assert.ok(state.queries.some(item=>item.sql.includes("WHERE status='PAUSED'")&&item.args[0]===0));
  });
});
