'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {audit,routeInventory}=require('../scripts/audit-legacy-route-policy.cjs');
const baseline=require('../scripts/legacy-route-policy-baseline.json');
const signature=route=>`${route.mount} ${route.method} ${route.path}`;

test('legacy router inventory stays within the reviewed unknown-route baseline',()=>{
  const result=audit();
  assert.equal(result.newUnmapped.length,0,`New unmapped routes: ${result.newUnmapped.map(signature).join(', ')}`);
  assert.equal(result.dynamic.length,0,`Dynamic route declarations require review: ${JSON.stringify(result.dynamic)}`);
  assert.equal(result.unmappedCount,baseline.unmapped.length);
  assert.deepEqual(result.resolved,[],'Resolved routes must be removed from the review baseline');
  assert.ok(result.protectedRouteCount>400);
  assert.ok(result.mappedCount>300);
  assert.ok(result.platformAdminCount>50);
  assert.ok(baseline.unmapped.every(route=>route.status==='review_required'));
});
test('canonical legacy aliases use the same role permission classification',()=>{
  const routes=routeInventory().routes;
  const get=(mount,path,method)=>routes.find(route=>route.mount===mount&&route.path===path&&route.method===method);
  assert.equal(get('/api/inbox','/get_chats','GET')?.permission,'conversations.read');
  assert.equal(get('/api/workspace/inbox','/get_chats','GET')?.permission,'conversations.read');
  assert.equal(get('/api/chat_flow','/add_new','POST')?.permission,'automation.manage');
  assert.equal(get('/api/workspace/automation/flows','/add_new','POST')?.permission,'automation.manage');
  assert.equal(get('/api/v1','/get_logs','GET')?.permission,'tenant.manage');
  assert.equal(get('/api/v1','/delete_logs','POST')?.permission,'tenant.manage');
});
