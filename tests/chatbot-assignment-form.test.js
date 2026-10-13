'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const root=path.join(__dirname,'..');
const ui=fs.readFileSync(path.join(root,'client/public/chatbot-admin.js'),'utf8');
const loader=fs.readFileSync(path.join(root,'client/public/training-sidebar.js'),'utf8');

test('chatbot assignment shows the selected bot title as a labelled preview',()=>{
  assert.match(ui,/<output data-title aria-label="\$\{esc\(tr\('Title','العنوان'\)\)\}"/);
  assert.match(ui,/titleOutput\.textContent = bot\?\.name \|\| tr\('Select a bot to see its title'/);
  assert.doesNotMatch(ui,/<input data-title readonly/);
  assert.match(loader,/chatbot-admin\.js\?v=20261012-test-list-empty1/);
});

test('empty test-number list does not reserve a blank row in the bot editor',()=>{
  assert.match(ui,/\.sx-test-number-list:empty\{display:none\}/);
  assert.match(ui,/\.sx-test-number-list\{display:flex;flex-wrap:wrap/);
  assert.match(ui,/data-test-number-list role="list"/);
});
