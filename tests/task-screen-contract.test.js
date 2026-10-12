'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../client/public/tasks/tasks.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../client/public/tasks/index.html'), 'utf8');

test('task chat retains its form reference across the asynchronous send', () => {
  const handler = source.match(/#chatForm'\)\.onsubmit=async ev=>\{([\s\S]*?)\};state\.chatAfter=/)?.[1];
  assert.ok(handler, 'chat submit handler exists');
  const sendIndex = handler.indexOf('await request(');
  const resetIndex = handler.indexOf('form.reset()');
  assert.match(handler, /const form=ev\.currentTarget,body=new FormData\(form\)/);
  assert.ok(sendIndex >= 0 && resetIndex > sendIndex, 'the retained form is cleared after the server response');
  assert.doesNotMatch(handler, /ev\.currentTarget\.reset\(\)/, 'do not read currentTarget after awaiting the request');
});

test('task selectors remain catalogue-backed and popup accessibility labels follow the selected language', () => {
  assert.match(html, /select id="statusFilter" aria-label="Status filter"/);
  assert.match(html, /name="taskType"><option value="lead_follow_up"[\s\S]*?<option value="general"/);
  assert.match(html, /name="priority"><option value="normal"[\s\S]*?<option value="urgent"/);
  assert.match(html, /name="dueAt" type="datetime-local"/);
  assert.match(source, /\$\('#statusFilter'\)\.setAttribute\('aria-label',tr\('Status filter','تصفية الحالة'\)\)/);
  assert.match(source, /\$\('#refresh'\)\.setAttribute\('aria-label',tr\('Refresh','تحديث'\)\)/);
  assert.match(source, /querySelectorAll\('\.close'\)\.forEach\(button=>button\.setAttribute\('aria-label',tr\('Close','إغلاق'\)\)\)/);
  assert.match(html, /tasks\.js\?v=20261012-chat-label1/);
});
