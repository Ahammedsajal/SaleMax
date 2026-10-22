'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const categories=require('../modules/platform/categories');
const plans=require('../modules/platform/plans');

test('7Network Sales is canonical while the former category key remains a read alias',()=>{
  const current=categories.getCategory('7network_sales',1);
  assert.equal(current.key,'7network_sales');
  assert.equal(current.title.en,'7Network Sales');
  assert.equal(categories.getCategory('salemax_sales',1),current);
  assert.equal(categories.categoryKeyMatches('salemax_sales','7network_sales'),true);
  assert.deepEqual(categories.categoryKeysFor('7network_sales'),['7network_sales','salemax_sales']);
  assert.deepEqual(categories.listCategories().map(category=>category.key).filter(key=>key.includes('sales')),['7network_sales']);
});

test('an assigned immutable v1 SaleMaX plan version still grants entitlements to a renamed tenant',async()=>{
  let sql='';
  const db={query:async statement=>{
    sql=statement;
    return [[{id:'assignment-1',status:'active',role_limits:{owner:1,accountant:2,manager:3,team_leader:4,agent:5},
      capabilities:['messaging.inbox','team.members'],category_key:'salemax_sales',category_version:1,current_period:1}]];
  }};
  const entitlements=await plans.loadEntitlements(db,'00000000-0000-4000-8000-000000000001');
  assert.match(sql,/t\.category_key='7network_sales' AND p\.category_key='salemax_sales'/);
  assert.equal(entitlements.categoryKey,'7network_sales');
  assert.equal(entitlements.roleLimits.agent,5);
  assert.ok(entitlements.capabilities.includes('messaging.inbox'));
});

test('central policy accepts a preserved tenant category alias against canonical category and entitlement keys',()=>{
  const category=categories.getCategory('7network_sales',1);
  const context={audience:'tenant',tenant:{id:'tenant-a',status:'active',categoryKey:'salemax_sales',categoryVersion:1},
    membership:{id:'owner-a',tenantId:'tenant-a',role:'owner',status:'active'},category,
    subscription:{status:'active',categoryKey:'7network_sales',categoryVersion:1,capabilities:[...category.capabilities]}};
  assert.deepEqual(require('../modules/platform/policy').decision(context,{capability:'sales.deals',permission:'deals.read'}),{allowed:true,scope:'tenant'});
  assert.equal(context.tenant.categoryKey,'salemax_sales','the compatibility alias remains represented in source data');
});
