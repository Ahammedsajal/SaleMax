'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const pipeline=fs.readFileSync(require.resolve('../client/public/pipeline/pipeline.js'),'utf8');
const finance=fs.readFileSync(require.resolve('../client/public/training-finance.js'),'utf8');

test('lead and manual invoice phone fields use telephone input and autofill hints',()=>{
  assert.match(pipeline,/name="mobile" type="tel" inputmode="tel" autocomplete="tel"/);
  assert.match(pipeline,/name="mobile" type="tel" inputmode="tel" autocomplete="tel" value="\$\{escape\(lead\.mobile\|\|''\)\}"/);
  assert.match(finance,/name="customerPhone" type="tel" inputmode="tel" autocomplete="tel" maxlength="40"/);
});
