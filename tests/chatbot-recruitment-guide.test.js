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
  assert.match(result.reply,/company owner and software developer/);
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
