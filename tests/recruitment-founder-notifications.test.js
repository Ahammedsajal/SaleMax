'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const notifications=require('../modules/platform/recruitment-founder-notifications');

test('notification configuration requires the authorized Qatar destination and template',()=>{
  assert.deepEqual(notifications.config({SALEMAX_RECRUITMENT_FOUNDER_PHONE:'+97455160323'}),{phone:'+97455160323',template:'salemax_candidate_founder_alert',language:'en',version:'v17.0'});
  assert.throws(()=>notifications.config({SALEMAX_RECRUITMENT_FOUNDER_PHONE:'+919876543210'}),{code:'RECRUITMENT_FOUNDER_PHONE_NOT_CONFIGURED'});
  assert.throws(()=>notifications.config({SALEMAX_RECRUITMENT_FOUNDER_PHONE:'+97455160323',SALEMAX_RECRUITMENT_FOUNDER_TEMPLATE:'bad template'}),{code:'RECRUITMENT_FOUNDER_TEMPLATE_CONFIG_INVALID'});
});

test('template parameters include every collected applicant detail in order',()=>{
  const result=notifications.params({whatsappNumber:'+919876543210',answers:{fullName:'Asha Candidate',whatsappNumber:'+919876543210',contactNumber:'+919876543210',email:'asha@example.in',currentlyWorking:'yes',totalExperienceRange:'3+',salesExperienceYears:'1-2',hasComputerAndInternet:'yes',comfortableWithSalesCalls:'yes',englishLevel:'proficient',hindiLevel:'none',availability:'full_time'}});
  assert.deepEqual(result.map(x=>x.text),['Asha Candidate','+919876543210','+919876543210','asha@example.in','Yes','3 or more years','1–2 years','Yes','Yes','Professional','None','Full-time']);
  assert.equal(notifications.params({answers:{}}).length,12);
});

test('enqueue is idempotent on the inbound WhatsApp message id',async()=>{
  const calls=[];const db={async query(sql,params){calls.push({sql,params});return [{affectedRows:calls.length===1?1:0}];}};
  const input={tenantId:'tenant',profileId:'profile',channelKind:'whatsapp_meta',channelRef:'meta-phone-id',conversationId:'chat',inboundMessageId:'wamid.1',payload:{answers:{fullName:'Asha'}}};
  assert.equal((await notifications.enqueue(db,input)).queued,true);
  assert.equal((await notifications.enqueue(db,input)).queued,false);
  assert.match(calls[0].sql,/INSERT IGNORE/);
  assert.equal(JSON.parse(calls[0].params[7]).answers.fullName,'Asha');
});

test('approved WhatsApp template is sent to the configured Founder number without exposing credentials',async()=>{
  const request={};const db={async query(){return [[{uid:'legacy-uid',phoneId:'meta-sender-id',access_token:'do-not-print'}]];}};
  const item={tenantId:'tenant',channelRef:'active-bot-channel',payload:{answers:{fullName:'Asha',whatsappNumber:'+919876543210'}}};
  const result=await notifications.send(db,item,{env:{SALEMAX_RECRUITMENT_FOUNDER_PHONE:'+97455160323'},http:async(url,options)=>{request.url=url;request.options=options;return {ok:true,json:async()=>({messages:[{id:'wamid.accepted'}]})};}});
  assert.deepEqual(result,{accepted:true,messageId:'wamid.accepted'});
  assert.equal(request.url,'https://graph.facebook.com/v17.0/meta-sender-id/messages');
  const body=JSON.parse(request.options.body);
  assert.equal(body.to,'97455160323');
  assert.equal(body.template.name,'salemax_candidate_founder_alert');
  assert.equal(body.template.components[0].parameters.length,12);
  assert.match(request.options.headers.Authorization,/^Bearer /);
});

test('delivery errors are retried and accepted notifications erase queued personal details',async()=>{
  const calls=[];const db={async query(sql,params){calls.push({sql,params});return [{affectedRows:1}];}};
  const item={id:'notification',attempt:1};
  assert.equal(await notifications.finish(db,item,{workerId:'worker-1',result:{accepted:false,errorCode:'META_400'}}),'queued');
  assert.match(calls[0].sql,/status='processing'/);
  assert.equal(calls[0].params[0],'queued');
  await notifications.finish(db,item,{workerId:'worker-1',result:{accepted:true,messageId:'wamid.1'}});
  assert.match(calls[1].sql,/payload=NULL/);
});
