'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const express=require('express');
const pilot=require('../modules/platform/retail-connector-pilot');
const navigation=require('../modules/platform/navigation');
const category=require('../modules/platform/categories').getCategory('retail_boutique',1);

const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherTenantId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const connectionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const pilotEnv={SALEMAX_RETAIL_CONNECTOR_PILOT_TENANTS:tenantId};

function ownerContext(id=tenantId){return {audience:'tenant',identity:{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'},category,
  tenant:{id,status:'active',categoryKey:category.key,categoryVersion:category.version},
  membership:{id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',tenantId:id,status:'active',role:'owner'},
  subscription:{status:'active',capabilities:category.capabilities}};}

test('Retail connector pilot allowlist defaults to deny and ignores malformed tenant identifiers',()=>{
  assert.equal(pilot.isPilotTenant(tenantId,{}),false);
  assert.equal(pilot.isPilotTenant(tenantId,{[pilot.ENV_KEY]:` ${tenantId.toUpperCase()} ,not-a-tenant, * `}),true);
  assert.equal(pilot.isPilotTenant(otherTenantId,{[pilot.ENV_KEY]:tenantId}),false);
  assert.equal(pilot.isPilotTenant(tenantId,{[pilot.ENV_KEY]:'x'.repeat(4097)}),false);
});

test('Connected Stores navigation is visible only for an allowlisted pilot tenant',()=>{
  const context=ownerContext();
  assert.equal(navigation.navigationFor(context,{}).some(item=>item.key==='retail-connected-stores'),false);
  assert.equal(navigation.navigationFor(context,pilotEnv).some(item=>item.key==='retail-connected-stores'),true);
  assert.equal(navigation.navigationFor(ownerContext(otherTenantId),pilotEnv).some(item=>item.key==='retail-connected-stores'),false);
});

test('Connected Stores workspace API denies a non-pilot tenant before database access',async t=>{
  const calls=[];
  const pool={async query(sql,params){calls.push({sql,params});return [[],[]];}};
  const app=express();
  app.use('/connectors',require('../modules/platform/retail-connected-stores-router').workspaceRouter({
    pool,origin:'https://workspace.example.invalid',env:{},authenticate(req,_res,next){req.businessContext=ownerContext();next();},
  }));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/connectors/`);
  const body=await response.json();
  assert.equal(response.status,403);
  assert.equal(body.code,'RETAIL_CONNECTOR_PILOT_DISABLED');
  assert.equal(calls.length,0);
});

test('signed webhook endpoint rejects non-pilot connections before signature or event processing',async t=>{
  const calls=[],connection={id:connectionId,tenant_id:tenantId,provider:'woocommerce',status:'active'};
  const pool={async query(sql,params){
    calls.push({sql,params});
    if(sql.includes('FROM sx_retail_store_connections WHERE id=? AND provider=?'))return [[connection],[]];
    throw new Error('Unexpected webhook query: '+sql);
  }};
  const app=express();
  app.use('/connectors',require('../modules/platform/retail-connected-stores-router').publicRouter({
    pool,origin:'https://workspace.example.invalid',env:{},authenticate(_req,_res,next){next();},
  }));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/connectors/woocommerce/${connectionId}`,{
    method:'POST',headers:{'content-type':'application/json'},body:'{}',
  });
  assert.equal(response.status,404);
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/SELECT tenant_id FROM sx_retail_store_connections/);
  assert.doesNotMatch(calls[0].sql,/credentials_ciphertext|webhook_secret_ciphertext/);
});
