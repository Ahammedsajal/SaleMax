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

test('form inventory flags unlabeled static controls and the maintained forms provide explicit names', () => {
  const report = execFileSync(process.execPath, [path.join(__dirname, '../scripts/audit-form-controls.cjs')], { encoding: 'utf8' });
  assert.match(report, /\*\*0 static fields without an explicit accessible label\*\*/);
  assert.match(report, /generated fragments and runtime DOM associations still require browser review/);

  const read = file => require('node:fs').readFileSync(path.join(__dirname, '..', file), 'utf8');
  const pipeline = read('client/public/pipeline/pipeline.js');
  assert.match(pipeline, /function field\(name,label,type='text',value='',required=false\).*?<label for="\$\{id\}">.*?<input id="\$\{id\}"/);
  for (const id of ['editLeadStage', 'newLeadStage', 'settingsQrEntryStage', 'saleReviewOfferId', 'saleReviewTerms']) {
    assert.ok(pipeline.includes(`for=\"${id}\"`) && pipeline.includes(`id=\"${id}\"`), `${id} label is associated with its control`);
  }
  assert.match(read('client/public/pipeline/reports.js'), /aria-label="\$\{t\('dueAt'\)\}"/);
  assert.match(read('client/public/tasks/tasks.js'), /aria-label="\$\{tr\('Write a message… use @name to mention'/);
});
