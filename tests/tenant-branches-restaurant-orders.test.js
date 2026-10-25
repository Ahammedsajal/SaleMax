'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const branches=require('../modules/platform/tenant-branches');

test('a restaurant branch with live orders cannot be deactivated',async()=>{
  let rolledBack=false,updated=false;
  const ctx={audience:'tenant',identity:{id:'11111111-1111-4111-8111-111111111111'},tenant:{id:'22222222-2222-4222-8222-222222222222',categoryKey:'restaurant_cafe',status:'active'},membership:{id:'33333333-3333-4333-8333-333333333333',tenantId:'22222222-2222-4222-8222-222222222222',role:'owner',status:'active'}};
  const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rolledBack=true;},query:async sql=>{
    if(sql.startsWith('SELECT revision,status FROM sx_tenant_branches'))return [[{revision:1,status:'active'}]];
    if(sql.startsWith('SELECT COUNT(*) AS total FROM sx_restaurant_orders'))return [[{total:1}]];
    if(sql.startsWith('UPDATE sx_tenant_branches')){updated=true;return [{affectedRows:1}];}
    throw new Error(`Unexpected SQL: ${sql}`);
  }};
  await assert.rejects(branches.update(db,ctx,'44444444-4444-4444-8444-444444444444',{slug:'doha',nameEn:'Doha',status:'inactive',expectedRevision:1}),{code:'BRANCH_HAS_OPEN_RESTAURANT_ORDERS'});
  assert.equal(rolledBack,true);assert.equal(updated,false);
});
