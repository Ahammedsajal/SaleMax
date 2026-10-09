'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getDomainPack } = require('../modules/platform/chatbot-domain-packs');
const pack = getDomainPack('training_center', 1);
const facts = Array.from({ length: 9 }, (_, index) => ({ code: `C${index + 1}`, nameEn: `Program ${index + 1}`, nameAr: `برنامج ${index + 1}`, descriptionEn: 'An approved course overview. '.repeat(50), offer: { priceAmount: '100.00', currency: 'QAR' } }));
facts.push({ kind: 'published_enquiry_form', url: 'https://example.com/enquiry' });
const run = (message, state) => pack.guidedReply({ message, state, facts });
test('custom greetings stay compact and handover preserves short formatted lines',()=>{
  const config={messages:{greeting:{en:'Welcome '.repeat(100)},handoffMessage:{en:'*Admissions handover*\nSent to the manager.\nPlease share name, course and schedule.'}}};
  const menu=pack.guidedReply({message:'hello',facts,config});assert.ok(menu.reply.length<350);
  const handover=pack.guidedReply({message:'agent',facts,config});assert.equal(handover.reply.split('\n').length,3);assert.match(handover.reply,/\*Admissions handover\*/);
});

test('English and Arabic menus, details and recovery replies stay within four lines', () => {
  for (const language of ['en', 'ar']) {
    let state;
    for (const message of [language === 'ar' ? 'مرحبا' : 'hello', '1', '999', '1', 'more', '0', 'unknown', 'form', 'agent']) {
      const result = run(message, state);
      assert.ok(result.reply.split('\n').length <= 4, result.reply);
      assert.ok(result.reply.length < 700, result.reply);
      state = result.state;
    }
  }
});

test('paged lists retain stable course numbers, support both languages and clamp page boundaries', () => {
  let result = run('courses');
  assert.match(result.reply, /1\. Program 1/);
  assert.doesNotMatch(result.reply, /Program 3/);
  result = run('next', result.state);
  assert.match(result.reply, /3\. Program 3/);
  result = run('التالي', result.state);
  assert.match(result.reply, /5\. برنامج 5/);
  result = run('previous', result.state);
  assert.equal(result.state.page, 1);
  const selected = run('3', result.state);
  assert.equal(selected.state.selectedCourseCode, 'C3');
  assert.equal(selected.handoff, undefined);
  for (let i = 0; i < 8; i++) result = run('next', result.state);
  assert.equal(result.state.page, 4);
  assert.match(result.reply, /9\./);
  assert.equal(result.reply.split('\n').length, 3);
});
