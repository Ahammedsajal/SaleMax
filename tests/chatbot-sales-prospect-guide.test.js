'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {trainingCenterProspectReply}=require('../modules/platform/chatbot-sales-prospect-guide');

test('7Network training-center prospect guide answers core product and public plan questions',()=>{
 const intro=trainingCenterProspectReply({message:'Hello'});
 assert.match(intro.reply,/7Network/);assert.equal(intro.state.greeted,true);
 const features=trainingCenterProspectReply({message:'What features do you have?',state:intro.state});
 assert.match(features.reply,/WhatsApp inbox and campaigns/);
 const pricing=trainingCenterProspectReply({message:'What is the price?',state:features.state});
 assert.match(pricing.reply,/QAR 350 for 30 days/);assert.match(pricing.reply,/QAR 3,700 for 365 days/);
 assert.doesNotMatch(pricing.reply,/guarantee|unlimited|free forever/i);
});

test('guide identifies training-center fit, captures only the center name in state and responds bilingually',()=>{
 const result=trainingCenterProspectReply({message:'We are a training center'});
 assert.match(result.reply,/What is your center’s name/);assert.equal(result.state.awaitingCenterName,true);
 const next=trainingCenterProspectReply({message:'Example Training Center',state:result.state});
 assert.match(next.reply,/Example Training Center/);assert.equal(next.state.awaitingCenterName,false);
 const ar=trainingCenterProspectReply({message:'ما أسعار النظام؟'});
 assert.match(ar.reply,/ريالاً قطرياً/);assert.equal(ar.state.language,'ar');
});

test('explicit team request hands off rather than claiming a booking or sale',()=>{
 const result=trainingCenterProspectReply({message:'Talk to sales',state:{greeted:true}});
 assert.equal(result.handoff,true);assert.equal(result.handoffReason,'sales-prospect-requested-human');
 assert.match(result.reply,/hand this conversation to our team/);
});
