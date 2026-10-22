'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const navigation=require('../modules/platform/navigation');
const legacyRoleGuard=require('../modules/platform/team-role-request-guard');
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

test('Sales workspace exposes only each role assigned sections and keeps accountants out of sales reporting tabs',()=>{
  const expected={owner:['sales-deals','sales-commissions','sales-targets','sales-finance'],manager:['sales-deals','sales-commissions','sales-targets','sales-finance'],team_leader:['sales-deals','sales-commissions','sales-targets'],agent:['sales-deals','sales-commissions','sales-targets'],accountant:['sales-commissions','sales-finance']};
  for(const [role,keys] of Object.entries(expected)){const actual=navigation.navigationFor(context(role)).map(item=>item.key);for(const key of keys)assert.ok(actual.includes(key),`${role} should retain ${key}`);}
  const accountant=navigation.navigationFor(context('accountant')).map(item=>item.key);
  assert.deepEqual(accountant,['sales-commissions','sales-finance']);
  for(const key of ['sales-deals','sales-targets','sales-organization','sales-audit','commission-policy'])assert.ok(!accountant.includes(key),`accountant should not receive ${key}`);
});

test('default 7Network Sales Accountant membership is limited to existing shell bootstrap on legacy APIs',()=>{
  const rows=['7network_sales','salemax_sales'].map(categoryKey=>({categoryKey,role:'accountant',roleProfileId:null}));
  const request=(method,path,baseUrl='/api/user')=>({method,path,baseUrl});
  for(const row of rows){
    for(const path of ['/get_me','/fetch_profile','/get_plan_details','/optional-features','/get_fcm_data'])
      assert.equal(legacyRoleGuard.authorizeLegacyMembership(request('GET',path),row).allowed,true,`${row.categoryKey} ${path}`);
    for(const req of [request('GET','/get_dashboard'),request('GET','/get_contact'),request('POST','/update_profile'),request('GET','/get_me','/api/phonebook')])
      assert.deepEqual(legacyRoleGuard.authorizeLegacyMembership(req,row),{allowed:false,code:'PERMISSION_DENIED'},row.categoryKey);
  }
});

test('shared QR list is read with inbox permission while QR mutations still require channel management',()=>{
  const request=(method,path)=>({method,path,baseUrl:'/api/qr'});
  assert.equal(legacyRoleGuard.routePermission(request('GET','/get_all')),'conversations.read');
  assert.equal(legacyRoleGuard.routePermission(request('POST','/delete')),'channels.configure');
  assert.equal(legacyRoleGuard.routePermission(request('GET','/get_all_agent')),'channels.configure');
});

test('Sales workspace loads permissions before section APIs, hides unauthorized tabs and blocks direct unauthorized sections',()=>{
  const root=path.join(__dirname,'..');
  const client=fs.readFileSync(path.join(root,'client/public/sales-workspace/sales-workspace.js'),'utf8');
  const page=fs.readFileSync(path.join(root,'client/public/sales-workspace/index.html'),'utf8');
  assert.match(client,/sectionPermissions=\{overview:\['sales-targets','sales-finance'\],deals:\['sales-deals'\],targets:\['sales-targets'\],reports:\['sales-targets'\],commissions:\['sales-commissions'\]\}/);
  assert.match(client,/button\.hidden=!allowed/);
  assert.match(client,/if\(!canViewSection\(state\.section\)\)\{showAccessDenied\(\);message\('error'/);
  assert.match(client,/state\.assignedNavigation===null\|\|state\.assignedNavigation\.includes\(key\)/);
  assert.ok(client.indexOf('const access=await salesAccess()')<client.indexOf('api(`/deals?status='),'role navigation must load before protected section requests');
  assert.match(client,/showAccessDenied\(\);el\('overviewAlertsPanel'\)\.hidden=true/);
  assert.match(page,/id="accessDeniedSection"[^>]+role="region"/);
  assert.match(page,/id="accessDeniedReturn"/);
});

test('duplicate pipeline, reports and call navigation is removed for every business category',()=>{
  const sidebar=fs.readFileSync(path.join(__dirname,'..','client/public/training-sidebar.js'),'utf8');
  assert.match(sidebar,/function dedupeSalesNavigationRows\(list\)/);
  assert.match(sidebar,/const key=navigationIdentity\(row\)/);
  assert.ok(sidebar.includes("key==='sales-targets'?key+':'+section:key"));
  assert.match(sidebar,/dedupeSalesNavigationRows\(list\)/);
  assert.doesNotMatch(sidebar,/function dedupeSalesNavigationRows\(list\)\{\s*if\(membershipCategoryKey!==['"]7network_sales/);
  assert.match(sidebar,/['"]Calls & Recordings['"]:\s*['"]Call Center['"]/);
});

test('only first-party Sales receives role-specific sidebar labels and grouped navigation',()=>{
  const root=path.join(__dirname,'..');
  const sidebar=fs.readFileSync(path.join(root,'client/public/training-sidebar.js'),'utf8');
  const shell=fs.readFileSync(path.join(root,'client/public/index.html'),'utf8');
  assert.match(sidebar,/overview:\{owner:\['Business Overview','نظرة عامة على الأعمال'\]/);
  assert.match(sidebar,/organization:\{owner:\['Organization','الهيكل التنظيمي'\],manager:\['My Teams','فرقي'\],team_leader:\['My Team','فريقي'\]/);
  assert.match(sidebar,/calls:\{owner:\['Calls & Recordings','المكالمات والتسجيلات'\],manager:\['Call Review','مراجعة المكالمات'\],team_leader:\['Call Coaching','تدريب المكالمات'\]/);
  assert.match(sidebar,/deals:\{owner:\['Sales Deals','صفقات المبيعات'\],manager:\['Team Deals','صفقات الفريق'\],team_leader:\['Team Deals','صفقات الفريق'\],agent:\['My Deals','صفقاتي'\]/);
  assert.match(sidebar,/commissions:\{owner:\['Sales Commissions','عمولات المبيعات'\],manager:\['Team Commissions','عمولات الفريق'\],team_leader:\['Team Commissions','عمولات الفريق'\],agent:\['My Commission','عمولتي'\],accountant:\['Commission Payouts'/);
  assert.match(sidebar,/membershipCategoryKey==='7network_sales'\?\(salesNavLabels\.calls/);
  assert.match(sidebar,/if\(membershipCategoryKey==='7network_sales'\)applySalesRoleAliases\(\)/);
  assert.match(sidebar,/membershipCategoryKey==='7network_sales'&&index===11\?/);
  assert.match(shell,/training-sidebar\.js\?v=[^"\s]+/);
});

test('Sales sidebar recovers contract-permitted entries when the legacy shell omits them',()=>{
  const root=path.join(__dirname,'..');
  const sidebar=fs.readFileSync(path.join(root,'client/public/training-sidebar.js'),'utf8');
  const owner=navigation.navigationFor(context('owner')).map(item=>item.key);
  for(const key of ['products-services','call-center','tasks','campaigns','sales-finance'])assert.ok(owner.includes(key),`owner navigation contract should permit ${key}`);
  assert.match(sidebar,/function ensureSalesNavigationRows\(list\)/);
  assert.match(sidebar,/roleNavigation\?\.has\('call-center'\)/);
  assert.match(sidebar,/!salesContractAllows/);
});

test('Sales sidebar deduplicates legacy and generated Lead Pipeline, Lead Reports and Calls rows',()=>{
  const root=path.join(__dirname,'..');
  const sidebar=fs.readFileSync(path.join(root,'client/public/training-sidebar.js'),'utf8');
  assert.match(sidebar,/function hasNavigationKey\(list,key,section='overview'\)/);
  assert.match(sidebar,/!hasNavigationKey\(list,'reports'\)/);
  assert.match(sidebar,/!hasNavigationKey\(list,'call-center'\)/);
  assert.match(sidebar,/function dedupeSalesNavigationRows\(list\)/);
  assert.match(sidebar,/else if\(generatedNavigationRow\(row\)\)row\.remove\(\)/);
  assert.ok(sidebar.indexOf('dedupeSalesNavigationRows(list);')>sidebar.indexOf('ensureSalesNavigationRows(list);'));
});

test('7Network Sales owner gets one People & Roles entry while managers and team leaders use their scoped Organisation screen',()=>{
  const root=path.join(__dirname,'..');
  const sidebar=fs.readFileSync(path.join(root,'client/public/training-sidebar.js'),'utf8');
  const team=fs.readFileSync(path.join(root,'client/public/team-invitations.js'),'utf8');
  const shell=fs.readFileSync(path.join(root,'client/public/index.html'),'utf8');
  assert.match(sidebar,/membershipRole==='owner'\)\{\s*aliases\['Team access'\]='People & Roles'/);
  assert.match(sidebar,/name==='People & Roles'\)group=11/);
  assert.match(sidebar,/name==='Agent Login'\|\|\(name==='Team access'&&membershipRole!=='owner'\)/);
  assert.match(sidebar,/'People & Roles':'team'/);
  assert.match(team,/organisation\.role!=='owner'\)\{location\.replace\('\/user\?page=sales-organization'\);return;\}/);
  assert.match(team,/label\('People & Roles','الأشخاص والأدوار'\)/);
  assert.match(team,/node\.dataset\.salesCategory='7network_sales'/);
  assert.match(team,/#sx-team-screen\[data-sales-category=\"7network_sales\"\] :focus-visible\{outline-color:#1768d4\}/);
  assert.match(shell,/training-sidebar\.js\?v=[^"\s]+/);
  assert.match(shell,/team-invitations\.js\?v=20261022-agent-password-reset1/);
});

test('Sales Overview is integrated into existing navigation, refreshes scoped APIs and keeps nested routes in the parent URL',()=>{
  const root=path.join(__dirname,'..');
  const sidebar=fs.readFileSync(path.join(root,'client/public/training-sidebar.js'),'utf8');
  const shell=fs.readFileSync(path.join(root,'client/public/pipeline-entry.js'),'utf8');
  const page=fs.readFileSync(path.join(root,'client/public/sales-workspace/index.html'),'utf8');
  const client=fs.readFileSync(path.join(root,'client/public/sales-workspace/sales-workspace.js'),'utf8');
  assert.match(sidebar,/data-sx-sales-overview-nav/);
  assert.match(sidebar,/salesNavLabels\.overview\[membershipRole\]/);
  assert.match(sidebar,/section=overview/);
  assert.match(shell,/overview:\['نظرة عامة على المبيعات','Sales Overview'\]/);
  assert.match(shell,/requestedSection=.*section/);
  assert.match(shell,/\['overview','deals','commissions','targets','reports'\]/);
  assert.match(page,/id="overviewSection"/);
  assert.match(page,/sales-report-csv\.js\?v=20261014-commission-breakdown1/);
  assert.match(page,/sales-workspace\.js\?v=[a-zA-Z0-9-]+/);
  assert.match(page,/sales-workspace-reports\.css\?v=20261014-commissions1/);
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
  const reportCss=fs.readFileSync(path.join(root,'client/public/sales-workspace/sales-workspace-reports.css'),'utf8');
  assert.match(sidebar,/\['reports','sales-targets','reports'\]/);
  assert.match(sidebar,/reports:'sales-targets'/);
  assert.match(shell,/reports:\['تقارير المبيعات','Sales Reports'\]/);
  assert.match(index,/training-sidebar\.js\?v=[^"\s]+/);
  assert.match(index,/pipeline-entry\.js\?v=[^"\s]+/);
  assert.match(page,/id="reportsSection"/);
  assert.match(page,/id="reportPeriod"/);
  assert.match(client,/state\.section==='reports'/);
  assert.match(client,/\/api\/user\/sales-targets\?period=/);
  assert.match(client,/SaleMaXSalesReportCsv\.toCsv/);
  assert.match(client,/state\.targetsPeriod!==period/);
  assert.match(page,/id="reportCommissionPaidHeading"/);
  assert.match(client,/commissionReportEnabled/);
  assert.match(client,/reportCommissionApproved/);
  assert.match(reportCss,/position:\s*sticky/);
  assert.match(reportCss,/var\(--sx-brand-soft\)/);
});

test('monthly sales CSV keeps multiple currencies exact, quotes data, and neutralizes spreadsheet formulas',()=>{
  const csv=salesReportCsv.toCsv('2026-10',[{displayName:'=HYPERLINK("x","agent"), A',role:'agent',actual:{connectedCalls:8},targets:{connectedCalls:'12',salesByCurrency:[
    {currency:'INR',actualMinor:'15750',targetMinor:'20000'},
    {currency:'JPY',actualMinor:'900',targetMinor:null},
  ]},commissionsByCurrency:[
    {currency:'INR',draftMinor:'1250',approvedMinor:'500',paidMinor:'750'},
    {currency:'JPY',draftMinor:'0',approvedMinor:'0',paidMinor:'0'},
  ]}]);
  assert.ok(csv.startsWith('\uFEFF"report_month","team_member","role"'));
  assert.match(csv,/"commission_draft","commission_approved","commission_paid"/);
  assert.match(csv,/'=HYPERLINK\(""x"",""agent""\), A/);
  assert.match(csv,/"2026-10","'=HYPERLINK/);
  assert.match(csv,/"INR","157\.50","200\.00"/);
  assert.match(csv,/"INR","157\.50","200\.00","12\.50","5\.00","7\.50"/);
  assert.match(csv,/"JPY","900","","0","0","0"/);
  assert.deepEqual(salesReportCsv.rowsFor('2026-10',[{displayName:'A',role:'agent',actual:{connectedCalls:0},targets:{salesByCurrency:[]},commissionsByCurrency:[{currency:'USD',draftMinor:'125',approvedMinor:'0',paidMinor:'0'}]}])[0].slice(8),['1.25','0.00','0.00']);
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
