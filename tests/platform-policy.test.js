const test = require('node:test');
const assert = require('node:assert/strict');
const { decision, platformDecision, capabilities, permissions } = require('../modules/platform/policy');
const { trainingCenter, salemaxSales, realEstate, restaurantFixture } = require('../modules/platform/categories');
const { navigationFor } = require('../modules/platform/navigation');
const { canAgentAccessLead } = require('../helper/pipeline/access');
test('Real Estate workflow authorization contracts are defined without granting them to existing categories',()=>{
  const expected={
    'realestate.parties':['parties.read','parties.manage'],
    'realestate.requirements':['requirements.read','requirements.manage','requirements.assign'],
    'realestate.viewings':['viewings.read','viewings.manage','viewings.assign'],
  };
  for(const [capability,permissionList] of Object.entries(expected)) {
    assert.deepEqual(capabilities[capability],permissionList);
    for(const permission of permissionList) assert.equal(Object.hasOwn(permissions,permission),true,permission);
    assert.equal(trainingCenter.capabilities.includes(capability),false,capability);
    assert.equal(salemaxSales.capabilities.includes(capability),false,capability);
  }
});
test('Real Estate requirement and viewing permissions apply team scopes to managers and preserve assignment authority',()=>{
 const capabilitiesForRole=['realestate.requirements','realestate.viewings'];
 const category={...realEstate,capabilities:[...realEstate.capabilities,...capabilitiesForRole]};
 const tenant={id:'realestate-tenant',status:'active',categoryKey:category.key,categoryVersion:category.version};
 const contextFor=role=>({audience:'tenant',tenant,membership:{id:`${role}-member`,tenantId:tenant.id,role,status:'active'},category,subscription:{status:'active',categoryKey:category.key,categoryVersion:category.version,capabilities:capabilitiesForRole}});
 for(const capability of capabilitiesForRole){
  const prefix=capability==='realestate.requirements'?'requirements':'viewings';
  for(const [permission,expected] of [['read','team'],['manage','team']])assert.equal(decision(contextFor('manager'),{capability,permission:`${prefix}.${permission}`}).scope,expected);
  assert.equal(decision(contextFor('owner'),{capability,permission:`${prefix}.read`}).scope,'tenant');
  assert.equal(decision(contextFor('team_leader'),{capability,permission:`${prefix}.read`}).scope,'team');
  assert.equal(decision(contextFor('agent'),{capability,permission:`${prefix}.read`}).scope,'assigned');
 }
 assert.equal(decision(contextFor('manager'),{capability:'realestate.requirements',permission:'requirements.assign'}).scope,'tenant');
 assert.equal(decision(contextFor('agent'),{capability:'realestate.requirements',permission:'requirements.assign'}).allowed,false);
 for(const capability of capabilitiesForRole){
  const prefix=capability==='realestate.requirements'?'requirements':'viewings';
  for(const permission of [`${prefix}.manage`,`${prefix}.assign`])for(const role of ['team_leader','agent']){
   const delegated={...contextFor(role),membership:{...contextFor(role).membership,customPermissions:[permission]}};
   assert.equal(decision(delegated,{capability,permission}).allowed,false,`${role} must not receive ${permission}`);
  }
  for(const role of ['team_leader','agent']){
   const customRead=`${prefix}.read`,delegated={...contextFor(role),membership:{...contextFor(role).membership,customPermissions:[customRead]}};
   assert.equal(decision(delegated,{capability,permission:customRead}).scope,role==='agent'?'assigned':'team');
  }
 }
});
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
test('7Network Sales accountants are finance-only while Training Center billing-linked lead access remains compatible',()=>{
  const c=context('accountant');
  c.category=salemaxSales;c.tenant.categoryKey=salemaxSales.key;c.tenant.categoryVersion=salemaxSales.version;
  c.subscription.capabilities=[...salemaxSales.capabilities];
  c.membership.assignedNavigation=['leads','contacts','sales-finance','sales-commissions','reports'];
  for(const [capability,permission] of [['crm.leads','leads.read'],['crm.contacts','contacts.read']]){
    assert.equal(decision(c,{capability,permission,resource:{tenantId:'tenant-a',billingLinked:true}}).code,'PERMISSION_DENIED');
  }
  assert.equal(decision(c,{capability:'sales.finance',permission:'sales.finance.read'}).scope,'finance');
  assert.equal(decision(c,{capability:'sales.commissions',permission:'commissions.read'}).scope,'finance');
  assert.equal(decision(c,{capability:'reports.read',permission:'reports.read'}).scope,'finance');
  assert.equal(navigationFor(c).some(item=>['leads','contacts'].includes(item.key)),false);
  assert.equal(decision(context('accountant'),{capability:'crm.leads',permission:'leads.read',resource:{tenantId:'tenant-a',billingLinked:true}}).scope,'billing');
});
test('manager receipt authority does not grant credit approval or owner authority',()=>{
  const c=context('manager'); c.membership.delegatedPermissions=['payments.verify','credits.approve','channels.configure'];
  assert.equal(decision(c,{capability:'finance.payments',permission:'payments.verify'}).allowed,true);
  assert.equal(decision(c,{capability:'finance.credits',permission:'credits.approve'}).allowed,false);
  assert.equal(decision(c,{capability:'messaging.meta',permission:'channels.configure'}).allowed,true);
});
test('custom staff roles cannot elevate approval authority beyond their fixed seat role',()=>{
  const cases=[
    ['agent','training.enrollments','sales.approve'],
    ['team_leader','training.enrollments','sales.approve'],
    ['manager','finance.credits','credits.approve'],
  ];
  for(const [role,capability,permission] of cases){
    const c=context(role);c.membership.customPermissions=[permission];
    assert.equal(decision(c,{capability,permission}).code,'PERMISSION_DENIED',`${role} must not receive ${permission}`);
  }
  const manager=context('manager');manager.membership.customPermissions=['sales.approve'];
  assert.equal(decision(manager,{capability:'training.enrollments',permission:'sales.approve'}).allowed,true);
  const accountant=context('accountant');accountant.membership.customPermissions=['commission.payout.approve'];
  const salesContext=role=>{const c=context(role);c.category=salemaxSales;c.tenant.categoryKey=salemaxSales.key;c.subscription.capabilities=[...salemaxSales.capabilities];return c;};
  for(const [role,permission] of [['manager','commission.policy.manage'],['manager','commission.payout.approve'],['agent','commission.payout.pay']]){
    const c=salesContext(role);c.membership.customPermissions=[permission];
    assert.equal(decision(c,{capability:'sales.commissions',permission}).code,'PERMISSION_DENIED',`${role} must not receive ${permission}`);
  }
  assert.equal(decision(salesContext('accountant'),{capability:'sales.commissions',permission:'commission.payout.approve'}).allowed,true);
});
test('Training Center managers can manage tenant team access within the team.members entitlement',()=>{
  const c=context('manager');
  assert.equal(decision(c,{capability:'team.members',permission:'team.invite'}).scope,'tenant');
  c.membership.customPermissions=[];
  assert.equal(decision(c,{capability:'team.members',permission:'team.invite'}).code,'PERMISSION_DENIED');
  c.membership.customPermissions=null;
  c.subscription.capabilities=c.subscription.capabilities.filter(capability=>capability!=='team.members');
  assert.equal(decision(c,{capability:'team.members',permission:'team.invite'}).code,'FEATURE_UNAVAILABLE');
  const sales={...context('manager'),category:salemaxSales};
  sales.tenant.categoryKey=salemaxSales.key;sales.subscription.capabilities=[...salemaxSales.capabilities];
  assert.equal(decision(sales,{capability:'team.members',permission:'team.invite'}).scope,'tenant');
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
test('7Network Sales team leaders receive team-scoped sales, call, task and report navigation',()=>{
  const sales={...context('team_leader'),category:salemaxSales};
  sales.tenant.categoryKey=salemaxSales.key;
  sales.subscription.capabilities=[...salemaxSales.capabilities];
  const items=navigationFor(sales);
  for(const key of ['leads','contacts','tasks','call-center','reports','team'])assert.ok(items.some(item=>item.key===key),key);
  assert.ok(!items.some(item=>['dashboard','courses','invoices','payments','settings'].includes(item.key)));
  assert.equal(decision(sales,{capability:'crm.leads',permission:'leads.read'}).scope,'team');
  assert.equal(decision(sales,{capability:'telephony.call-center',permission:'calls.read'}).scope,'team');
  assert.equal(decision(sales,{capability:'reports.read',permission:'reports.read'}).scope,'team');
});
test('7Network Sales deal and commission permissions follow role boundaries and stay outside Training Center',()=>{
  const roleContext=role=>{const sales={...context(role),category:salemaxSales};sales.tenant.categoryKey=salemaxSales.key;sales.subscription.capabilities=[...salemaxSales.capabilities];return sales;};
  assert.equal(decision(roleContext('owner'),{capability:'sales.deals',permission:'deals.approve'}).allowed,true);
  assert.equal(decision(roleContext('agent'),{capability:'sales.deals',permission:'deals.request'}).scope,'assigned');
  assert.equal(decision(roleContext('team_leader'),{capability:'sales.deals',permission:'deals.read'}).scope,'team');
  assert.equal(decision(roleContext('accountant'),{capability:'sales.commissions',permission:'commissions.read'}).scope,'finance');
  assert.equal(decision(roleContext('accountant'),{capability:'sales.deals',permission:'deals.read'}).allowed,false);
  assert.equal(decision(roleContext('accountant'),{capability:'sales.commissions',permission:'commission.policy.manage'}).allowed,false);
  assert.equal(decision(roleContext('manager'),{capability:'sales.commissions',permission:'commission.payout.pay'}).allowed,false);
  assert.equal(decision(context('owner'),{capability:'sales.deals',permission:'deals.approve'}).code,'CATEGORY_UNAVAILABLE');
});

test('real-estate inventory scopes agents and team leaders to assigned listings',()=>{
  const realEstate=require('../modules/platform/categories').realEstate;
  for(const role of ['owner','manager','team_leader','agent']){
    const c=context(role);c.category=realEstate;c.tenant.categoryKey=realEstate.key;c.tenant.categoryVersion=realEstate.version;
    c.subscription.capabilities=[...realEstate.capabilities];c.membership.customPermissions=['properties.read','properties.manage'];
    const result=decision(c,{capability:'realestate.listings',permission:'properties.read'});
    assert.equal(result.allowed,true,role);
    assert.equal(result.scope,{owner:'tenant',manager:'tenant',team_leader:'team',agent:'assigned'}[role],role);
    const nav=navigationFor(c).map(item=>item.key);
    assert.equal(nav.includes('properties'),true,role);
    assert.equal(decision(c,{capability:'realestate.listings',permission:'properties.manage'}).allowed,['owner','manager'].includes(role),role);
  }
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
