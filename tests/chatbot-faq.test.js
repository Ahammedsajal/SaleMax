'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findApprovedFaq, validateFaqInput } = require('../modules/platform/chatbot-faq');

const faq = { questionEn:'Do you offer evening classes?',answerEn:'Evening classes are available.',questionAr:'هل تتوفر حصص مسائية؟',answerAr:'تتوفر حصص مسائية.' };

test('FAQ question requires at least two meaningful words and paired question/answer', () => {
  assert.equal(validateFaqInput(faq).questionEn, faq.questionEn);
  assert.throws(() => validateFaqInput({ questionEn:'Evening?', answerEn:'Ask us.' }), { code:'FAQ_QUESTION_NEEDS_TWO_WORDS' });
  assert.throws(() => validateFaqInput({ questionEn:'Evening classes' }), { code:'FAQ_QUESTION_AND_ANSWER_REQUIRED' });
});

test('FAQ matching is bilingual, exact-word, unique-best and business-fee safe', () => {
  assert.equal(findApprovedFaq('evening classes please', [faq], 'en').answer, faq.answerEn);
  assert.equal(findApprovedFaq('حصص مسائية', [faq], 'ar').answer, faq.answerAr);
  assert.equal(findApprovedFaq('evening please', [faq], 'en'), null);
  assert.equal(findApprovedFaq('my classes are not evening?', [faq], 'en').answer, faq.answerEn);
  assert.equal(findApprovedFaq('Business English fees', [{ questionEn:'Business English fees',answerEn:'unsupported price',questionAr:'',answerAr:'' }], 'en', { hasCourse:true }), null);
  const ambiguous = [faq,{ questionEn:'When are evening classes?',answerEn:'Different answer.',questionAr:'',answerAr:'' }];
  assert.equal(findApprovedFaq('evening classes', ambiguous, 'en'), null);
});
