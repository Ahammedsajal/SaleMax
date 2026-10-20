'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {recruitmentReply}=require('../modules/platform/chatbot-recruitment-guide');

test('recruitment introduction builds trust before describing the role',()=>{
  const result=recruitmentReply({message:'hello',facts:{}});
  assert.match(result.reply,/Sitta Arbaa Sitta for Software Solutions/);
  assert.match(result.reply,/CR 251489/);
  assert.match(result.reply,/Qatar-based software and marketing company/);
  assert.match(result.reply,/Apple:/);
  assert.match(result.reply,/Google Play:/);
  assert.match(result.reply,/I’m Lucy, SaleMaX’s chatbot/);
  assert.match(result.reply,/crm\.salemax\.qa/);
  assert.match(result.reply,/WhatsApp campaigns and marketing/);
  assert.equal(result.buttons.length,3);
  assert.deepEqual(result.buttons.map(button=>button.id),['about_talab','about_salemax','about_role']);
});

test('role and commission replies state qualification and payment terms accurately',()=>{
  const role=recruitmentReply({message:'about_role',state:{step:'welcome'},facts:{}});
  assert.match(role.reply,/We provide the leads/);
  assert.match(role.reply,/Strong English is required; Hindi is helpful but optional/);
  assert.match(role.reply,/Sales Manager will support you/);
  assert.ok(role.buttons.length<=3);
  const commission=recruitmentReply({message:'Pay & Commission',state:{step:'role'},facts:{}});
  assert.match(commission.reply,/15%/);
  assert.match(commission.reply,/QAR 2,500/);
  assert.match(commission.reply,/QAR 375 per sale/);
  assert.match(commission.reply,/We provide the leads/);
  assert.doesNotMatch(commission.reply,/INR|exchange rate/i);
  assert.match(commission.reply,/depending on performance and mutual agreement/);
  assert.ok(commission.buttons.length<=3);
  assert.deepEqual(role.buttons.map(button=>button.title),['Apply now','Commission details','Talk to recruiter']);
  assert.deepEqual(role.buttons.map(button=>button.id),['start_screening','commission_details','talk_to_recruiter']);
});

test('WhatsApp Apply now starts the questions in chat without sending a web form link',()=>{
  const result=recruitmentReply({message:'Apply now',state:{step:'role'},facts:[{kind:'recruitment_application',url:'https://crm.salemax.qa/careers/salemax-sales?source=whatsapp'}]});
  assert.match(result.reply,/may we save your answers/);
  assert.match(result.reply,/send your CV now or later/);
  assert.doesNotMatch(result.reply,/https:\/\/crm\.salemax\.qa\/careers/);
  assert.equal(result.state.step,'screen_consent');
  assert.deepEqual(result.buttons.map(button=>button.id),['screen_consent_yes','screen_consent_no']);
});
test('configured human button labels route to their intended answers',()=>{
  const config={messages:{buttonRole:{en:'About the role'},buttonCommission:{en:'Pay & Commission'},buttonApply:{en:'Apply & Upload CV'}}};
  const role=recruitmentReply({message:'About the role',state:{step:'welcome'},facts:{},config});
  const commission=recruitmentReply({message:'Pay & Commission',state:role.state,facts:{},config});
  const apply=recruitmentReply({message:'Apply & Upload CV',state:commission.state,facts:[{kind:'recruitment_application',url:'https://crm.salemax.qa/careers/salemax-sales?source=whatsapp'}],config});
  assert.equal(role.state.step,'role');
  assert.equal(commission.state.step,'commission');
  assert.equal(apply.state.step,'screen_consent');
  assert.match(commission.reply,/QAR 375 per sale/);
  assert.match(apply.reply,/may we save your answers/);
});

test('button screening collects the candidate details and required sales setup in order',()=>{
  let result=recruitmentReply({message:'start_screening',state:{step:'role'},facts:{}});
  assert.equal(result.state.step,'screen_consent');assert.equal(result.buttons.length,2);
  assert.match(result.reply,/may we save your answers/);
  result=recruitmentReply({message:'screen_consent_yes',state:result.state,facts:{}});
  assert.equal(result.state.screeningConsent,true);assert.equal(result.state.step,'screen_name');
  result=recruitmentReply({message:'Asha Candidate',state:result.state,facts:{}});assert.equal(result.state.answers.fullName,'Asha Candidate');assert.equal(result.state.step,'screen_working');
  result=recruitmentReply({message:'screen_working_yes',state:result.state,facts:{}});assert.equal(result.state.answers.currentlyWorking,'yes');assert.equal(result.state.step,'screen_phone_same');
  result=recruitmentReply({message:'screen_phone_same_yes',state:{...result.state,answers:{...result.state.answers,whatsappNumber:'+919876543210'}},facts:{}});assert.equal(result.state.answers.contactNumber,'+919876543210');assert.equal(result.state.step,'screen_email');
  result=recruitmentReply({message:'asha@example.in',state:result.state,facts:{}});assert.equal(result.state.answers.email,'asha@example.in');assert.equal(result.state.step,'screen_total_experience');
  result=recruitmentReply({message:'screen_total_3_plus',state:result.state,facts:{}});assert.equal(result.state.answers.totalExperienceRange,'3+');assert.equal(result.state.step,'screen_sales_experience');
  result=recruitmentReply({message:'screen_sales_1_2',state:result.state,facts:{}});assert.equal(result.state.answers.salesExperienceYears,'1-2');assert.equal(result.state.step,'screen_tools');
  result=recruitmentReply({message:'screen_tools_yes',state:result.state,facts:{}});assert.equal(result.state.answers.hasComputerAndInternet,'yes');assert.equal(result.state.step,'screen_calls');
  result=recruitmentReply({message:'screen_calls_yes',state:result.state,facts:{}});assert.equal(result.state.answers.comfortableWithSalesCalls,'yes');assert.equal(result.state.step,'screen_english');
  result=recruitmentReply({message:'screen_english_professional',state:result.state,facts:{}});
  assert.equal(result.state.answers.englishLevel,'proficient');assert.equal(result.state.step,'screen_hindi');
  result=recruitmentReply({message:'screen_hindi_none',state:result.state,facts:{}});
  assert.equal(result.state.answers.hindiLevel,'none');assert.equal(result.state.step,'screen_availability');
  result=recruitmentReply({message:'screen_availability_full',state:result.state,facts:{}});
  assert.equal(result.state.step,'awaiting_cv');
  assert.equal(result.state.answers.fullName,'Asha Candidate');
  assert.equal(result.state.answers.currentlyWorking,'yes');
  assert.equal(result.state.answers.totalExperienceRange,'3+');
  assert.equal(result.state.answers.salesExperienceYears,'1-2');
  assert.match(result.reply,/upload your CV here as a PDF or DOCX/);
  assert.deepEqual(result.buttons.map(b=>b.id),['talk_to_recruiter']);
  assert.equal(result.handoff,true);
  assert.equal(result.handoffReason,'recruitment-awaiting-cv');
});

test('recruiter button confirms notification and offers to continue application questions',()=>{
  const result=recruitmentReply({message:'talk_to_recruiter',state:{step:'role'},facts:{}});
  assert.equal(result.notifyRecruiter,true);
  assert.match(result.reply,/I’ve notified the recruiter/);
  assert.match(result.reply,/continue the application questions/);
  assert.deepEqual(result.buttons.map(button=>button.id),['continue_application','wait_for_recruiter']);
  const next=recruitmentReply({message:'continue_application',state:result.state,facts:{}});
  assert.equal(next.state.step,'screen_name');
  assert.equal(next.state.screeningConsent,true);
  assert.match(next.reply,/What is your full name/);
});

test('declining screening consent leaves answers empty and does not start an application',()=>{
  let result=recruitmentReply({message:'start_screening',state:{step:'role'},facts:{}});
  result=recruitmentReply({message:'screen_consent_no',state:result.state,facts:{}});
  assert.equal(result.state.screeningConsent,false);
  assert.deepEqual(result.state.answers,{});
  assert.equal(result.state.step,'screening_declined');
  assert.ok(!result.buttons.some(button=>button.id==='apply_now'));
});


test('finished recruitment never restarts on obsolete CV or apply buttons',()=>{
  for(const step of ['awaiting_cv','application_saved','application_submitted']){
    for(const message of ['Skip CV','skip_cv','Apply now','hello','thanks']){
      const result=recruitmentReply({message,state:{step,screeningConsent:true,answers:{fullName:'Asha'}},facts:{}});
      assert.equal(result.reply,'');assert.equal(result.state.step,step);assert.deepEqual(result.buttons,[]);assert.equal(result.handoff,true);
    }
  }
  const recruiter=recruitmentReply({message:'Talk to recruiter',state:{step:'awaiting_cv',answers:{fullName:'Asha'}},facts:{}});
  assert.equal(recruiter.notifyRecruiter,true);assert.equal(recruiter.handoff,true);assert.doesNotMatch(recruiter.reply,/preliminary|question|full name/);
});

test('commission menu has one Apply now action',()=>{
  const result=recruitmentReply({message:'Commission details',state:{step:'role'},facts:{}});
  assert.equal(result.buttons.filter(b=>b.title==='Apply now').length,1);
});
