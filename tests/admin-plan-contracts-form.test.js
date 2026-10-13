'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const ui=fs.readFileSync(path.join(__dirname,'../client/public/admin-plan-contracts.js'),'utf8');

test('plan contract uses fixed training-center category as read-only text',()=>{
  assert.match(ui,/<output aria-label="\$\{t\('Business category','فئة النشاط'\)\}">\$\{esc\(context\.category\.title\[ar\(\)\?'ar':'en'\]\)\}<\/output>/);
  assert.doesNotMatch(ui,/<select name="category">/);
  assert.match(ui,/categoryKey:'training_center'/);
  assert.match(ui,/\.sx-contracts output\{display:flex/);
});
