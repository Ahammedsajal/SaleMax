'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'../client/public');
test('embedded dashboard anchors navigate the existing top-level business shell',()=>{
  const html=fs.readFileSync(path.join(root,'business-dashboard/index.html'),'utf8');
  assert.match(html,/<head><base target="_top">/);
  const source=fs.readFileSync(path.join(root,'business-dashboard/dashboard.js'),'utf8');
  assert.ok(source.includes('/user?page=tasks&task=${encodeURIComponent(x.id)}'));
});
test('dashboard Create actions also leave the embedded dashboard',()=>{
  const source=fs.readFileSync(path.join(root,'business-dashboard/dashboard.js'),'utf8');
  const code=source.slice(source.indexOf('function createMenu()'),source.indexOf('function metric('));
  let assigned;
  const button={dataset:{index:'0'}},menu={querySelectorAll:()=>[button]},create={};
  vm.runInNewContext(code+';createMenu();',{
    actor:()=> 'user',navigation:()=>new Set(['tasks']),state:{},tr:en=>en,esc:x=>x,
    $:selector=>selector==='#create-menu'?menu:create,createCloseBound:false,
    document:{addEventListener(){}},window:{top:{location:{assign:value=>assigned=value}}}
  });
  button.onclick();
  assert.equal(assigned,'/user?page=tasks');
});
