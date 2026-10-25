'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mergeSalesProspectFlowState}=require('../modules/platform/chatbot-sales-prospect-state');

test('phonebook name and saved contact name populate prospect state without asking for center name',()=>{
 const result=mergeSalesProspectFlowState({variables:{contactName:'Noura',currentSystemStatus:'No'},leadInfo:{phonebookName:'Bright Future Center'},message:{senderName:'Phonebook label',senderMobile:'+97455160323'},now:1_800_000_000_000});
 assert.equal(result.contactName,'Noura');assert.equal(result.trainingCenterName,'Bright Future Center');assert.equal(result.currentSystemStatus,'no');assert.equal(result.currentSystemName,'Not using a system');
});

test('owner or manager choice uses the saved contact name and current WhatsApp number',()=>{
 const result=mergeSalesProspectFlowState({variables:{contactName:'Noura',decisionMakerChoice:'Yes'},leadInfo:{phonebookName:'Bright Future Center'},message:{senderMobile:'+97455160323'}});
 assert.equal(result.managerContactName,'Noura');assert.equal(result.managerContactNumber,'+97455160323');
});

test('alternate manager path waits for a name and number while same-number choice uses WhatsApp number',()=>{
 const waiting=mergeSalesProspectFlowState({variables:{decisionMakerChoice:'No'},message:{senderMobile:'+97455160323'}});
 assert.equal(waiting.managerContactName,'');assert.equal(waiting.managerContactNumber,'');
 const manager=mergeSalesProspectFlowState({state:waiting,variables:{managerContactName:'Hamad',managerNumberChoice:'Yes'},message:{senderMobile:'+97455160323'}});
 assert.equal(manager.managerContactName,'Hamad');assert.equal(manager.managerContactNumber,'+97455160323');
});

test('demo request schedules one reminder and a reply cancels it',()=>{
 const now=1_800_000_000_000;
 const requested=mergeSalesProspectFlowState({variables:{demoRequested:'Yes'},message:{senderMobile:'+97455160323'},now});
 assert.equal(Date.parse(requested.demoReminderDueAt),now+30*60*1000);
 const watched=mergeSalesProspectFlowState({state:requested,variables:{demoWatched:'Yes'},message:{senderMobile:'+97455160323'},now:now+60_000});
 assert.equal(watched.demoWatched,true);assert.equal(watched.demoReminderDueAt,null);assert.equal(watched.step,'followup_options');
});
