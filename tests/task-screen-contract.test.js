'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../client/public/tasks/tasks.js'), 'utf8');

test('task chat retains its form reference across the asynchronous send', () => {
  const handler = source.match(/#chatForm'\)\.onsubmit=async ev=>\{([\s\S]*?)\};state\.chatAfter=/)?.[1];
  assert.ok(handler, 'chat submit handler exists');
  const sendIndex = handler.indexOf('await request(');
  const resetIndex = handler.indexOf('form.reset()');
  assert.match(handler, /const form=ev\.currentTarget,body=new FormData\(form\)/);
  assert.ok(sendIndex >= 0 && resetIndex > sendIndex, 'the retained form is cleared after the server response');
  assert.doesNotMatch(handler, /ev\.currentTarget\.reset\(\)/, 'do not read currentTarget after awaiting the request');
});
