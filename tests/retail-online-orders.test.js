'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const express=require('express');
const category=require('../modules/platform/categories').getCategory('retail_boutique',1);
const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const row={connectionId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',provider:'woocommerce',storeName:'Essentials by D',
  connectionStatus:'active',externalOrderId:'9001',orderNumber:'EB-9001',status:'processing',financialStatus:'paid_reported_by_store',
  currency:'QAR',totalAmount:'150.250000',subtotalAmount:'140.000000',discountAmount:'0.000000',shippingAmount:'5.000000',
  taxAmount:'5.250000',refundAmount:'0.000000',orderDate:'2026-11-17T12:00:00.000000Z',dateBasis:'source_created',lastSyncAt:'2026-11-17T12:30:00.000Z'};

function appFor(role='manager'){
  const calls=[];
  const pool={async query(sql,params){
    calls.push({sql,params});
    if(sql.includes('FROM sx_retail_external_orders o JOIN sx_retail_store_connections s'))return [[row],[]];
    throw new Error('Unexpected query: '+sql);
  }};
  const app=express();
  app.use('/api/workspace/retail',require('../modules/platform/retail-commerce-router').workspaceRouter({pool,authenticate(req,_res,next){
    const selectedRole=req.get('x-test-role')||role;
    req.businessContext={audience:'tenant',identity:{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},category,
      tenant:{id:req.get('x-test-tenant')||tenantId,status:'active',categoryKey:category.key,categoryVersion:category.version},
      membership:{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',tenantId:req.get('x-test-tenant')||tenantId,status:'active',role:selectedRole},
      subscription:{status:'active',capabilities:category.capabilities}};
    next();
  }}));
  return {app,calls};
}

test('Retail Orders exposes a paged, read-only store-order summary without customer PII',async t=>{
  const fixture=appFor(),server=fixture.app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/workspace/retail/orders/online/search`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      from:'2026-11-01T00:00:00.000Z',to:'2026-12-01T00:00:00.000Z',order:'EB-9',status:'processing',page:0,
    })});
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.data.orders.length,1);
  assert.deepEqual(body.data.orders[0],{
    source:'connected_store',connectionId:row.connectionId,provider:'woocommerce',storeName:'Essentials by D',connectionStatus:'active',
    externalOrderId:'9001',orderNumber:'EB-9001',status:'processing',financialStatus:'paid_reported_by_store',currency:'QAR',totalAmount:'150.250000',
    breakdown:{subtotal:'140.000000',discount:'0.000000',shipping:'5.000000',tax:'5.250000',refunds:'0.000000'},
    orderDate:row.orderDate,dateBasis:'source_created',lastSyncAt:row.lastSyncAt,
  });
  assert.equal(Object.hasOwn(body.data.orders[0],'customer'),false);
  assert.equal(fixture.calls.length,1);
  assert.match(fixture.calls[0].sql,/o\.tenant_id=\?/);
  assert.match(fixture.calls[0].sql,/o\.source_created_at/);
  assert.match(fixture.calls[0].sql,/o\.order_number LIKE/);
  assert.deepEqual(fixture.calls[0].params,[tenantId,'2026-11-01T00:00:00.000Z','2026-12-01T00:00:00.000Z','%EB-9%','%EB-9%','processing',51,0]);
  assert.doesNotMatch(fixture.calls[0].sql,/customer_ciphertext|buyer_phone|buyer_email/i);
});

test('Retail Orders denies roles without order access before reading connected orders',async t=>{
  const fixture=appFor('accountant'),server=fixture.app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/workspace/retail/orders/online/search`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({page:0})});
  assert.equal(response.status,403);
  assert.equal(fixture.calls.length,0);
});

test('Retail connected-order search rejects unsafe filters before querying',async t=>{
  const fixture=appFor(),server=fixture.app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/workspace/retail/orders/online/search`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({status:'processing OR 1=1',page:0})});
  const body=await response.json();
  assert.equal(response.status,400);
  assert.equal(body.code,'INVALID_ORDER_SEARCH');
  assert.equal(fixture.calls.length,0);
});
