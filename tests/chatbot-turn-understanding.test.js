'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRequest, validateProposal, renderPriceComparison, safeSocialFallback, retainSelectedCourse, isExistingLearnerUpdate, existingLearnerHandoffReply, courseFactTopic, pendingCourseFactTopic, understandTurn } = require('../modules/platform/chatbot-turn-understanding');

const context = {
  evidence: [
    { kind: 'course', code: 'MARINE', sourceId: 'course:marine', name: 'Marine Deckhand', offer: { priceAmount: 3000, currency: 'QAR' } },
    { kind: 'course', code: 'TEACHER', sourceId: 'course:teacher', name: 'Teacher Training', offer: { priceAmount: 1450, currency: 'QAR' } },
  ],
  sources: [{ id: 'course:marine' }, { id: 'course:teacher' }],
};
const answer = {
  action: 'answer', course_codes: ['MARINE'], source_ids: ['course:marine'],
  reply: 'Marine Deckhand costs QAR 3000.', next_question: 'none', confidence: 0.95,
};

test('builds a bounded turn context and includes the last question', () => {
  const history = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user', text: index === 7 ? 'Would you like the fee?' : `message ${index}`,
  }));
  const request = buildRequest({ text: 'How much?', history, state: { selectedCourseCode: 'MARINE', pendingQuestion: 'other' }, context });
  assert.equal(request.history.length, 8);
  assert.equal(request.lastQuestion, null);
  assert.equal(request.selectedCourseCode, 'MARINE');
});

test('passes the trusted staff-queue state into the model context and validates a truthful handoff acknowledgement', () => {
  const request = buildRequest({ text: 'I already joined and will pay today for sign in.', context,
    staffNotificationQueued: true });
  assert.equal(request.staffNotificationQueued, true);
  const proposal = { ...answer,
    reply: 'Thanks for the update. I understand you have joined Marine Deckhand and mentioned payment and sign-in. I’ve shared this with our team so they can help.',
    source_ids: ['course:marine'], next_question: 'none' };
  assert.equal(validateProposal(proposal, context, { staffNotificationQueued: true,
    turnText: 'I already joined and will pay today for sign in.' }).valid, true);
});

test('recognizes an existing learner and replies about their current course without restarting intake', () => {
  const text = 'I Al ready joined. Today will be payment for Sign in';
  assert.equal(isExistingLearnerUpdate(text), true);
  const reply = existingLearnerHandoffReply({ text, language: 'en', courseName: 'Marine Deckhand' });
  assert.match(reply, /already joined the Marine Deckhand course/i);
  assert.match(reply, /payment and sign-in/i);
  assert.match(reply, /shared your message with our team/i);
  assert.doesNotMatch(reply, /which course|what name|phone number|call you on/i);
  assert.equal(existingLearnerHandoffReply({ text: 'What is the course fee?' }), null);
});

test('redacts private contact details and limits long multilingual prompts', () => {
  const text = 'My number is +974 5555 5555 and email is test@example.com';
  const history = Array.from({ length: 8 }, () => ({ role: 'user', text: 'ع'.repeat(400) }));
  const large = { evidence: Array.from({ length: 16 }, (_, i) => ({
    kind: 'approved_faq', sourceId: `faq:${i}`, answer: 'ع'.repeat(2000),
  })) };
  const request = buildRequest({ text, history, context: large });
  const payload = JSON.stringify(request);
  assert.doesNotMatch(payload, /5555 5555|test@example.com/);
  assert.ok(Buffer.byteLength(payload, 'utf8') <= 11400);
});

test('includes an outstanding question when it is the last prior message', () => {
  const request = buildRequest({ text: 'Yes', history: [{ role: 'assistant', text: 'May we call you?' }], context });
  assert.equal(request.lastQuestion, 'May we call you?');
});

test('retains the original course fact request while the customer answers a course clarification', () => {
  assert.equal(courseFactTopic('What is the training duration?'), 'duration');
  assert.equal(courseFactTopic('How much is the course?'), 'fee');
  const request = buildRequest({ text: 'Computer Skills Training',
    history: [{ role: 'assistant', text: 'Which course are you asking about?' }],
    state: { selectedCourseCode: 'PCAT-MS-OFFICE', pendingQuestion: 'none', pendingFactTopic: 'duration' },
    context });
  assert.equal(request.pendingFactTopic, 'duration');
  assert.equal(safeSocialFallback('ok', 'en'), 'No problem. I’m here if you need anything else.');
});

test('recovers an older unanswered fact question from history when a course clarification is pending', () => {
  const history = [
    { role: 'user', text: 'What is the training duration?' },
    { role: 'assistant', text: 'Which course are you asking about?' },
  ];
  assert.equal(pendingCourseFactTopic(history, { waitingForCourse: true }), 'duration');
  assert.equal(pendingCourseFactTopic(history, { resolvedCourseFromClarification: true }), 'duration');
  assert.equal(pendingCourseFactTopic(history, { waitingForCourse: false }), null);
  assert.equal(pendingCourseFactTopic([
    { role: 'user', text: 'كم مدة التدريب؟' },
    { role: 'assistant', text: 'ما اسم الدورة التي تسأل عنها؟' },
  ], { waitingForCourse: true }), 'duration');
  assert.equal(pendingCourseFactTopic([
    { role: 'user', text: 'What is the training duration?' },
    { role: 'assistant', text: 'The course lasts 8–10 weeks.' },
  ], { waitingForCourse: true }), null);
});

test('accepts a sourced price and rejects unknown and crossed course references', () => {
  assert.equal(validateProposal(answer, context).valid, true);
  assert.equal(validateProposal({ ...answer, source_ids: ['course:fake'] }, context).reason, 'UNKNOWN_SOURCE');
  assert.equal(validateProposal({ ...answer, course_codes: ['TEACHER'] }, context).reason, 'COURSE_SOURCE_MISMATCH');
  assert.equal(validateProposal({ ...answer, reply: 'Marine Deckhand costs QAR 1450.' }, context).valid, false);
  assert.equal(validateProposal({ ...answer, confidence: 0.2 }, context).reason, 'LOW_CONFIDENCE');
  assert.equal(validateProposal({ ...answer, reply: 'Would you like me to check the schedule with the team?' }, context).reason, 'STAFF_ACTION_OFFER_UNAVAILABLE');
  assert.equal(validateProposal(answer, { ...context, explicitCourses: 1, selectedCourseCode: 'TEACHER' }).reason, 'EXPLICIT_COURSE_MISMATCH');
});

test('requires per-course rendering for multi-course prices and rejects invented staff action', () => {
  const comparison = { ...answer, course_codes: ['MARINE', 'TEACHER'],
    source_ids: ['course:marine', 'course:teacher'], reply: 'Marine is QAR 1450 and Teacher is QAR 3000.' };
  assert.equal(validateProposal(comparison, context).reason, 'MULTI_COURSE_FACTS_REQUIRE_RENDERING');
  assert.equal(validateProposal({ ...answer, action: 'request_staff' }, context).reason, 'STAFF_ACTION_REQUIRES_RUNTIME');
  assert.equal(validateProposal({ ...answer, action: 'no_reply', reply: '' }, context).reason, 'SILENCE_REQUIRES_RUNTIME');
  assert.equal(renderPriceComparison('How much for both courses?', context.evidence, comparison, { explicitCourses: 2 }),
    'Marine Deckhand: QAR 3,000\nTeacher Training: QAR 1,450');
  assert.equal(renderPriceComparison('What are the registration fees?', context.evidence, comparison, { explicitCourses: 2 }), null);
  assert.equal(renderPriceComparison('How much for both?', context.evidence, comparison, { explicitCourses: 3 }), null);
  assert.equal(buildRequest({ text: 'fee?', context, showFees: false }).evidence[0].offer, undefined);
});

test('allows a short natural acknowledgement but blocks unsourced claims and evasion', () => {
  const neutral = { action: 'acknowledge', course_codes: [], source_ids: [],
    reply: 'Of course. Take your time.', next_question: 'none', confidence: 0.95 };
  assert.equal(validateProposal(neutral, context, { turnText: 'I will message later' }).valid, true);
  assert.equal(validateProposal({ ...neutral, course_codes: ['MARINE'] }, context, { turnText: 'I will message later' }).valid, true);
  assert.equal(validateProposal({ ...neutral, reply: 'The course is free and open.' }, context).valid, false);
  assert.equal(validateProposal({ ...neutral, reply: 'Please share your password.' }, context).valid, false);
  assert.equal(validateProposal(neutral, context, { turnText: 'How much is it?' }).valid, false);
  assert.equal(validateProposal(neutral, context, { lastAssistant: 'Of course. Take your time.' }).reason, 'REPEATED_REPLY');
});

test('blocks asking again for contact details already provided', () => {
  const question = { action: 'clarify', course_codes: [], source_ids: [],
    reply: 'May I have your name?', next_question: 'name', confidence: 0.95 };
  assert.equal(validateProposal(question, context, { contactProgress: { nameProvided: true } }).reason, 'QUESTION_ALREADY_ANSWERED');
  assert.equal(validateProposal({ ...question, next_question: 'other' }, context, { contactProgress: { nameProvided: true } }).reason, 'QUESTION_ALREADY_ANSWERED');
});

test('requires a structured model call and returns usage without performing actions', async () => {
  let request;
  const provider = { generateConversation: async args => {
    request = args;
    return { function: 'propose_training_reply', functionArguments: answer, usage: { inputTokens: 100 } };
  } };
  const result = await understandTurn({ provider, settings: { provider: 'openai', model: 'gpt-6-luna', apiKey: 'test' },
    tenantId: 'synthetic', text: 'How much?', history: [], state: {}, context });
  assert.equal(result.ok, true);
  assert.equal(request.functions[0].name, 'propose_training_reply');
  assert.equal(result.usage.inputTokens, 100);
  assert.equal(JSON.parse(request.messages[2].content).text, 'How much?');
  assert.equal(JSON.parse(request.messages[1].content).approvedEvidence[0].code, 'MARINE');
});

test('removes source citations from the customer reply and rejects raw internal IDs', async () => {
  const settings = { provider: 'openai', model: 'gpt-6-luna', apiKey: 'test' };
  const provider = { generateConversation: async () => ({
    function: 'propose_training_reply',
    functionArguments: { ...answer, reply: 'Marine Deckhand costs QAR 3000. [course:marine]' }, usage: {},
  }) };
  const result = await understandTurn({ provider, settings, tenantId: 'synthetic', text: 'How much?', context });
  assert.equal(result.ok, true);
  assert.equal(result.proposal.reply, 'Marine Deckhand costs QAR 3000.');
  provider.generateConversation = async () => ({ function: 'propose_training_reply',
    functionArguments: { ...answer, reply: 'Internal course:marine reference' }, usage: {} });
  assert.equal((await understandTurn({ provider, settings, tenantId: 'synthetic', text: 'How much?', context })).reason, 'SOURCE_ID_IN_REPLY');
});

test('preserves the selected course through a thank-you and a request to wait', async () => {
  const settings = { provider: 'openai', model: 'gpt-6-luna', apiKey: 'test' };
  const history = [
    { role: 'user', text: 'Tell me about Marine Deckhand.' },
    { role: 'assistant', text: 'Marine Deckhand costs QAR 3000.' },
  ];
  for (const [text, reply, action] of [
    ["Ok ma'am.. Thank you for this information..", 'You’re welcome!', 'acknowledge'],
    ['Not now..', 'Of course. Take your time.', 'defer'],
  ]) {
    let request;
    const provider = { generateConversation: async args => {
      request = args;
      return { function: 'propose_training_reply', functionArguments: {
        action, course_codes: [], source_ids: [], reply, next_question: 'none', confidence: 0.95,
      }, usage: {} };
    } };
    const result = await understandTurn({ provider, settings, tenantId: 'synthetic', text, history,
      state: { selectedCourseCode: 'MARINE' }, context });
    assert.equal(result.ok, true);
    assert.equal(result.proposal.reply, reply);
    assert.equal(JSON.parse(request.messages[2].content).selectedCourseCode, 'MARINE');
    assert.equal(result.proposal.next_question, 'none');
  }
});

test('renders a comparison from verified prices even when the model swaps them', async () => {
  const provider = { generateConversation: async () => ({ function: 'propose_training_reply',
    functionArguments: { ...answer, course_codes: ['MARINE', 'TEACHER'],
      source_ids: ['course:marine', 'course:teacher'], reply: 'Marine is QAR 1450 and Teacher is QAR 3000.' }, usage: {} }) };
  const settings = { provider: 'openai', model: 'gpt-6-luna', apiKey: 'test' };
  const args = { provider, settings, tenantId: 'synthetic', text: 'How much for both courses?', context: { ...context, explicitCourses: 2 } };
  const result = await understandTurn(args);
  assert.equal(result.proposal.reply, 'Marine Deckhand: QAR 3,000\nTeacher Training: QAR 1,450');
  assert.equal((await understandTurn({ ...args, showFees: false })).ok, false);
});

test('a failed model proposal respects a clear request to wait without guessing about a question', () => {
  assert.match(safeSocialFallback('Not now..'), /take your time/i);
  assert.equal(safeSocialFallback('Not now, how much is the course?'), null);
  assert.ok(safeSocialFallback('ليس الآن', 'ar'));
  assert.match(safeSocialFallback('I am not interested, thanks.'), /thanks for letting me know/i);
  assert.match(safeSocialFallback('Why do you keep asking me the same question?'), /sorry for repeating/i);
});

test('retains the known course for ambiguous follow-ups but respects an explicit change', () => {
  const search = { evidence: [context.evidence[1]], sources: [context.sources[1]], explicitCourses: 0, selectedCourseCode: 'TEACHER' };
  const selected = { evidence: [context.evidence[0]], sources: [context.sources[0]] };
  const result = retainSelectedCourse(search, selected, 'MARINE');
  assert.equal(result.selectedCourseCode, 'MARINE');
  assert.equal(result.evidence[0].code, 'MARINE');
  assert.equal(result.evidence[1].code, 'TEACHER');
  assert.equal(retainSelectedCourse({ ...search, explicitCourses: 1 }, selected, 'MARINE').selectedCourseCode, 'TEACHER');
});
