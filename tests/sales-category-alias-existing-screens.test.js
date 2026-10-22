'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=relative=>fs.readFileSync(path.join(__dirname,'..',relative),'utf8');

test('existing Pipeline shows Sales owner import for canonical and preserved category keys',()=>{
  const screen=read('client/public/pipeline/lead-import.js');
  assert.match(screen,/key==='7network_sales'\|\|key==='salemax_sales'/);
  assert.match(screen,/isSalesCategory\(body\.data\?\.categoryKey\).*body\.data\?\.role==='owner'/);
  const html=read('client/public/pipeline/index.html');
  assert.match(html,/lead-import\.js\?v=20261022-sales-category-alias1/);
});

test('existing Pipeline exposes Sales-only do-not-call outcome through the preserved alias',()=>{
  const screen=read('client/public/pipeline/pipeline.js');
  assert.match(screen,/const isSalesCategory = key => key === '7network_sales' \|\| key === 'salemax_sales'/);
  assert.match(screen,/isSalesCategory\(state\.data\.categoryKey\).*do_not_call/);
  assert.match(read('client/public/pipeline/index.html'),/pipeline\.js\?v=20261022-sales-category-alias1/);
});

test('existing Tasks adapts labels and Sales call type for the preserved category alias',()=>{
  const screen=read('client/public/tasks/tasks-context.js');
  assert.match(screen,/key==='7network_sales'\|\|key==='salemax_sales'/);
  assert.match(screen,/if\(!isSalesCategory\(result\?\.data\?\.categoryKey\)\)return/);
  assert.match(screen,/option\.value='sales_call'/);
  assert.match(read('client/public/tasks/index.html'),/tasks-context\.js\?v=20261022-sales-category-alias1/);
});
