'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const notifications=require('../modules/platform/recruitment-founder-notifications');
const env={SALEMAX_RECRUITMENT_FOUNDER_PHONE:'+97455160323',CRM_INTERNAL_SECRET:'x'.repeat(32)};
const payload={whatsappNumber:'+919876543210',answers:{fullName:'Asha Candidate',whatsappNumber:'+919876543210',contactNumber:'+919876543210',email:'asha@example.in',currentlyWorking:'yes',totalExperienceRange:'3+',salesExperienceYears:'1-2',hasComputerAndInternet:'yes',comfortableWithSalesCalls:'yes',englishLevel:'proficient',hindiLevel:'none',availability:'full_time'}};

test('configuration requires Founder destination, template, QR secret and trusted internal origin',()=>{
 assert.deepEqual(notifications.config(env),{phone:'+97455160323',template:'salemax_candidate_founder_alert',language:'en',version:'v17.0',qrOrigin:'http://app:3010'});
 assert.throws(()=>notifications.config({...env,SALEMAX_RECRUITMENT_FOUNDER_PHONE:'+919876543210'}),{code:'RECRUITMENT_FOUNDER_PHONE_NOT_CONFIGURED'});
 assert.throws(()=>notifications.config({...env,SALEMAX_RECRUITMENT_QR_INTERNAL_ORIGIN:'https://evil.example'}),{code:'RECRUITMENT_QR_ORIGIN_INVALID'});
 assert.throws(()=>notifications.config({...env,CRM_INTERNAL_SECRET:''}),{code:'RECRUITMENT_QR_SECRET_NOT_CONFIGURED'});
});

test('Meta template and QR self-chat contain the same complete screening details',async()=>{
 const requests=[];const db={async query(sql){if(/meta_api/.test(sql))return [[{uid:'owner',phoneId:'meta-sender',access_token:'secret'}]];if(/SELECT u\.uid/.test(sql))return [[{uid:'owner'}]];if(/FROM instance/.test(sql))return [[{uniqueId:'qr-instance'}]];throw Error('unexpected query');}};
 const item={tenantId:'tenant',payload};
 const result=await notifications.send(db,item,{env,http:async(url,options)=>{requests.push({url,options});return url.includes('graph.facebook.com')?{ok:true,status:200,json:async()=>({messages:[{id:'wamid.meta'}]})}:{ok:true,status:200,json:async()=>({success:true,data:{messageId:'qr-msg'}})};}});
 assert.equal(result.accepted,true);assert.equal(result.channels.meta.messageId,'wamid.meta');assert.equal(result.channels.qr.messageId,'qr-msg');
 const meta=JSON.parse(requests.find(x=>x.url.includes('graph.facebook.com')).options.body);
 assert.equal(meta.template.name,'salemax_candidate_founder_alert');assert.equal(meta.template.components[0].parameters.length,12);
 const qr=requests.find(x=>x.url.includes('/api/internal/qr/send-text'));
 assert.equal(qr.url,'http://app:3010/api/internal/qr/send-text');assert.equal(qr.options.headers['x-internal-secret'],env.CRM_INTERNAL_SECRET);
 const qrBody=JSON.parse(qr.options.body);assert.equal(qrBody.from,'97455160323');assert.equal(qrBody.to,'97455160323');
 for(const value of ['Asha Candidate','+919876543210','asha@example.in','Currently working: Yes','Total experience: 3 or more years','Sales experience: 1–2 years','Computer and reliable internet: Yes','English: Professional','Hindi: None','Availability: Full-time'])assert.ok(qrBody.text.includes(value),`missing ${value}`);
 assert.equal(notifications.params(payload).length,12);
});

test('successful channel is retained when the other route fails and retried without duplicate delivery',async()=>{
 const calls=[];const db={async query(sql,params){calls.push({sql,params});if(/meta_api/.test(sql))return [[{uid:'owner',phoneId:'sender',access_token:'secret'}]];if(/SELECT u\.uid/.test(sql))return [[{uid:'owner'}]];if(/FROM instance/.test(sql))return [[{uniqueId:'instance'}]];return [{affectedRows:1}];}};
 const item={tenantId:'tenant',id:'n1',attempt:1,payload,deliveryResults:{}};let qrCalls=0;
 const partial=await notifications.send(db,item,{env,http:async(url)=>{if(url.includes('graph.facebook.com'))return {ok:true,status:200,json:async()=>({messages:[{id:'meta-ok'}]})};qrCalls++;return {ok:false,status:503,json:async()=>({})};}});
 assert.equal(partial.accepted,false);assert.equal(partial.channels.meta.accepted,true);assert.equal(partial.channels.qr.accepted,false);
 await notifications.finish(db,item,{workerId:'w1',result:partial});const persisted=JSON.parse(calls.at(-1).params[2]);
 const retry={...item,attempt:2,deliveryResults:persisted};const retryResult=await notifications.send(db,retry,{env,http:async(url)=>{assert.ok(url.includes('/api/internal/qr/send-text'));qrCalls++;return {ok:true,status:200,json:async()=>({success:true,data:{messageId:'qr-ok'}})};}});
 assert.equal(qrCalls,2);assert.equal(retryResult.channels.meta.messageId,'meta-ok');assert.equal(retryResult.accepted,true);
 await notifications.finish(db,retry,{workerId:'w1',result:retryResult});assert.match(calls.at(-1).sql,/delivery_results=\?,payload=NULL/);
});

test('enqueue remains idempotent on the inbound WhatsApp message id',async()=>{
 const calls=[];const db={async query(sql,params){calls.push({sql,params});return [{affectedRows:calls.length===1?1:0}];}};
 const input={tenantId:'tenant',profileId:'profile',channelKind:'whatsapp_meta',channelRef:'meta-phone-id',conversationId:'chat',inboundMessageId:'wamid.1',payload};
 assert.equal((await notifications.enqueue(db,input)).queued,true);assert.equal((await notifications.enqueue(db,input)).queued,false);assert.match(calls[0].sql,/INSERT IGNORE/);
});

test('completed applications queue one deduplicated alert with the CV reference and saved screening answers',async()=>{
 const calls=[];const db={async query(sql,params){calls.push({sql,params});if(/SELECT id FROM sx_chatbot_profiles/.test(sql))return [[{id:'profile-1'}]];if(/FROM sx_recruitment_screenings/.test(sql))return [[{answers:JSON.stringify({currentlyWorking:'yes',salesExperienceYears:'3+',hasComputerAndInternet:'yes',comfortableWithSalesCalls:'yes'})}]];return [{affectedRows:1}];}};
 const result=await notifications.enqueueApplication(db,{tenantId:'tenant-1',application:{id:'application-1',referenceCode:'SMX-12345678',fullName:'Asha Candidate',mobile:'+919876543210',normalizedMobile:'+919876543210',email:'asha@example.in',englishLevel:'proficient',hindiLevel:'none',experienceYears:4,crmSaasExperience:'Four years in SaaS sales',availability:'full_time',cvFileName:'asha.pdf'}});
 assert.equal(result.queued,true);assert.match(calls.at(-1).sql,/INSERT IGNORE/);
 const queued=JSON.parse(calls.at(-1).params[7]);assert.equal(queued.answers.currentlyWorking,'yes');assert.equal(queued.answers.salesExperienceYears,'3+');assert.equal(queued.answers.referenceCode,'SMX-12345678');assert.equal(queued.answers.cvFileName,'asha.pdf');
 const qr=notifications.textPayload(queued);assert.match(qr,/Four years in SaaS sales/);assert.match(qr,/SMX-12345678/);assert.match(qr,/asha\.pdf/);
});
