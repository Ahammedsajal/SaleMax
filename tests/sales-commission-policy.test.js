'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const policy=require('../modules/platform/sales-commission-policy');
const {getCategory}=require('../modules/platform/categories');

function context(role='owner'){
  const category=getCategory('salemax_sales',1),tenantId='11111111-1111-4111-8111-111111111111';
  return {audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:category.key,categoryVersion:category.version},
    membership:{id:'22222222-2222-4222-8222-222222222222',tenantId,role,status:'active'},identity:{id:'33333333-3333-4333-8333-333333333333'},
    category,subscription:{status:'active',capabilities:[...category.capabilities]}};
}

test('commission draft policy validates role split, versions it, and writes an audit record in one transaction',async()=>{
  const calls=[];let committed=false;
  const productId='55555555-5555-4555-8555-555555555555';
  const db={async beginTransaction(){},async commit(){committed=true;},async rollback(){},async query(sql,args){calls.push({sql,args});
    if(sql.includes('SELECT id FROM sx_tenants'))return [[{id:args[0]}],[]];
    if(sql.includes('SELECT id FROM sx_sales_products'))return [[{id:productId}],[]];
    if(sql.includes('COALESCE(MAX(version)'))return [[{version:4}],[]];
    return [{affectedRows:1},[]];
  }};
  const result=await policy.createDraft(db,context(),{products:[{productId,agentRateBps:450,teamLeaderRateBps:150,managerRateBps:100}]});
  assert.equal(result.version,5);assert.equal(result.status,'draft');assert.equal(result.productCount,1);assert.equal(committed,true);
  assert.ok(calls.some(call=>call.sql.includes('INSERT INTO sx_sales_commission_policies')));
  assert.ok(calls.some(call=>call.sql.includes('INSERT INTO sx_sales_commission_policy_rates')));
  assert.ok(calls.some(call=>call.sql.includes('INSERT INTO sx_audit_events')&&call.args[3]==='sales.commission_policy.draft_created'));
  await assert.rejects(policy.createDraft(db,context(),{products:[{productId,agentRateBps:9000,teamLeaderRateBps:2000,managerRateBps:0}]}),error=>error.code==='COMMISSION_SPLIT_EXCEEDS_SALE');
});

test('commission policy remains owner-only even when accountant has commission review access',async()=>{
  const c=context('accountant');let queried=false;const db={async query(){queried=true;return [[],[]];}};
  await assert.rejects(policy.list(db,c),error=>error.code==='PERMISSION_DENIED');
  assert.equal(queried,false);
});

test('approving a draft retires the previous version and keeps the new version audit-linked',async()=>{
  const calls=[];let committed=false;
  const db={async beginTransaction(){},async commit(){committed=true;},async rollback(){},async query(sql,args){calls.push({sql,args});
    if(sql.includes('SELECT id FROM sx_tenants'))return [[{id:args[0]}],[]];
    if(sql.includes('SELECT id,version,status FROM sx_sales_commission_policies'))return [[{id:args[1],version:6,status:'draft'}],[]];
    if(sql.includes('SELECT p.id FROM sx_sales_products'))return [[],[]];
    if(sql.includes('SELECT COUNT(*) AS n FROM sx_sales_commission_policy_rates'))return [[{n:1}],[]];
    if(sql.includes('SELECT r.product_id AS productId'))return [[{productId:'55555555-5555-4555-8555-555555555555',agentRateBps:400,teamLeaderRateBps:100,managerRateBps:100}],[]];
    return [{affectedRows:1},[]];
  }};
  const result=await policy.approve(db,context(),'44444444-4444-4444-8444-444444444444');
  assert.equal(result.status,'approved');assert.equal(result.version,6);assert.equal(result.productCount,1);assert.equal(committed,true);
  assert.ok(calls.some(call=>call.sql.includes("SET status='retired',active_tenant_id=NULL")));
  assert.ok(calls.some(call=>call.sql.includes("SET status='approved',active_tenant_id=tenant_id")));
  assert.ok(calls.some(call=>call.sql.includes('INSERT INTO sx_audit_events')&&call.args[3]==='sales.commission_policy.approved'));
});
