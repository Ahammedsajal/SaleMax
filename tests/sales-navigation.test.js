'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const navigation=require('../modules/platform/navigation');
const {salemaxSales}=require('../modules/platform/categories');

function context(role,customPermissions){
  return {audience:'tenant',tenant:{id:'tenant-1',status:'active',categoryKey:salemaxSales.key,categoryVersion:salemaxSales.version},
    category:salemaxSales,subscription:{status:'active',capabilities:[...salemaxSales.capabilities]},
    membership:{id:`${role}-1`,tenantId:'tenant-1',role,status:'active',customPermissions}};
}

test('Sales organization navigation is offered only to the owner, manager and team leader seats',()=>{
  for(const role of ['owner','manager','team_leader']){
    const items=navigation.navigationFor(context(role));
    assert.ok(items.some(item=>item.key==='sales-organization'),`${role} should see Organization`);
  }
  for(const role of ['agent','accountant']){
    const items=navigation.navigationFor(context(role));
    assert.ok(!items.some(item=>item.key==='sales-organization'),`${role} should not see Organization`);
  }
});

test('custom role restrictions can hide the Organization navigation entry without changing the read API boundary',()=>{
  const items=navigation.navigationFor(context('manager',['leads.read']));
  assert.ok(!items.some(item=>item.key==='sales-organization'));
});

test('Organization is connected to the existing user shell and the tenant-scoped Sales API',()=>{
  const root=path.join(__dirname,'..');
  const sidebar=fs.readFileSync(path.join(root,'client/public/training-sidebar.js'),'utf8');
  const shell=fs.readFileSync(path.join(root,'client/public/pipeline-entry.js'),'utf8');
  const page=fs.readFileSync(path.join(root,'client/public/sales-organization/index.html'),'utf8');
  const client=fs.readFileSync(path.join(root,'client/public/sales-organization/sales-organization.js'),'utf8');
  const router=fs.readFileSync(path.join(root,'modules/platform/sales-organization-router.js'),'utf8');
  assert.match(sidebar,/membershipCategoryKey=data\?\.data\?\.categoryKey/);
  assert.match(sidebar,/roleNavigation\?\.has\('sales-organization'\)/);
  assert.match(sidebar,/sales-organization/);
  assert.match(shell,/isSalesOrganizationRoute/);
  assert.match(shell,/\/sales-organization\/\?embed=1/);
  assert.match(page,/sales-organization\.js\?v=20261013-org2/);
  assert.match(client,/\/api\/user\/sales-organization/);
  assert.match(client,/teamLeaderMembershipId/);
  assert.match(client,/\$\('#teamAccess'\)\.hidden=state\.role!=='owner'/);
  assert.match(client,/addEventListener\('storage'/);
  assert.match(router,/organization\.list\(db,req\.businessContext\)/);
  assert.match(router,/organization\.reassign\(db,req\.businessContext/);
});
