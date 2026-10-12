'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const financeUi = fs.readFileSync(require.resolve('../client/public/training-finance.js'), 'utf8');

test('all QAR amount fields use bounded decimal number controls', () => {
  const amounts = [...financeUi.matchAll(/<input name="amount"([^>]*)>/g)];

  assert.equal(amounts.length, 6);
  for (const [, attributes] of amounts) {
    assert.match(attributes, /\btype="number"/);
    assert.match(attributes, /\bmin="0\.01"/);
    assert.match(attributes, /\bstep="0\.01"/);
    assert.match(attributes, /\binputmode="decimal"/);
  }
  assert.match(financeUi, /name="amount" type="number" min="0\.01" step="0\.01" inputmode="decimal" max="\$\{/);
});
