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
  assert.match(html,/salemax-brand\.css\?v=[^"]+/);
});

test('Phonebook mobile headers stay readable inside the grid horizontal scroller',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../client/public/salemax-brand.css'),'utf8');
  const html=fs.readFileSync(path.join(__dirname,'../client/public/index.html'),'utf8');
  assert.match(css,/@media\(max-width:760px\)\{\s*#root \.MuiDataGrid-root:has\(\.MuiDataGrid-columnHeader\[data-field="phonebook_name"\]\)/);
  assert.match(css,/\.MuiDataGrid-columnHeader\[data-field="mobile"\].*?\{flex:0 0 160px!important;width:160px!important/s);
  assert.match(css,/\.MuiDataGrid-virtualScrollerContent,\s*#root \.MuiDataGrid-root:has\(\.MuiDataGrid-columnHeader\[data-field="phonebook_name"\]\) \.MuiDataGrid-virtualScrollerRenderZone,\s*#root \.MuiDataGrid-root:has\(\.MuiDataGrid-columnHeader\[data-field="phonebook_name"\]\) \.MuiDataGrid-row\{width:1140px!important/s);
  assert.match(html,/salemax-brand\.css\?v=[^"]+/);
});
