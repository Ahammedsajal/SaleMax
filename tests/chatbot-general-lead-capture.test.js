'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const categories=require('../modules/platform/categories');
const {botInput}=require('../modules/platform/chatbot-config');
const capture=require('../modules/platform/chatbot-lead-capture');
const enabledContext=()=>({audience:'tenant',tenant:{id:'tenant-a',status:'active',categoryKey:'base_crm',categoryVersion:1},
 membership:{id:'member-a',tenantId:'tenant-a',role:'owner',status:'active'},identity:{id:'identity-a',status:'active'},category:categories.baseCrm,
 subscription:{status:'active',categoryKey:'base_crm',categoryVersion:1,capabilities:['crm.leads']}});

test('chatbot lead capture is an explicit reviewed category contract',()=>{
 assert.equal(categories.baseCrm.chatbotLeadCapture,'generic');
 assert.equal(categories.trainingCenter.chatbotLeadCapture,'training');
 assert.equal(categories.salemaxSales.chatbotLeadCapture,'none');
 assert.equal(categories.getCategory('restaurant_fixture',1).chatbotLeadCapture,'none');
 const futureTrainingCategory=require('../modules/platform/category-registry').createCategoryRegistry(
  [{...categories.trainingCenter,key:'education_demo'}],require('../modules/platform/policy').capabilities
 ).get('education_demo',1);
 assert.equal(capture.usesTrainingLeadCapture({category:futureTrainingCategory}),true,'reuses the declared adapter without a category-name branch');
 assert.equal(capture.usesTrainingLeadCapture({category:categories.baseCrm}),false);
 assert.equal(capture.usesTrainingLeadCapture({category:categories.salemaxSales}),false);
});

test('generic lead capture requires the tenant CRM plan entitlement and owner permission',()=>{
 const ctx={audience:'tenant',tenant:{id:'tenant-a',status:'active',categoryKey:'base_crm',categoryVersion:1},
  membership:{id:'member-a',tenantId:'tenant-a',role:'owner',status:'active'},identity:{id:'identity-a',status:'active'},category:categories.baseCrm,
  subscription:{status:'active',categoryKey:'base_crm',categoryVersion:1,capabilities:['crm.leads']}};
 assert.equal(capture.genericCaptureEnabled(ctx),true);
 assert.equal(capture.genericCaptureEnabled({...ctx,subscription:{...ctx.subscription,capabilities:[]}}),false);
 assert.equal(capture.genericCaptureEnabled({...ctx,category:categories.salemaxSales,tenant:{...ctx.tenant,categoryKey:'salemax_sales'},subscription:{...ctx.subscription,categoryKey:'salemax_sales',capabilities:['crm.leads']}}),false);
});

test('generic CRM lead creation is opt-in and cannot be enabled in training or recruitment bots',()=>{
 const base={name:'Inbox assistant',engine:'guided',config:{}};
 assert.equal(botInput(base,'base_crm').config.captureLeads,undefined);
 assert.equal(botInput({...base,config:{captureLeads:true}},'base_crm').config.captureLeads,true);
 assert.equal(botInput({...base,config:{captureLeads:false}},'base_crm').config.captureLeads,false);
 for(const category of ['training_center','salemax_sales','restaurant_fixture'])
  assert.throws(()=>botInput({...base,config:{captureLeads:true}},category),{code:'BOT_LEAD_CAPTURE_UNAVAILABLE'});
 assert.throws(()=>botInput({...base,config:{captureLeads:'yes'}},'base_crm'),{code:'INVALID_BOT_CONFIG'});
});

test('generic bot capture forwards only inbound lead identity and provider metadata to the tenant pipeline',async()=>{
 const pipeline=require('../helper/pipeline/leadPipeline');
 const original=pipeline.captureBotInbound;const calls=[];
 pipeline.captureBotInbound=async input=>{calls.push(input);return {leadId:'lead-1',created:true};};
 try{
  const ctx=enabledContext();
  const profile={config:{captureLeads:true,allowedRecipientPhones:['97450000001']}};
  const message={route:'INCOMING',senderMobile:'+97450000001',senderName:'Customer',metaChatId:'wamid.1',timestamp:1700000000,msgContext:{text:{body:'Looking for a service'}}};
  const result=await capture.captureGenericLead({}, {ctx,profile,uid:'owner-a',chatId:'chat-a',origin:'meta',message});
  assert.deepEqual(result,{leadId:'lead-1',duplicate:false});
  assert.equal(calls.length,1);
  assert.equal(calls[0].uid,'owner-a');assert.equal(calls[0].origin,'meta');assert.equal(calls[0].chatId,'chat-a');
  assert.equal(calls[0].providerMessageId,'wamid.1');assert.deepEqual(calls[0].pool,{});
  assert.equal(calls[0].botCapture,undefined,'pipeline adapter owns the bot-capture flag');
  assert.equal(await capture.captureGenericLead({}, {ctx,profile:{config:{captureLeads:false}},uid:'owner-a',chatId:'chat-a',origin:'meta',message}),null);
  assert.equal(calls.length,1);
 }finally{pipeline.captureBotInbound=original;}
});

test('generic capture fails closed if the pipeline cannot create the tenant lead',async()=>{
 const pipeline=require('../helper/pipeline/leadPipeline');const original=pipeline.captureBotInbound;
 pipeline.captureBotInbound=async()=>({skipped:true,reason:'capture_disabled'});
 try{await assert.rejects(capture.captureGenericLead({}, {ctx:enabledContext(),profile:{config:{captureLeads:true}},uid:'owner',chatId:'chat',origin:'qr',message:{route:'INCOMING',senderMobile:'+97450000001'}}),{code:'BOT_LEAD_NOT_CAPTURED'});}
 finally{pipeline.captureBotInbound=original;}
});
