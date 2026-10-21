'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {routerInventory}=require('../scripts/audit-upgraded-route-factories.cjs');

test('upgraded router factory mounts and their static route declarations are inventoried',()=>{
  const inventory=routerInventory();
  assert.ok(inventory.mountCount>=30,`Expected the current upgraded factory mounts, found ${inventory.mountCount}`);
  assert.ok(inventory.routes.length>=450,`Expected mounted API route bindings, found ${inventory.routes.length}`);
  assert.equal(inventory.dynamic.length,0,`Incomplete route declarations: ${JSON.stringify(inventory.dynamic)}`);
  assert.ok(inventory.routes.every(route=>route.reviewStatus==='review_required'));
  const has=(mount,path,method)=>inventory.routes.some(route=>route.mount===mount&&route.path===path&&route.method===method);
  assert.equal(has('/api/workspace/properties','/','GET'),true);
  assert.equal(has('/api/workspace/courses','/','GET'),true);
  assert.equal(has('/api/user/recruitment','/','GET'),true);
  assert.equal(has('/api/workspace/finance','/invoices','GET'),true);
  assert.equal(has('/api/workspace/tasks','/','GET'),true);
  assert.equal(has('/api/user/training/tasks','/','GET'),true);
  assert.equal(has('/api/admin/asterisk','/config','GET'),true);
  assert.equal(has('/api/admin/platform-access','/portfolios','GET'),true);
});
