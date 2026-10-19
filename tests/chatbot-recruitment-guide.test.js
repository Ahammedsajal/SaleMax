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
  assert.match(result.reply,/You would work directly with the company owner, who is also the software developer/);
  assert.doesNotMatch(result.reply,/You are speaking directly with the company owner/);
  assert.equal(result.buttons.length,3);
  assert.deepEqual(result.buttons.map(button=>button.id),['about_talab','about_salemax','about_role']);
});

test('role and commission replies state qualification and payment terms accurately',()=>{
  const role=recruitmentReply({message:'about_role',state:{step:'welcome'},facts:{}});
  assert.match(role.reply,/We provide the leads/);
  assert.match(role.reply,/Professional English is required; Hindi is helpful but optional/);
  assert.ok(role.buttons.length<=3);
  const commission=recruitmentReply({message:'commission_details',state:{step:'role'},facts:{}});
  assert.match(commission.reply,/15%/);
  assert.match(commission.reply,/QAR 2,500/);
  assert.match(commission.reply,/QAR 375/);
  assert.match(commission.reply,/not guaranteed/);
  assert.ok(commission.buttons.length<=3);
});

test('apply action returns secure form URL and retains only guided state',()=>{
  const result=recruitmentReply({message:'apply_now',state:{step:'role'},facts:[{kind:'recruitment_application',url:'https://crm.salemax.qa/careers/salemax-sales?source=whatsapp'}]});
  assert.match(result.reply,/https:\/\/crm\.salemax\.qa\/careers\/salemax-sales/);
  assert.equal(result.buttons.length,2);
  assert.equal(result.state.step,'apply');
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
