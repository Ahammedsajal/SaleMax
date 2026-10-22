'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const audit=require('../modules/platform/sales-audit');
const navigation=require('../modules/platform/navigation');
const {salemaxSales}=require('../modules/platform/categories');

function context(role='owner',overrides={}){return{audience:'tenant',identity:{id:'identity-1'},tenant:{id:'tenant-1',status:'active',categoryKey:'7network_sales',categoryVersion:1},membership:{id:`${role}-1`,tenantId:'tenant-1',role,status:'active'},category:salemaxSales,subscription:{status:'active',capabilities:[...salemaxSales.capabilities]},...overrides}}
function fakeDb(rows){return{calls:[],async query(sql,args){this.calls.push({sql,args});return[rows]}}}

test('Sales Audit is visible to Business Admin only and uses the existing settings entitlement',()=>{
  const owner=navigation.navigationFor(context('owner'));
  assert.ok(owner.some(item=>item.key==='sales-audit'));
  for(const role of ['manager','team_leader','agent','accountant'])assert.ok(!navigation.navigationFor(context(role)).some(item=>item.key==='sales-audit'));
  assert.equal(salemaxSales.capabilities.includes('tenant.settings'),true);
  assert.doesNotThrow(()=>audit.assertAccess(context('owner',{tenant:{...context().tenant,categoryKey:'salemax_sales'}})));
});

test('audit queries are tenant-scoped, newest-first, bounded, and return a cursor for older rows',async()=>{
  const first={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',actorKind:'identity',action:'sales.target.updated',resourceType:'sales-target',reason:'Monthly target review',changes:{period:'2026-10',targetMinor:'500000'},occurredAt:new Date('2026-10-13T10:20:30.123Z'),actorName:'Business Admin'};
  const extra={...first,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',occurredAt:new Date('2026-10-13T10:19:30.123Z')};
  const db=fakeDb([first,extra]);const result=await audit.list(db,context(),{limit:1,from:'2026-10-01',to:'2026-10-31',action:'sales.target.updated'});
  assert.equal(result.items.length,1);assert.ok(result.nextCursor);
  assert.match(db.calls[0].sql,/e\.tenant_id=\?/);assert.match(db.calls[0].sql,/ORDER BY e\.occurred_at DESC,e\.id DESC LIMIT \?/);
  assert.deepEqual(db.calls[0].args.slice(0,4),['tenant-1','2026-10-01 00:00:00.000','2026-11-01 00:00:00.000','sales.target.updated']);
  const decoded=audit.cursorDecode(result.nextCursor);assert.equal(decoded.id,first.id);assert.equal(decoded.occurredAt,'2026-10-13 10:20:30.123');
});

test('audit access denies non-owners before reading and rejects malformed filters',async()=>{
  const db=fakeDb([]);await assert.rejects(audit.list(db,context('manager'),{}),{code:'PERMISSION_DENIED'});assert.equal(db.calls.length,0);
  await assert.rejects(audit.list(db,context('owner',{membership:{id:'owner-1',tenantId:'tenant-1',role:'owner',status:'active',assignedNavigation:['dashboard']}}),{}),{code:'PERMISSION_DENIED'});assert.equal(db.calls.length,0);
  await assert.rejects(audit.list(db,context(),{from:'2026-02-31'}),{code:'INVALID_AUDIT_FILTER'});assert.equal(db.calls.length,0);
  await assert.rejects(audit.list(db,context(),{action:'sales.target.updated OR 1=1'}),{code:'INVALID_AUDIT_FILTER'});assert.equal(db.calls.length,0);
});

test('audit event details recursively omit credentials and recording secrets',()=>{
  const clean=audit.scrub({target:'QAR 500',apiToken:'secret',recordingUrl:'/private/audio',nested:{password:'hidden',role:'agent'}});
  assert.deepEqual(clean,{target:'QAR 500',nested:{role:'agent'}});
});

test('owner Audit Trail is mounted in the existing user shell with bilingual responsive controls',()=>{
  const root=path.resolve(__dirname,'..');
  const mount=fs.readFileSync(path.join(root,'modules/platform/mount-existing-upgrade.js'),'utf8');
  const sidebar=fs.readFileSync(path.join(root,'client/public/training-sidebar.js'),'utf8');
  const shell=fs.readFileSync(path.join(root,'client/public/pipeline-entry.js'),'utf8');
  const page=fs.readFileSync(path.join(root,'client/public/sales-audit/index.html'),'utf8');
  const client=fs.readFileSync(path.join(root,'client/public/sales-audit/sales-audit.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'client/public/sales-audit/sales-audit.css'),'utf8');
  assert.match(mount,/\/api\/user\/sales-audit/);assert.match(mount,/createSalesAuditRouter/);
  assert.match(sidebar,/roleNavigation\?\.has\('sales-audit'\)/);assert.match(sidebar,/page=sales-audit/);
  assert.match(shell,/isSalesAuditRoute/);assert.match(shell,/sales-audit\/\?embed=1/);
  assert.match(page,/id="filters"/);assert.match(client,/سجل التدقيق/);assert.match(client,/before/);assert.match(css,/@media\(max-width:760px\)/);
});

