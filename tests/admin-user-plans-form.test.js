'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const ui=fs.readFileSync(path.join(__dirname,'../client/public/admin-user-plans.js'),'utf8');

test('Manage Users selects from reviewed versioned categories and preserves the existing account',()=>{
  assert.match(ui,/<select aria-label="\$\{t\('Business category','فئة النشاط'\)\}">/);
  assert.match(ui,/current\.categories\|\|\[\]/);
  assert.match(ui,/category\.key\+'@'\+category\.version/);
  assert.match(ui,/The user keeps the existing business sign-in/);
  assert.match(ui,/\.sx-user-category-assignment select\{display:block/);
});
