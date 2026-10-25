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

test('7Network Sales prospect bot captures inbound prospects only with the explicit workflow and CRM entitlement',async()=>{
 const pipeline=require('../helper/pipeline/leadPipeline');const original=pipeline.captureBotInbound;const calls=[];
 pipeline.captureBotInbound=async input=>{calls.push(input);return {leadId:'sales-lead-1',created:true};};
 try{
  const ctx={audience:'tenant',tenant:{id:'sales-tenant',status:'active',categoryKey:'7network_sales',categoryVersion:1},
   membership:{id:'member',tenantId:'sales-tenant',role:'owner',status:'active'},identity:{id:'identity',status:'active'},category:categories.salemaxSales,
   subscription:{status:'active',categoryKey:'7network_sales',categoryVersion:1,capabilities:['crm.leads']}};
  const profile={config:{salesWorkflow:'training_center_prospects'}};
  const message={senderMobile:'+97450000002',senderName:'Training Center',metaChatId:'wamid.sales.1',timestamp:1700000000};
  const result=await capture.captureSalesProspectLead({}, {ctx,profile,uid:'sales-owner',chatId:'chat-sales',origin:'meta',message});
  assert.deepEqual(result,{leadId:'sales-lead-1',uidHash:null,duplicate:false,phonebookName:''});
  assert.equal(calls.length,1);assert.equal(calls[0].uid,'sales-owner');assert.equal(calls[0].origin,'meta');assert.equal(calls[0].providerMessageId,'wamid.sales.1');
  assert.equal(await capture.captureSalesProspectLead({}, {ctx,profile:{config:{}},uid:'sales-owner',chatId:'chat-sales',origin:'meta',message}),null);
  assert.equal(await capture.captureSalesProspectLead({}, {ctx:{...ctx,subscription:{...ctx.subscription,capabilities:[]}},profile,uid:'sales-owner',chatId:'chat-sales',origin:'meta',message:{...message,metaChatId:'wamid.sales.2'} }),null);
  assert.equal(calls.length,1);
 } finally { pipeline.captureBotInbound=original; }
});

test('training-center prospect qualification and contact name are stored on the tenant lead without PII in activity logs',async()=>{
 const calls=[];const db={query:async(sql,params)=>{calls.push({sql,params});if(sql.startsWith('SELECT contact_id'))return [[{contactId:'contact-1',contactName:'Phonebook Contact',data:{source:'whatsapp'}}],[]];return [{affectedRows:1},[]];}};
 const changed=await capture.persistSalesProspectQualification(db,{leadInfo:{leadId:'lead-1',uidHash:'hash-1'},uid:'owner-1',profileId:'bot-1',state:{contactName:'Noura',trainingCenterName:'Atlas Center',currentSystemStatus:'yes',currentSystemName:'Old CRM',managerContactName:'Mariam Ali',managerContactNumber:'+97455111111',demoRequested:true}});
 assert.deepEqual(changed,['contactName','trainingCenterName','currentSystemStatus','currentSystemName','managerContactName','managerContactNumber','demoRequested','pricePresented']);
 const update=JSON.parse(calls.find(call=>call.sql.startsWith('UPDATE pipeline_leads')).params[0]);
 assert.equal(update.sevenNetworkSalesProspect.contactName,'Noura');assert.equal(update.sevenNetworkSalesProspect.trainingCenterName,'Atlas Center');assert.equal(update.sevenNetworkSalesProspect.managerContactNumber,'+97455111111');
 assert.equal(calls.find(call=>call.sql.startsWith('UPDATE pipeline_contacts')).params[0],'Noura');
 const activity=JSON.parse(calls.find(call=>call.sql.includes('INSERT INTO pipeline_activity')).params[2]);
 assert.ok(activity.fields.includes('managerContactName'));assert.ok(activity.fields.includes('contactName'));assert.equal(JSON.stringify(activity).includes('Noura'),false);assert.equal(JSON.stringify(activity).includes('Mariam'),false);assert.equal(JSON.stringify(activity).includes('+974'),false);
});
