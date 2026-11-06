'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const policy=require('../modules/platform/policy');
const navigation=require('../modules/platform/navigation');
const category=require('../modules/platform/categories').getCategory('retail_boutique',1);
const guard=require('../modules/platform/team-role-request-guard');

function context(role){
  return {audience:'tenant',tenant:{id:'retail-tenant',status:'active',categoryKey:category.key,categoryVersion:category.version},
    membership:{id:'membership-'+role,tenantId:'retail-tenant',status:'active',role},category,
    subscription:{status:'active',capabilities:[...category.capabilities]}};
}

test('retail reconciliation is owner and accountant scoped in the existing category panel',()=>{
  for(const role of ['owner','accountant']){
    assert.equal(policy.decision(context(role),{capability:'retail.finance',permission:'retail.finance'}).allowed,true);
    assert.ok(navigation.navigationFor(context(role)).some(item=>item.key==='retail-finance'));
  }
  for(const role of ['manager','agent']){
    assert.equal(policy.decision(context(role),{capability:'retail.finance',permission:'retail.finance'}).allowed,false);
    assert.ok(!navigation.navigationFor(context(role)).some(item=>item.key==='retail-finance'));
  }
});

test('retail cash collection, order returns, and finance routes map to narrow actions',()=>{
  const route=(path,method='POST')=>guard.routePermission({baseUrl:'/api/workspace/retail',path,method});
  assert.equal(route('/orders/abc/cash-received'),'retail.cash.collect');
  assert.equal(route('/deliveries/abc/cash-received'),'retail.deliver');
  assert.equal(route('/orders/abc/returns'),'retail.returns');
  assert.equal(route('/finance'),'retail.finance');
  assert.equal(route('/finance/settlements'),'retail.finance');
  assert.equal(policy.decision(context('agent'),{capability:'retail.commerce',permission:'retail.cash.collect'}).scope,'assigned');
  assert.equal(policy.decision(context('agent'),{capability:'retail.commerce',permission:'retail.returns'}).allowed,false);
});

test('retail commerce changes remain outside other category contracts',()=>{
  for(const name of ['trainingCenter','salemaxSales','baseCrm']){
    assert.equal(require('../modules/platform/categories')[name].capabilities.includes('retail.commerce'),false);
  }
});
