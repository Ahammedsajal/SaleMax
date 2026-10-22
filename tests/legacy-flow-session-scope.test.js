'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { flowSessionScope, flowSessionRowScope } = require('../modules/platform/legacy-flow-session-scope');

test('legacy flow session identity separates channels and connected accounts', () => {
  const qr = flowSessionScope({ uid: 'owner-1', origin: 'qr', sessionId: 'qr-number-a', flowId: 'flow-1', senderMobile: '15550001111' });
  const meta = flowSessionScope({ uid: 'owner-1', origin: 'meta', sessionId: 'meta-number-a', flowId: 'flow-1', senderMobile: '15550001111' });
  const secondQr = flowSessionScope({ uid: 'owner-1', origin: 'qr', sessionId: 'qr-number-b', flowId: 'flow-1', senderMobile: '15550001111' });
  assert.match(qr.where, /uid = \? AND origin <=> \? AND origin_id <=> \? AND flow_id = \? AND sender_mobile = \?/);
  assert.deepEqual(qr.params, ['owner-1', 'qr', 'qr-number-a', 'flow-1', '15550001111']);

  const rows = [
    { id: 1, uid: 'owner-1', origin: 'qr', origin_id: 'qr-number-a', flow_id: 'flow-1', sender_mobile: '15550001111' },
    { id: 2, uid: 'owner-1', origin: 'meta', origin_id: 'meta-number-a', flow_id: 'flow-1', sender_mobile: '15550001111' },
    { id: 3, uid: 'owner-1', origin: 'qr', origin_id: 'qr-number-b', flow_id: 'flow-1', sender_mobile: '15550001111' },
    { id: 4, uid: 'owner-2', origin: 'qr', origin_id: 'qr-number-a', flow_id: 'flow-1', sender_mobile: '15550001111' },
  ];
  const keys = ['uid', 'origin', 'origin_id', 'flow_id', 'sender_mobile'];
  const matches = scope => rows.filter(row => keys.every((key, index) =>
    row[key] === scope.params[index]));
  assert.deepEqual(matches(qr).map(row => row.id), [1]);
  assert.deepEqual(matches(meta).map(row => row.id), [2]);
  assert.deepEqual(matches(secondQr).map(row => row.id), [3]);
});

test('legacy session mutations use the selected row plus owner, and lookups retain channel identity', () => {
  assert.deepEqual(flowSessionRowScope({ id: 22 }, 'owner-1'), {
    where: 'id = ? AND uid = ?', params: [22, 'owner-1'],
  });
  assert.equal(flowSessionRowScope({ id: 22 }, ''), null);

  const functions = fs.readFileSync(path.join(__dirname, '../automation/functions.js'), 'utf8');
  const automation = fs.readFileSync(path.join(__dirname, '../automation/automation.js'), 'utf8');
  const runtime = fs.readFileSync(path.join(__dirname, '../modules/platform/chatbot-runtime.js'), 'utf8');
  assert.match(functions, /const scope = flowSessionScope\([\s\S]*?WHERE \$\{scope\.where\}/);
  assert.match(functions, /async function updateFlowSessionData[\s\S]*?WHERE \$\{rowScope\.where\}/);
  const activeFunctions = functions.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(activeFunctions, /UPDATE flow_session SET data = \? WHERE flow_id = \? AND uid = \? AND sender_mobile = \?/);
  assert.match(automation, /flowSessionScope\([\s\S]*?DELETE FROM flow_session WHERE \$\{scope\.where\}/);
  assert.doesNotMatch(automation, /DELETE FROM flow_session\s+WHERE uid\s*=\s*\?\s+AND flow_id\s*=\s*\?\s+AND sender_mobile\s*=\s*\?/);
  assert.match(runtime, /flowSessionScope\(\{ uid, flowId: executionFlowId\(profile\), senderMobile: message\.senderMobile, origin, sessionId \}\)/);
});
