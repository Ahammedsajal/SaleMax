'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const targets=require('../modules/platform/sales-targets');
const categories=require('../modules/platform/categories');
const {decision}=require('../modules/platform/policy');

function context(role='owner',overrides={}){
  const id='10000000-0000-4000-8000-000000000001';
  return {audience:'tenant',tenant:{id,status:'active',categoryKey:'7network_sales',categoryVersion:1},
    identity:{id:'20000000-0000-4000-8000-000000000001'},
    membership:{id,tenantId:id,status:'active',role,...overrides.membership},
    category:{key:'7network_sales',version:1,capabilities:['sales.targets']},
    subscription:{status:'active',capabilities:['sales.targets','team.members']},...overrides};
}
function fakeDb(handler){
  const calls=[];
  return {calls,async query(sql,params=[]){calls.push({sql,params});return handler(sql,params);},
    async beginTransaction(){calls.push({sql:'BEGIN'});},async commit(){calls.push({sql:'COMMIT'});},async rollback(){calls.push({sql:'ROLLBACK'});}};
}

test('target periods accept only exact calendar months',()=>{
  assert.equal(targets.parsePeriod('2026-10').start,'2026-10-01');
  for(const value of ['2026-00','2026-13','2026-1','26-10','2026-10-01'])assert.throws(()=>targets.parsePeriod(value),{code:'INVALID_TARGET_PERIOD'});
});

test('accountants and inactive roles cannot read the sales target workspace',async()=>{
  let queried=false;
  const db=fakeDb(()=>{queried=true;return [[],[]];});
  await assert.rejects(targets.list(db,context('accountant'),'2026-10'),{code:'PERMISSION_DENIED'});
  assert.equal(queried,false);
});

test('target capability is internal 7Network Sales only and role scoped',()=>{
  assert.equal(categories.getCategory('7network_sales',1).capabilities.includes('sales.targets'),true);
  assert.equal(categories.getCategory('training_center',1).capabilities.includes('sales.targets'),false);
  assert.equal(decision(context('team_leader'),{capability:'sales.targets',permission:'targets.read'}).scope,'team');
  assert.equal(decision(context('agent'),{capability:'sales.targets',permission:'targets.read'}).scope,'own');
  assert.equal(decision(context('accountant'),{capability:'sales.targets',permission:'targets.read'}).allowed,false);
  assert.equal(decision(context('team_leader'),{capability:'sales.targets',permission:'targets.manage'}).allowed,false);
});

test('manager performance uses historical deal and call attribution across team moves and keeps currencies separate',async()=>{
  const manager='10000000-0000-4000-8000-000000000002',agent='10000000-0000-4000-8000-000000000003',formerAgent='10000000-0000-4000-8000-000000000004';
  const db=fakeDb(sql=>{
    if(sql.includes('SELECT m.id AS membershipId'))return [[{membershipId:manager,role:'manager',displayName:'Manager'},{membershipId:agent,role:'agent',displayName:'Agent',managerMembershipId:manager}],[]];
    if(sql.includes('SELECT CAST(? AS DATE)'))return [[{starts_at:'2026-10-01',ends_at:'2026-11-01'}],[]];
    if(sql.includes('FROM sx_sales_targets'))return [[{membershipId:agent,metric:'connected_calls',currency:'---',targetValue:'40'},{membershipId:agent,metric:'sales_amount',currency:'QAR',targetValue:'100000'}],[]];
    if(sql.includes('FROM sx_sales_deals'))return [[{membershipId:agent,managerMembershipId:manager,currency:'QAR',actualMinor:'25000'},{membershipId:agent,managerMembershipId:manager,currency:'INR',actualMinor:'50000'},{membershipId:formerAgent,managerMembershipId:manager,currency:'QAR',actualMinor:'75000'}],[]];
    if(sql.includes('FROM sx_telephony_calls'))return [[{membershipId:agent,managerMembershipId:manager,actualCalls:12},{membershipId:formerAgent,managerMembershipId:manager,actualCalls:8}],[]];
    throw Error(`Unexpected query: ${sql}`);
  });
  const result=await targets.list(db,context('manager'), '2026-10');
  assert.equal(result.canManage,true);
  assert.equal(result.members.length,2);
  const row=result.members.find(item=>item.membershipId===agent);
  assert.equal(row.targets.connectedCalls,'40');
  assert.equal(row.actual.connectedCalls,12);
  assert.deepEqual(row.targets.salesByCurrency,[{currency:'INR',actualMinor:'50000',targetMinor:null},{currency:'QAR',actualMinor:'25000',targetMinor:'100000'}]);
  const managerRow=result.members.find(item=>item.membershipId===manager);
  assert.equal(managerRow.actual.connectedCalls,20);
  assert.deepEqual(managerRow.targets.salesByCurrency,[{currency:'INR',actualMinor:'50000',targetMinor:null},{currency:'QAR',actualMinor:'100000',targetMinor:null}]);
});

test('monthly manager reports add commission status totals for the historical team scope',async()=>{
  const manager='10000000-0000-4000-8000-000000000002',agent='10000000-0000-4000-8000-000000000003';
  const ctx=context('manager',{category:{key:'7network_sales',version:1,capabilities:['sales.targets','sales.commissions']},subscription:{status:'active',capabilities:['sales.targets','sales.commissions','team.members']}});
  ctx.membership.id=manager;
  const db=fakeDb(sql=>{
    if(sql.includes('SELECT m.id AS membershipId'))return [[{membershipId:manager,role:'manager',displayName:'Manager'},{membershipId:agent,role:'agent',displayName:'Agent',managerMembershipId:manager}],[]];
    if(sql.includes('SELECT CAST(? AS DATE)'))return [[{starts_at:'2026-10-01',ends_at:'2026-11-01'}],[]];
    if(sql.includes('FROM sx_sales_targets'))return [[],[]];
    if(sql.includes('FROM sx_sales_deals'))return [[],[]];
    if(sql.includes('FROM sx_telephony_calls'))return [[],[]];
    if(sql.includes('FROM sx_sales_commissions'))return [[
      {recipientMembershipId:agent,managerMembershipId:manager,teamLeaderMembershipId:null,currency:'INR',draftMinor:'100',approvedMinor:'50',paidMinor:'20'},
      {recipientMembershipId:'10000000-0000-4000-8000-000000000008',managerMembershipId:manager,teamLeaderMembershipId:null,currency:'INR',draftMinor:'25',approvedMinor:'10',paidMinor:'5'},
    ],[]];
    throw Error(`Unexpected query: ${sql}`);
  });
  const result=await targets.list(db,ctx,'2026-10');
  assert.equal(result.commissionReportEnabled,true);
  assert.match(db.calls.find(call=>call.sql.includes('FROM sx_sales_commissions')).sql,/AND d\.manager_membership_id=\?/);
  assert.equal(db.calls.find(call=>call.sql.includes('FROM sx_sales_commissions')).params.at(-1),manager);
  assert.deepEqual(result.members.find(row=>row.membershipId===agent).commissionsByCurrency,[{currency:'INR',draftMinor:'100',approvedMinor:'50',paidMinor:'20'}]);
  assert.deepEqual(result.members.find(row=>row.membershipId===manager).commissionsByCurrency,[{currency:'INR',draftMinor:'125',approvedMinor:'60',paidMinor:'25'}]);
});

test('reports omit commission amounts when the commission capability is not assigned',async()=>{
  const agent='10000000-0000-4000-8000-000000000003';let commissionQuery=false;
  const db=fakeDb(sql=>{
    if(sql.includes('SELECT m.id AS membershipId'))return [[{membershipId:agent,role:'agent',displayName:'Agent'}],[]];
    if(sql.includes('SELECT CAST(? AS DATE)'))return [[{starts_at:'2026-10-01',ends_at:'2026-11-01'}],[]];
    if(sql.includes('FROM sx_sales_targets'))return [[],[]];
    if(sql.includes('FROM sx_sales_deals'))return [[],[]];
    if(sql.includes('FROM sx_telephony_calls'))return [[],[]];
    if(sql.includes('FROM sx_sales_commissions'))commissionQuery=true;
    throw Error(`Unexpected query: ${sql}`);
  });
  const result=await targets.list(db,context('agent'),'2026-10');
  assert.equal(result.commissionReportEnabled,false);
  assert.equal(commissionQuery,false);
  assert.deepEqual(result.members[0].commissionsByCurrency,[]);
});

test('agents can view their scoped targets but cannot change them',async()=>{
  const agent='10000000-0000-4000-8000-000000000001';
  const db=fakeDb(sql=>{
    if(sql.includes('SELECT m.id AS membershipId'))return [[{membershipId:agent,role:'agent',displayName:'Agent'}],[]];
    if(sql.includes('SELECT CAST(? AS DATE)'))return [[{starts_at:'2026-10-01',ends_at:'2026-11-01'}],[]];
    if(sql.includes('FROM sx_sales_targets'))return [[],[]];
    if(sql.includes('FROM sx_sales_deals'))return [[],[]];
    if(sql.includes('FROM sx_telephony_calls'))return [[],[]];
    throw Error(`Unexpected query: ${sql}`);
  });
  const result=await targets.list(db,context('agent'),'2026-10');
  assert.equal(result.canManage,false);
  assert.equal(result.members[0].membershipId,agent);
  await assert.rejects(targets.save(db,context('agent'),agent,{period:'2026-10',metric:'connected_calls',targetValue:'12'}),{code:'PERMISSION_DENIED'});
  assert.equal(db.calls.some(call=>call.sql==='BEGIN'),false);
});

test('manager cannot set a target outside their live organisation scope',async()=>{
  const member='10000000-0000-4000-8000-000000000003';
  const db=fakeDb(sql=>{
    if(sql.includes('SELECT id FROM sx_tenants'))return [[{id:'tenant'}],[]];
    if(sql.includes('SELECT m.id,m.role'))return [[{id:member,role:'agent'}],[]];
    if(sql.includes('SELECT manager_membership_id'))return [[{manager_membership_id:'foreign-manager'}],[]];
    throw Error(`Unexpected query: ${sql}`);
  });
  await assert.rejects(targets.save(db,context('manager'),member,{period:'2026-10',metric:'connected_calls',targetValue:'12'}),{code:'PERMISSION_DENIED'});
  assert.equal(db.calls.some(call=>call.sql==='ROLLBACK'),true);
  assert.equal(db.calls.some(call=>call.sql.includes('INSERT INTO sx_audit_events')),false);
});

test('target update is tenant scoped, idempotent and audited',async()=>{
  const member='10000000-0000-4000-8000-000000000003';
  const db=fakeDb(sql=>{
    if(sql.includes('SELECT id FROM sx_tenants'))return [[{id:'tenant'}],[]];
    if(sql.includes('SELECT m.id,m.role'))return [[{id:member,role:'agent'}],[]];
    if(sql.includes('SELECT target_value AS targetValue'))return [[{targetValue:'20'}],[]];
    if(sql.includes('INSERT INTO sx_sales_targets'))return [{affectedRows:1},[]];
    if(sql.includes('INSERT INTO sx_audit_events'))return [{affectedRows:1},[]];
    throw Error(`Unexpected query: ${sql}`);
  });
  const result=await targets.save(db,context('owner'),member,{period:'2026-10',metric:'connected_calls',targetValue:'30'});
  assert.deepEqual(result,{membershipId:member,period:'2026-10',metric:'connected_calls',currency:'---',targetValue:'30'});
  const write=db.calls.find(call=>call.sql.includes('INSERT INTO sx_sales_targets'));
  assert.equal(write.params[1],context('owner').tenant.id);
  assert.equal(write.params[6],'30');
  const audit=db.calls.find(call=>call.sql.includes('INSERT INTO sx_audit_events'));
  assert.match(audit.params[3],/^sales\.target\.updated$/);
  assert.equal(db.calls.at(-1).sql,'COMMIT');
});
