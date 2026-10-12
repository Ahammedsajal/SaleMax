'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('Finance invoice register actions use a readable full-width mobile layout',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../client/public/salemax-brand.css'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../client/public/index.html'),'utf8');
  assert.match(css,/@media\(max-width:760px\)\{\s*#sx-finance-screen #sx-invoice-register>\.toolbar\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/#sx-finance-screen #sx-invoice-register>\.toolbar>\.actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/#sx-finance-screen #sx-invoice-register>\.toolbar>\.actions>#sx-invoice-create\{grid-column:1\/-1\}/);
  assert.match(html,/salemax-brand\.css\?v=20261012-finance-register-mobile1/);
});
