'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'client/public/index.html'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'client/public/admin-plan-editor.js'), 'utf8');
const contracts = fs.readFileSync(path.join(root, 'client/public/admin-plan-contracts.js'), 'utf8');

test('contract draft editing is mounted inside the original Manage Plans screen', () => {
  assert.match(shell, /src="\/admin-plan-contracts\.js/);
  assert.match(editor, /salemaxPlanContracts\?\.mount\(active,plan\)/);
  assert.match(contracts, /data-edit=/);
  assert.match(contracts, /Edit draft/);
  assert.match(contracts, /تعديل المسودة/);
  assert.match(contracts, /draft\.dataset\.editRevision/);
  assert.match(contracts, /'PUT'/);
  assert.match(contracts, /STALE_REVISION/);
  assert.match(contracts, /UNSAVED_DRAFT/);
  assert.match(contracts, /Cancel editing/);
  assert.match(contracts, /احفظ تغييرات المسودة أو تجاهلها قبل مراجعة النشر/);
  assert.match(contracts, /تحديث تغييرات المسودة|حفظ تغييرات المسودة/);
});
