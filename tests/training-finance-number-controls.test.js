'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const financeUi = fs.readFileSync(require.resolve('../client/public/training-finance.js'), 'utf8');
const financeCss = fs.readFileSync(require.resolve('../client/public/salemax-brand.css'), 'utf8');

test('all QAR amount fields use decimal text controls with browser validation', () => {
  const amounts = [...financeUi.matchAll(/<input name="amount"([^>]*)>/g)];

  assert.equal(amounts.length, 6);
  for (const [, attributes] of amounts) {
    assert.match(attributes, /\binputmode="decimal"/);
    assert.match(attributes, /\brequired/);
  }
  assert.match(financeUi, /name="amount" inputmode="decimal" pattern="\[0-9\]\+\(\\\\\.\[0-9\]\{1,2\}\)\?" required/);
  assert.match(financeUi, /name="amount" inputmode="decimal" pattern="\[0-9\]\+\(\\\\\.\[0-9\]\{1,2\}\)\?" max="\$\{/);
});

test('Finance follows the workspace direction for desktop layout and overlays', () => {
  assert.match(financeUi, /node\.dir=tr\('ltr','rtl'\)/);
  assert.match(financeUi, /#sx-finance-screen\[dir=rtl\]\{inset-inline:250px 0\}/);
  assert.match(financeUi, /#sx-finance-screen,#sx-finance-screen\[dir=rtl\]\{inset-inline:0;top:56px;padding:14px\}/);
  assert.match(financeCss, /#sx-finance-screen #sx-invoice-create-workspace:not\(\[hidden\]\)\{position:fixed/);
  assert.match(financeUi, /#sx-finance-screen \.finance-nav/);
});
