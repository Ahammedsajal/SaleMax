'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {trainingCenterProspectReply,OFFER}=require('../modules/platform/chatbot-sales-prospect-guide');

test('starts with a phonebook-name confirmation or asks for the center name',()=>{
 const known=trainingCenterProspectReply({message:'Hello',phonebookName:'North Star Training'});
 assert.match(known.reply,/North Star Training/);assert.deepEqual(known.buttons.map(x=>x.title),['Yes, correct','I’ll type it']);
 const confirmed=trainingCenterProspectReply({message:'Yes, correct',state:known.state});
 assert.equal(confirmed.state.trainingCenterName,'North Star Training');assert.equal(confirmed.state.step,'system_status');
 const unknown=trainingCenterProspectReply({message:'Hello'});
 assert.equal(unknown.state.step,'center_name');assert.match(unknown.reply,/training center’s name/);
});

test('captures center, existing system and manager details through bounded next actions',()=>{
 let r=trainingCenterProspectReply({message:'Atlas Training',state:{step:'center_name',whatsappNumber:'+97455000000'}});
 assert.equal(r.state.trainingCenterName,'Atlas Training');assert.deepEqual(r.buttons.map(x=>x.title),['Yes','No','Not sure']);
 r=trainingCenterProspectReply({message:'Yes',state:r.state});assert.equal(r.state.step,'system_name');
 r=trainingCenterProspectReply({message:'Legacy CRM',state:r.state});assert.equal(r.state.currentSystemName,'Legacy CRM');assert.equal(r.state.step,'manager_name');
 r=trainingCenterProspectReply({message:'Mariam Ali',state:r.state});assert.match(r.reply,/contact the manager on this WhatsApp number/);assert.deepEqual(r.buttons.map(x=>x.title),['Yes, same number','Use another']);
 r=trainingCenterProspectReply({message:'Yes, same number',state:r.state});assert.equal(r.state.managerContactName,'Mariam Ali');assert.equal(r.state.managerContactNumber,'+97455000000');assert.equal(r.notifySales,true);
});

test('manager alternate number is validated and details trigger one lead notification',()=>{
 const choice=trainingCenterProspectReply({message:'Use another',state:{step:'manager_number_choice',managerContactName:'Mariam',whatsappNumber:'+97455000000'}});
 assert.equal(choice.state.step,'manager_number');
 assert.equal(trainingCenterProspectReply({message:'123',state:choice.state}).state.step,'manager_number');
 const saved=trainingCenterProspectReply({message:'+97455111111',state:choice.state});
 assert.equal(saved.state.managerContactNumber,'+97455111111');assert.equal(saved.notifySales,true);
 const later=trainingCenterProspectReply({message:'Yes, send it',state:saved.state});assert.equal(later.notifySales,undefined);
});

test('demo yes sends the video and sets a half-hour reminder; customer reply completes the lead',()=>{
 const now=Date.now();
 const result=trainingCenterProspectReply({message:'Yes, send it',state:{step:'demo_offer',trainingCenterName:'Atlas',managerContactName:'Mariam',managerContactNumber:'+97455111111',leadComplete:true,leadAlertQueued:true}});
 assert.equal(result.scheduleDemoReminder,true);assert.match(result.reply,/https:\/\/crm\.salemax\.qa\/training-center-demo\.mp4/);assert.ok(result.buttons.some(x=>x.title==='I watched'));assert.equal(Date.parse(result.state.demoReminderDueAt)-Date.parse(result.state.demoSentAt),30*60*1000);assert.ok(Date.parse(result.state.demoSentAt)>=now);
 const seen=trainingCenterProspectReply({message:'Yes',state:result.state});assert.equal(seen.state.demoReminderDueAt,null);assert.equal(seen.state.demoWatched,true);assert.ok(seen.buttons.some(x=>x.id==='know_price'));
 const price=trainingCenterProspectReply({message:'Know the price',state:seen.state});
 assert.match(price.reply,/QAR 2,500 per year/);assert.match(price.reply,/1 admin user, 1 manager user, 7 agent users/);assert.equal(OFFER.amount,2500);
});

test('no demo and reminder no both offer team follow-up without confirming a booking',()=>{
 const declined=trainingCenterProspectReply({message:'Not now',state:{step:'demo_offer',trainingCenterName:'Atlas',managerContactName:'Mariam',leadComplete:true,leadAlertQueued:true}});
 assert.equal(declined.state.demoDeclined,true);assert.ok(declined.buttons.some(x=>x.id==='know_price'));
 const reminder=trainingCenterProspectReply({message:'Not yet',state:{step:'demo_followup',demoReminderDueAt:'2030-01-01T00:00:00.000Z',leadComplete:true}});
 assert.equal(reminder.state.demoReminderDueAt,null);assert.match(reminder.reply,/passed your contact/);
});
