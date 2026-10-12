'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('form inventory includes forms and fields built through shared helpers', () => {
  const report = execFileSync(process.execPath, [path.join(__dirname, '../scripts/audit-form-controls.cjs')], { encoding: 'utf8' });
  assert.match(report, /client\/workspace-src\/signin\.js/);
  assert.match(report, /field\(form, 'workspace'\)/);
  assert.match(report, /field\(form, 'email'\)/);
  assert.match(report, /field\(form, 'password'\)/);
  assert.match(report, /field\(form, recovery\?'recovery':'code'\)/);
  assert.match(report, /Control fragments outside literal <form> markup/);
  assert.match(report, /client\/public\/admin-actions\.js/);
  assert.match(report, /line 23 input:\$\{name\}/);
});
