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
  assert.match(result.reply,/Sales Manager, who will guide your day-to-day sales activities/);
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
});

test('WhatsApp apply button returns secure form URL and upload instructions',()=>{
  const result=recruitmentReply({message:'Apply & Upload CV',state:{step:'role'},facts:[{kind:'recruitment_application',url:'https://crm.salemax.qa/careers/salemax-sales?source=whatsapp'}]});
  assert.match(result.reply,/https:\/\/crm\.salemax\.qa\/careers\/salemax-sales/);
  assert.match(result.reply,/PDF or DOCX files up to 8 MB/);
  assert.match(result.reply,/Applications & CVs/);
  assert.equal(result.buttons.length,2);
  assert.equal(result.state.step,'apply');
});

test('configured human button labels route to their intended answers',()=>{
  const config={messages:{buttonRole:{en:'About the role'},buttonCommission:{en:'Pay & Commission'},buttonApply:{en:'Apply & Upload CV'}}};
  const role=recruitmentReply({message:'About the role',state:{step:'welcome'},facts:{},config});
  const commission=recruitmentReply({message:'Pay & Commission',state:role.state,facts:{},config});
  const apply=recruitmentReply({message:'Apply & Upload CV',state:commission.state,facts:[{kind:'recruitment_application',url:'https://crm.salemax.qa/careers/salemax-sales?source=whatsapp'}],config});
  assert.equal(role.state.step,'role');
  assert.equal(commission.state.step,'commission');
  assert.equal(apply.state.step,'apply');
  assert.match(commission.reply,/QAR 375 per sale/);
  assert.match(apply.reply,/https:\/\/crm\.salemax\.qa\/careers\/salemax-sales/);
});

test('button screening saves location, language, sales background and availability in guided state',()=>{
  let result=recruitmentReply({message:'start_screening',state:{step:'role'},facts:{}});
  assert.equal(result.state.step,'screen_consent');assert.equal(result.buttons.length,2);
  assert.match(result.reply,/may we save your answers/);
  result=recruitmentReply({message:'screen_consent_yes',state:result.state,facts:{}});
  assert.equal(result.state.screeningConsent,true);assert.equal(result.state.step,'screen_location');
  result=recruitmentReply({message:'screen_india_no',state:result.state,facts:{}});
  assert.equal(result.state.answers.location,'elsewhere');assert.equal(result.state.step,'screen_english');
  result=recruitmentReply({message:'screen_english_professional',state:result.state,facts:{}});
  assert.equal(result.state.answers.englishLevel,'proficient');assert.equal(result.state.step,'screen_hindi');
  result=recruitmentReply({message:'screen_hindi_none',state:result.state,facts:{}});
  assert.equal(result.state.answers.hindiLevel,'none');assert.equal(result.state.step,'screen_experience');
  result=recruitmentReply({message:'screen_exp_saas',state:result.state,facts:{}});
  assert.equal(result.state.answers.salesExperience,'saas_crm_it');assert.equal(result.state.step,'screen_availability');
  result=recruitmentReply({message:'screen_availability_full',state:result.state,facts:{}});
  assert.equal(result.state.step,'screen_complete');
  assert.deepEqual(result.state.answers,{location:'elsewhere',englishLevel:'proficient',hindiLevel:'none',salesExperience:'saas_crm_it',availability:'full_time'});
  assert.match(result.reply,/saved in the private recruitment review area/);
  assert.equal(result.buttons[0].id,'apply_now');
});

test('declining screening consent leaves answers empty and offers the application form',()=>{
  let result=recruitmentReply({message:'start_screening',state:{step:'role'},facts:{}});
  result=recruitmentReply({message:'screen_consent_no',state:result.state,facts:{}});
  assert.equal(result.state.screeningConsent,false);
  assert.deepEqual(result.state.answers,{});
  assert.equal(result.state.step,'screening_declined');
  assert.ok(result.buttons.some(button=>button.id==='apply_now'));
});
