'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const deals=require('../modules/platform/sales-deals'),category=require('../modules/platform/categories').salemaxSales;

test('Sales Deals reads through the preserved tenant category alias without widening owner scope',async()=>{
  const tenantId='11111111-1111-4111-8111-111111111111',context={audience:'tenant',identity:{id:'identity-owner'},
    tenant:{id:tenantId,status:'active',categoryKey:'salemax_sales',categoryVersion:1},
    membership:{id:'owner-member',tenantId,role:'owner',status:'active'},category,
    subscription:{status:'active',categoryKey:'7network_sales',categoryVersion:1,capabilities:[...category.capabilities]}};
  let query;
  const result=await deals.listDeals({query:async(sql,args)=>{query={sql,args};return [[]];}},context);
  assert.deepEqual(result.items,[]);assert.deepEqual(result.permissions,{canSubmit:true,canApprove:true});
  assert.match(query.sql,/WHERE d\.tenant_id=\?/);assert.deepEqual(query.args,[tenantId,50]);
});
