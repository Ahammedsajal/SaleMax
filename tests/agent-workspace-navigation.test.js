'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../client/public/agent-workspace-navigation.js'),'utf8');
test('Agent navigation intersects role and assigned screens and fails closed on errors',async()=>{
  const start=source.indexOf('  async function refresh()'),end=source.indexOf('  const style=',start),script=source.slice(start,end);
  const box={allowed:new Set(),loaded:false,schedule(){},window:{SaleMaxWorkspace:{session:async()=>({roleNavigation:['inbox','tasks','courses','leads'],assignedNavigation:['inbox','courses']})},dispatchEvent(){}},Event:class{}};
  vm.runInNewContext(script,box);await box.refresh();assert.deepEqual([...box.allowed],['inbox','courses']);assert.equal(box.loaded,true);
  box.window.SaleMaxWorkspace.session=async()=>({roleNavigation:['tasks'],assignedNavigation:null});await box.refresh();assert.deepEqual([...box.allowed],['tasks']);
  box.window.SaleMaxWorkspace.session=async()=>{throw Error('AUTH_REQUIRED');};await box.refresh();assert.equal(box.allowed.size,0);assert.equal(box.loaded,false);
});
test('Agent module links preserve the existing panel and never copy or replace authentication',()=>{
  assert.ok(source.includes("link.href='/agent?page='+route"));
  assert.doesNotMatch(source,/localStorage\.(setItem|removeItem)|wacrm_user|innerHTML/);
  for(const key of ['leads','contacts','courses','enrollments','reports','forms'])assert.ok(source.includes("['"+key+"'"));
});
