'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { getDomainPack } = require('../modules/platform/chatbot-domain-packs');
const pack = getDomainPack('training_center', 1);
const facts = Array.from({ length: 9 }, (_, index) => ({ code: `C${index + 1}`, nameEn: `Program ${index + 1}`, nameAr: `برنامج ${index + 1}`, descriptionEn: 'An approved course overview. '.repeat(50), offer: { priceAmount: '100.00', currency: 'QAR' } }));
facts.push({ kind: 'published_enquiry_form', url: 'https://example.com/enquiry' });
const run = (message, state) => pack.guidedReply({ message, state, facts });
test('custom greetings and handover preserve the complete configured wording',()=>{
  const config={messages:{greeting:{en:'Welcome '.repeat(100)},handoffMessage:{en:'*Admissions handover*\nSent to the manager.\nPlease share name, course and schedule.'}}};
  const menu=pack.guidedReply({message:'hello',facts,config});assert.ok(menu.reply.startsWith(config.messages.greeting.en.trim()));
  const handover=pack.guidedReply({message:'agent',facts,config});assert.equal(handover.reply.split('\n').length,3);assert.match(handover.reply,/\*Admissions handover\*/);
});

test('English and Arabic menus, details and recovery replies stay readable with editable recovery messages', () => {
  for (const language of ['en', 'ar']) {
    let state;
    for (const message of [language === 'ar' ? 'مرحبا' : 'hello', '1', '999', '1', 'more', '0', 'unknown', 'form', 'agent']) {
      const result = run(message, state);
      assert.ok(result.reply.split('\n').length <= 12, result.reply);
      assert.ok(result.reply.length < 700, result.reply);
      state = result.state;
    }
  }
});

test('course lists show every configured course at once and support both languages', () => {
  let result = run('courses');
  assert.match(result.reply, /1\. Program 1/);
  assert.match(result.reply, /9\. Program 9/);
  assert.match(result.reply, /Reply with a course number/);
  assert.ok(result.reply.split('\n').length <= 15, result.reply);
  const selected = run('3', result.state);
  assert.equal(selected.state.selectedCourseCode, 'C3');
  assert.equal(selected.handoff, undefined);

  const arabic = run('الدورات', undefined);
  assert.match(arabic.reply, /1\. برنامج 1/);
  assert.match(arabic.reply, /9\. برنامج 9/);
  assert.match(arabic.reply, /أرسل رقم الدورة/);
});
