'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../client/public/pipeline');

test('embedded Pipeline follows the saved workspace theme and includes dark modal styles',()=>{
  const script=fs.readFileSync(path.join(root,'pipeline.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const css=fs.readFileSync(path.join(root,'pipeline-theme.css'),'utf8');
  assert.match(script,/localStorage\.getItem\('theme_mode'\)/);
  assert.match(script,/addEventListener\('storage'/);
  assert.match(html,/pipeline-theme\.css\?v=20261028-dark-theme1/);
  assert.match(css,/html\[data-sx-theme=dark\] \.modal/);
  assert.match(css,/html\[data-sx-theme=dark\] \.re-create-requirement/);
  assert.match(css,/html\[data-sx-theme=dark\] \.re-requirements input/);
});

test('Real Estate Pipeline localizes stages and unassigned choices in Arabic',()=>{
  const script=fs.readFileSync(path.join(root,'pipeline.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(script,/stageName\(state\.data\.stages\.find\(s=>s\.stage_key===x\.stage_key\)/);
  assert.equal((script.match(/escape\(stageName\(s\)\)/g)||[]).length,2);
  assert.ok((script.match(/tr\('unassigned'\)/g)||[]).length>=3);
  assert.match(html,/pipeline\.js\?v=20261028-real-estate-i18n1/);
});
