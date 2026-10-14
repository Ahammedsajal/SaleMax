'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const ui=fs.readFileSync(path.join(__dirname,'../client/public/admin-plan-contracts.js'),'utf8');

test('plan contract category is chosen from the authorized list inside the existing editor',()=>{
  assert.match(ui,/<select name="categoryKey" aria-label="\$\{t\('Choose category','اختر الفئة'\)\}">/);
  assert.match(ui,/context\.categories\.map/);
  assert.doesNotMatch(ui,/<select name="category">/);
  assert.match(ui,/categoryKey:'training_center'/);
  assert.match(ui,/category\.features\.map/);
});
