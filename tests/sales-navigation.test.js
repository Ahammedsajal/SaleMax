'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const navigation=require('../modules/platform/navigation');
const {salemaxSales}=require('../modules/platform/categories');
const salesReportCsv=require('../client/public/sales-workspace/sales-report-csv');

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

test('Sales Overview uses the monthly target entitlement for sales roles and excludes accountants',()=>{
  for(const role of ['owner','manager','team_leader','agent']){
    assert.ok(navigation.navigationFor(context(role)).some(item=>item.key==='sales-targets'),`${role} should have the scoped Overview data entitlement`);
  }
  assert.ok(!navigation.navigationFor(context('accountant')).some(item=>item.key==='sales-targets'));
  assert.ok(!navigation.navigationFor(context('manager',['leads.read'])).some(item=>item.key==='sales-targets'));
});

test('Sales Overview is integrated into existing navigation, refreshes scoped APIs and keeps nested routes in the parent URL',()=>{
  const root=path.join(__dirname,'..');
  const sidebar=fs.readFileSync(path.join(root,'client/public/training-sidebar.js'),'utf8');
  const shell=fs.readFileSync(path.join(root,'client/public/pipeline-entry.js'),'utf8');
  const page=fs.readFileSync(path.join(root,'client/public/sales-workspace/index.html'),'utf8');
  const client=fs.readFileSync(path.join(root,'client/public/sales-workspace/sales-workspace.js'),'utf8');
  assert.match(sidebar,/data-sx-sales-overview-nav/);
  assert.match(sidebar,/membershipRole\]\|\|\['Sales Overview'/);
  assert.match(sidebar,/section=overview/);
  assert.match(shell,/overview:\['نظرة عامة على المبيعات','Sales Overview'\]/);
  assert.match(shell,/requestedSection=.*section/);
  assert.match(shell,/\['overview','deals','commissions','targets','reports'\]/);
  assert.match(page,/id="overviewSection"/);
  assert.match(page,/sales-report-csv\.js\?v=20261013-report2/);
  assert.match(page,/sales-workspace\.js\?v=20261014-followups2/);
  assert.match(page,/sales-workspace-reports\.css\?v=20261013-report2/);
  assert.match(client,/\/api\/user\/team-invitations\/sidebar-access/);
  assert.match(client,/\/follow-ups\?period=all/);
  assert.match(client,/\/api\/user\/sales-targets\?period=/);
  assert.match(client,/\/api\/user\/call-center\/calls/);
  assert.match(client,/window\.top\.history\.pushState/);
  assert.match(client,/moneyLines\(member\.targets\?\.salesByCurrency/);
});

test('Sales Overview shows scoped priority follow-ups and opens the real follow-up queue',()=>{
  const root=path.join(__dirname,'..');
  const page=fs.readFileSync(path.join(root,'client/public/sales-workspace/index.html'),'utf8');
  const client=fs.readFileSync(path.join(root,'client/public/sales-workspace/sales-workspace.js'),'utf8');
  const shell=fs.readFileSync(path.join(root,'client/public/pipeline-entry.js'),'utf8');
  const pipeline=fs.readFileSync(path.join(root,'client/public/pipeline/reports.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'client/public/sales-workspace/sales-workspace.css'),'utf8');
  assert.match(page,/id="followupPrioritiesPanel"/);
  assert.match(page,/timezone-datetime\.js/);
  assert.match(client,/\/follow-ups\?period=all&page=1&limit=8/);
  assert.match(client,/renderPriorityFollowups\(hasNav\('leads'\)\)/);
  assert.ok(client.indexOf("renderPriorityFollowups(hasNav('leads'))")<client.indexOf("if(role==='accountant')"),'hide the Leads panel before the Finance-only accountant overview returns');
  assert.match(client,/panel\.hidden=!allowed/);
  assert.match(client,/item\.next_follow_up_at/);
  assert.match(client,/item\.due_revision|item\.lead_id/);
  assert.match(shell,/pipelineView\(\)/);
  assert.match(shell,/&view='\+encodeURIComponent\(pipelineView\(\)\)/);
  assert.match(pipeline,/get\('view'\)==='followups'\)setView\('followups'\)/);
  assert.match(css,/\.priority-row/);
});

test('Sales Reports reuse the scoped monthly target entitlement and parent-panel navigation',()=>{
  for(const role of ['owner','manager','team_leader','agent'])assert.ok(navigation.navigationFor(context(role)).some(item=>item.key==='sales-targets'));
  const root=path.join(__dirname,'..');
  const sidebar=fs.readFileSync(path.join(root,'client/public/training-sidebar.js'),'utf8');
  const shell=fs.readFileSync(path.join(root,'client/public/pipeline-entry.js'),'utf8');
  const index=fs.readFileSync(path.join(root,'client/public/index.html'),'utf8');
  const page=fs.readFileSync(path.join(root,'client/public/sales-workspace/index.html'),'utf8');
  const client=fs.readFileSync(path.join(root,'client/public/sales-workspace/sales-workspace.js'),'utf8');
  assert.match(sidebar,/\['Sales Reports','تقارير المبيعات','sales-targets','reports'\]/);
  assert.match(sidebar,/reports:'sales-targets'/);
  assert.match(shell,/reports:\['تقارير المبيعات','Sales Reports'\]/);
  assert.match(index,/training-sidebar\.js\?v=20261014-sales-audit1/);
  assert.match(index,/pipeline-entry\.js\?v=20261014-followups1/);
  assert.match(page,/id="reportsSection"/);
  assert.match(page,/id="reportPeriod"/);
  assert.match(client,/state\.section==='reports'/);
  assert.match(client,/\/api\/user\/sales-targets\?period=/);
  assert.match(client,/SaleMaXSalesReportCsv\.toCsv/);
  assert.match(client,/state\.targetsPeriod!==period/);
});

test('monthly sales CSV keeps multiple currencies exact, quotes data, and neutralizes spreadsheet formulas',()=>{
  const csv=salesReportCsv.toCsv('2026-10',[{displayName:'=HYPERLINK("x","agent"), A',role:'agent',actual:{connectedCalls:8},targets:{connectedCalls:'12',salesByCurrency:[
    {currency:'INR',actualMinor:'15750',targetMinor:'20000'},
    {currency:'JPY',actualMinor:'900',targetMinor:null},
  ]}}]);
  assert.ok(csv.startsWith('\uFEFF"report_month","team_member","role"'));
  assert.match(csv,/'=HYPERLINK\(""x"",""agent""\), A/);
  assert.match(csv,/"2026-10","'=HYPERLINK/);
  assert.match(csv,/"INR","157\.50","200\.00"/);
  assert.match(csv,/"JPY","900",""/);
  assert.equal((csv.match(/\r\n/g)||[]).length,3);
  assert.throws(()=>salesReportCsv.toCsv('2026-13',[]),/Invalid report period/);
  assert.throws(()=>salesReportCsv.toCsv('2026-10',[{actual:{connectedCalls:'=2'}}]),/Invalid connected calls/);
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
