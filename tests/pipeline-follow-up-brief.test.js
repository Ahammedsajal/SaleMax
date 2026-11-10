'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessLead, shapeBrief, messageBody } = require('../modules/platform/pipeline-follow-up-brief');

const now = Date.parse('2026-11-10T12:00:00.000Z');
const lead = overrides => ({ id:'lead-1', status:'open', title:'Course enquiry', contact_name:'Learner', owner_agent_id:12, owner_name:'Agent 12', ...overrides });
const msg = (route, text, createdAt, overrides = {}) => ({
  route, type:'text', sentBy:route === 'OUTGOING' ? 'human' : null,
  createdAt, chatId:'chat-1', origin:'qr', msgContext:{ text:{ body:text } }, ...overrides,
});

test('flags a live high-intent lead when the latest customer turn has no later staff reply', () => {
  const result = assessLead(lead(), [msg('INCOMING','How much is the course fee?','2026-11-07T08:00:00Z')], now);
  assert.equal(result.priority, 'high');
  assert.equal(result.daysWaiting, 3);
  assert.equal(result.ownerName, 'Agent 12');
  assert.equal(result.latestCustomerMessage, 'How much is the course fee?');
});

test('counts any later human outbound message on a linked channel as attended', () => {
  const events = [
    msg('INCOMING','I am interested in the course','2026-11-07T08:00:00Z'),
    msg('OUTGOING','We can help','2026-11-07T09:00:00Z',{chatId:'meta-chat',origin:'meta'}),
  ];
  assert.equal(assessLead(lead(), events, now), null);
});

test('uses message ID order to resolve replies stored in the same second', () => {
  const events = [
    msg('INCOMING','How much is the course?','2026-11-07T08:00:00Z',{timestamp:1794038400,id:11}),
    msg('OUTGOING','The fee is 100','2026-11-07T08:00:00Z',{timestamp:1794038400,id:12}),
  ];
  assert.equal(assessLead(lead(), events, now), null);
});

test('does not treat bot replies as staff follow-up', () => {
  const events = [
    msg('INCOMING','Please send me the details','2026-11-07T08:00:00Z'),
    msg('OUTGOING','Here are the details','2026-11-07T09:00:00Z',{sentBy:'automation'}),
  ];
  assert.equal(assessLead(lead(), events, now)?.priority, 'high');
});

test('separates a missing business message from a bot reply awaiting a human response', () => {
  const noMessage = assessLead(lead(), [msg('INCOMING','How much is the course fee?','2026-11-07T08:00:00Z')], now);
  const botReplied = assessLead(lead(), [
    msg('INCOMING','How much is the course fee?','2026-11-07T08:00:00Z'),
    msg('OUTGOING','A bot welcome','2026-11-07T09:00:00Z',{sentBy:'bot'}),
  ], now);
  assert.equal(noMessage.businessMessageEverSent, false);
  assert.equal(noMessage.automatedReplyAfterLatestCustomer, false);
  assert.equal(botReplied.businessMessageEverSent, true);
  assert.equal(botReplied.automatedReplyAfterLatestCustomer, true);
  assert.equal(botReplied.priority, 'high');
});

test('does not recommend closed leads or explicit opt-outs', () => {
  assert.equal(assessLead(lead({ status:'won' }), [msg('INCOMING','How much is the course?','2026-11-07T08:00:00Z')], now), null);
  assert.equal(assessLead(lead(), [msg('INCOMING','How much is the course?','2026-11-07T08:00:00Z'),msg('INCOMING','Please stop','2026-11-07T09:00:00Z')], now), null);
  assert.equal(assessLead(lead(), [msg('INCOMING','How much is the course?','2026-11-07T08:00:00Z'),msg('INCOMING','I am not interested in this course, thanks.','2026-11-07T09:00:00Z')], now), null);
  assert.equal(assessLead(lead(), [msg('INCOMING','كم الرسوم؟ أنا غير مهتم بهذه الدورة.','2026-11-07T08:00:00Z')], now), null);
});

test('separates unclassified unanswered leads from rule-signal prospects', () => {
  const brief = shapeBrief([
    { priority:'high', daysWaiting:4, hoursWaiting:100, ownerAgentId:null },
    { priority:'warm', daysWaiting:1, hoursWaiting:40, ownerAgentId:2 },
  ], { needsReview:3 });
  assert.deepEqual(brief.summary, { total:2, unansweredOpen:5, highIntent:1, warmInterest:1, needsReview:3, waiting72Hours:1, unassigned:1, noBusinessMessage:0, automatedReplyAwaitingStaff:0 });
  assert.equal(brief.items.length,2);
});

test('summary-only notifications omit all lead and chat details', () => {
  const brief = shapeBrief([{ priority:'high', daysWaiting:3, hoursWaiting:80, ownerAgentId:null, customerName:'Private lead' }], { includeItems:false });
  assert.equal(brief.summary.total,1);
  assert.deepEqual(brief.items,[]);
});

test('extracts plain text from structured chat payloads and tolerates malformed JSON', () => {
  assert.equal(messageBody({ msgContext:'{"text":{"body":"  Course   details? "}}' }), 'Course details?');
  assert.equal(messageBody({ msgContext:'broken' }), '');
});
