'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const navigation=require('../modules/platform/navigation'),{trainingCenter}=require('../modules/platform/categories');
const context=permissions=>({audience:'tenant',identity:{id:'identity'},tenant:{id:'tenant',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:'member',tenantId:'tenant',role:'agent',status:'active',customPermissions:permissions,assignedNavigation:null},category:trainingCenter,subscription:{status:'active',capabilities:trainingCenter.capabilities}});
test('Lead Reports does not unlock Finance Reports without invoice read permission',()=>{
  const plain=navigation.navigationFor(context(['reports.read']));
  assert.ok(plain.some(item=>item.key==='reports'));assert.ok(!plain.some(item=>item.key==='finance-reports'));
  const finance=navigation.navigationFor(context(['reports.read','invoices.read']));assert.ok(finance.some(item=>item.key==='finance-reports'));
});
test('role sidebar choices only reduce permitted screens and retain explicit empty selection',async()=>{
  const ctx=context(['reports.read','courses.read']);ctx.membership.roleProfileId='profile';
  const permitted=navigation.navigationFor(ctx);
  const db={query:async(sql,args)=>{assert.match(sql,/tenant_id=\? AND id=\?/);assert.deepEqual(args,['tenant','profile']);return [[{sidebarNavigation:'["courses","invoices"]'}]];}};
  assert.deepEqual((await navigation.sidebarForMembership(db,ctx,permitted)).map(item=>item.key),['courses']);
  assert.deepEqual(navigation.filterSidebar(permitted,[]),[]);
  assert.throws(()=>navigation.parseSidebar('["unknown-screen"]'),{code:'INVALID_ROLE_NAVIGATION'});
  assert.throws(()=>navigation.parseSidebar(['courses','courses']),{code:'INVALID_ROLE_NAVIGATION'});
  await assert.rejects(navigation.sidebarForMembership({query:async()=>[[]]},ctx,permitted),{code:'PERMISSION_DENIED'});
});
test('screen catalogue names match existing sidebar labels without internal duplicate screens',()=>{
  const expected={reports:'Lead Reports','finance-reports':'Finance Reports',forms:'Candidate Applications',students:'Students',invoices:'Invoices & Payments',tasks:'Tasks',notifications:'Web Notifications'};
  for(const [key,name]of Object.entries(expected))assert.equal(navigation.items.find(item=>item.key===key).label.en,name);
  for(const key of ['batches','installments','payments','receipts'])assert.equal(navigation.items.find(item=>item.key===key).sidebar,false);
});

test('screen catalogue has unique labels and keeps owner profile out of agent navigation',()=>{
  const labels=navigation.items.filter(item=>item.sidebar!==false).map(item=>item.label.en);
  assert.equal(new Set(labels).size,labels.length);
  assert.ok(!navigation.navigationFor(context(['courses.read','courses.manage'])).some(item=>item.key==='training-profile'));
});
