'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const ui=fs.readFileSync(path.join(__dirname,'../client/public/admin-user-plans.js'),'utf8');

test('business setup shows its fixed Training Center category as a labelled output',()=>{
  assert.match(ui,/<output aria-label="\$\{t\('Business category','فئة النشاط'\)\}">\$\{t\('Training center','مركز تدريب'\)\}<\/output>/);
  assert.doesNotMatch(ui,/<input value="\$\{t\('Training center','مركز تدريب'\)\}" disabled>/);
  assert.match(ui,/\.sx-user-category-assignment output\{display:flex/);
});
