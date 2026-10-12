'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const coursesUi = fs.readFileSync(require.resolve('../client/public/training-courses.js'), 'utf8');

function assertQarNumberControl(name, expectedCount) {
  const fields = [...coursesUi.matchAll(new RegExp(`<input name="${name}"([^>]*)>`, 'g'))];
  assert.equal(fields.length, expectedCount);
  for (const [, attributes] of fields) {
    assert.match(attributes, /\btype="number"/);
    assert.match(attributes, /\bmin="0"/);
    assert.match(attributes, /\bmax="999999999\.99"/);
    assert.match(attributes, /\bstep="0\.01"/);
    assert.match(attributes, /\binputmode="decimal"/);
  }
  return fields;
}

test('course offers use bounded decimal QAR fields without making initial pricing mandatory', () => {
  const prices = assertQarNumberControl('price', 2);
  assert.doesNotMatch(prices[0][1], /\brequired\b/);
  assert.match(prices[1][1], /\brequired\b/);
  assertQarNumberControl('registrationFee', 2);
});