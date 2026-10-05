const test = require('node:test');
const assert = require('node:assert/strict');
const { decision, platformDecision, capabilities } = require('../modules/platform/policy');
const { trainingCenter, restaurantFixture } = require('../modules/platform/categories');
const { navigationFor } = require('../modules/platform/navigation');
const { canAgentAccessLead } = require('../helper/pipeline/access');
function context(role='owner') {
  return { audience:'tenant',tenant:{id:'tenant-a',status:'active',categoryKey:trainingCenter.key,categoryVersion:1},membership:{id:'member-a',tenantId:'tenant-a',role,status:'active',delegatedPermissions:[]},subscription:{status:'active',capabilities:Object.keys(capabilities)},category:trainingCenter,runtimeReady:{} };
}
test('every tenant role is denied another business record, including owner',()=>{
  for(const role of ['owner','accountant','manager','agent']) {
    const result=decision(context(role),{capability:'crm.leads',permission:'leads.read',resource:{tenantId:'tenant-b',assignedMembershipId:'member-a',billingLinked:true}});
    assert.equal(result.code,'RESOURCE_NOT_FOUND');
  }
});
test('agents cannot read unassigned leads, tenant finance or another agents report',()=>{
  const c=context('agent');
  assert.equal(decision(c,{capability:'crm.leads',permission:'leads.read',resource:{tenantId:'tenant-a',assignedMembershipId:'member-b'}}).allowed,false);
  assert.equal(decision(c,{capability:'crm.leads',permission:'leads.read',resource:{tenantId:'tenant-a',assignedMembershipId:'member-a'}}).allowed,true);
  assert.equal(decision(c,{capability:'finance.invoices',permission:'invoices.read'}).allowed,false);
  assert.equal(decision(c,{capability:'reports.read',permission:'reports.read',resource:{tenantId:'tenant-a',subjectMembershipId:'member-b'}}).allowed,false);
  assert.equal(decision(c,{capability:'reports.read',permission:'reports.read',resource:{tenantId:'tenant-a',subjectMembershipId:'member-a'}}).scope,'own');
});
test('legacy pipeline agents must own a lead before reading or changing it',()=>{
  assert.equal(canAgentAccessLead(12,12),true);
  assert.equal(canAgentAccessLead(12,null),false);
  assert.equal(canAgentAccessLead(12,13),false);
  assert.equal(canAgentAccessLead(0,0),false);
});
test('accountants can verify payments but only read billing-linked leads',()=>{
  const c=context('accountant');
  assert.equal(decision(c,{capability:'finance.payments',permission:'payments.verify'}).allowed,true);
  assert.equal(decision(c,{capability:'crm.leads',permission:'leads.read',resource:{tenantId:'tenant-a',billingLinked:false}}).allowed,false);
  assert.equal(decision(c,{capability:'crm.leads',permission:'leads.read',resource:{tenantId:'tenant-a',billingLinked:true}}).scope,'billing');
});
test('manager delegations cannot become financial or owner authority',()=>{
  const c=context('manager'); c.membership.delegatedPermissions=['payments.verify','credits.approve','channels.configure'];
  assert.equal(decision(c,{capability:'finance.payments',permission:'payments.verify'}).allowed,false);
  assert.equal(decision(c,{capability:'finance.credits',permission:'credits.approve'}).allowed,false);
  assert.equal(decision(c,{capability:'messaging.meta',permission:'channels.configure'}).allowed,true);
});
test('category, plan, inactive state and provider readiness remain separate gates',()=>{
  const request={capability:'training.courses',permission:'courses.read'};
  const fixture=context(); fixture.category=restaurantFixture; fixture.tenant.categoryKey=restaurantFixture.key;
  assert.equal(decision(fixture,request).code,'CATEGORY_UNAVAILABLE');
  const missing=context(); missing.subscription.capabilities=[];
  assert.equal(decision(missing,request).code,'FEATURE_UNAVAILABLE');
  for(const target of ['tenant','membership']) {const c=context(); c[target].status='inactive'; assert.equal(decision(c,request).allowed,false);}
  const external=context();
  assert.equal(decision(external,{capability:'messaging.meta',permission:'channels.configure',external:true}).code,'PROVIDER_NOT_READY');
  external.runtimeReady['messaging.meta']=true;
  assert.equal(decision(external,{capability:'messaging.meta',permission:'channels.configure',external:true}).allowed,true);
  assert.equal(decision(context(),{capability:'crm.leads',permission:'payments.verify'}).allowed,false);
});
test('navigation reflects backend decisions and future category fixture excludes training',()=>{
  const agent=navigationFor(context('agent'));
  assert.ok(agent.some(i=>i.key==='leads'));
  assert.ok(!agent.some(i=>['payments','invoices','settings'].includes(i.key)));
  const fixture=context(); fixture.category=restaurantFixture; fixture.tenant.categoryKey=restaurantFixture.key;
  assert.ok(!navigationFor(fixture).some(i=>i.key==='courses'));
  const stale=context(); stale.membership.tenantId='tenant-b'; assert.deepEqual(navigationFor(stale),[]);
});
test('member navigation assignment hides unselected sections and denies their canonical APIs',()=>{
  const c=context('agent');c.membership.assignedNavigation=['tasks'];
  assert.equal(decision(c,{capability:'team.tasks',permission:'tasks.read'}).allowed,true);
  assert.equal(decision(c,{capability:'crm.leads',permission:'leads.read',resource:{tenantId:'tenant-a',assignedMembershipId:'member-a'}}).code,'PERMISSION_DENIED');
  const keys=navigationFor(c).map(item=>item.key);
  assert.ok(keys.includes('tasks'));
  assert.ok(!keys.includes('leads'));
  c.membership.assignedNavigation=[];
  assert.deepEqual(navigationFor(c),[]);
});
test('malformed capability assignments and unknown roles fail closed',()=>{
  const request={capability:'training.courses',permission:'courses.read'};
  for(const malformed of [null,{},'training.courses']) {
    const c=context();c.category={...trainingCenter,capabilities:malformed};
    assert.equal(decision(c,request).allowed,false);
    const s=context();s.subscription.capabilities=malformed;
    assert.equal(decision(s,request).allowed,false);
  }
  for(const role of ['constructor','toString','super_admin','staff'])assert.equal(decision(context(role),request).allowed,false);
});
test('platform access requires separate audience, MFA and explicit staff grants',()=>{
  const tenant=context(); tenant.membership.role='super_admin'; tenant.mfaVerified=true;
  assert.equal(platformDecision(tenant,'tenants.create'),false);
  const staff={audience:'platform',mfaVerified:true,membership:{role:'staff',status:'active',delegatedPermissions:['tenants.create','owner.recover']}};
  assert.equal(platformDecision(staff,'tenants.create'),true);
  assert.equal(platformDecision(staff,'owner.recover'),false);
  const owner={audience:'platform',mfaVerified:true,recentlyAuthenticated:true,membership:{role:'super_admin',status:'active'}};
  assert.equal(platformDecision(owner,'owner.recover'),true);
  assert.equal(platformDecision(owner,'invented.permission'),false);
  owner.recentlyAuthenticated=false; assert.equal(platformDecision(owner,'owner.recover'),true);
  owner.mfaVerified=false; assert.equal(platformDecision(owner,'tenants.create'),false);
});
test('platform Admin authority covers platform operations but never owner-only controls',()=>{
  const admin={audience:'platform',mfaVerified:true,membership:{role:'platform_admin',status:'active'}};
  for(const permission of ['tenants.read','tenants.create','tenants.manage','tenants.category-change','plans.read','plans.draft','plans.assign','plans.publish','bots.assign'])assert.equal(platformDecision(admin,permission),true,permission);
  for(const permission of ['staff.manage','owner.recover','owner.transfer','providers.configure','tenants.owner-transfer','audit.read','invented.permission'])assert.equal(platformDecision(admin,permission),false,permission);
  admin.mfaVerified=false;assert.equal(platformDecision(admin,'tenants.read'),false);
});
