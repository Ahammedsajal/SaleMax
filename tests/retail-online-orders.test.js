'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const express=require('express');
const category=require('../modules/platform/categories').getCategory('retail_boutique',1);
const connector=require('../modules/platform/retail-connected-stores');
const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const connectionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const row={connectionId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',provider:'woocommerce',storeName:'Synthetic Retail Store',
  connectionStatus:'active',externalOrderId:'9001',orderNumber:'EB-9001',status:'processing',financialStatus:'paid_reported_by_store',
  currency:'QAR',totalAmount:'150.250000',subtotalAmount:'140.000000',discountAmount:'0.000000',shippingAmount:'5.000000',
  taxAmount:'5.250000',refundAmount:'0.000000',orderDate:'2026-11-17T12:00:00.000000Z',dateBasis:'source_created',lastSyncAt:'2026-11-17T12:30:00.000Z'};

function appFor(role='manager',pilotTenants=tenantId){
  const calls=[];
  const pool={async query(sql,params){
    calls.push({sql,params});
    if(sql.includes('FROM sx_retail_external_orders o JOIN sx_retail_store_connections s'))return [[row],[]];
    if(sql.includes('FROM sx_retail_orders o LEFT JOIN sx_retail_locations'))return [[],[]];
    throw new Error('Unexpected query: '+sql);
  }};
  const app=express();
  app.use('/api/workspace/retail',require('../modules/platform/retail-commerce-router').workspaceRouter({pool,env:{SALEMAX_RETAIL_CONNECTOR_PILOT_TENANTS:pilotTenants},authenticate(req,_res,next){
    const selectedRole=req.get('x-test-role')||role;
    req.businessContext={audience:'tenant',identity:{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},category,
      tenant:{id:req.get('x-test-tenant')||tenantId,status:'active',categoryKey:category.key,categoryVersion:category.version},
      membership:{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',tenantId:req.get('x-test-tenant')||tenantId,status:'active',role:selectedRole},
      subscription:{status:'active',capabilities:category.capabilities}};
    next();
  }}));
  return {app,calls};
}

function detailAppFor(role='manager',provider='woocommerce',pilotTenants=tenantId){
  const calls=[],secret=Buffer.alloc(32,29).toString('base64');
  const encrypted=connector.seal({customer:{email:'buyer-private@example.invalid',phone:'+97400000000'},lineItems:[
    {id:'line-1',productId:'900',variantId:'901',title:'Blue fabric',sku:'WOO-BLUE',quantity:'1.500000',unitPrice:'12.250000',subtotal:'18.375000',discount:'1.000000',total:'17.375000',tax:'0.000000'},
    {id:'line-2',productId:'902',variantId:null,title:'Needle pack',sku:'NEEDLE-3',quantity:'2.000000',unitPrice:'3.000000',subtotal:'6.000000',discount:'0.000000',total:'6.000000',tax:'0.000000'},
    {id:'line-3',productId:'903',variantId:null,title:'Buttons',sku:'BUTTON-1',quantity:'4.000000',unitPrice:'0.500000',subtotal:'2.000000',discount:'0.000000',total:'2.000000',tax:'0.000000'}
  ],lineItemsTruncated:true},tenantId,connectionId,'order:9001',{SALEMAX_PLATFORM_KEY_BASE64:secret});
  const dbRow={connectionId,externalOrderId:'9001',...encrypted,provider,storeName:'Synthetic Retail Store'};
  const mappings=[{productId:'900',variationId:'901',mappingStatus:'mapped',targetProductId:'target-1',targetSku:'WOO-BLUE',
    targetNameEn:'Blue fabric',targetNameAr:'قماش أزرق',targetStatus:'active'},
  {productId:'902',variationId:'',mappingStatus:'mapped',targetProductId:'target-2',targetSku:'NEEDLE-4',
    targetNameEn:'Needle pack',targetNameAr:'عبوة إبر',targetStatus:'active'}];
  const pool={async query(sql,params){
    calls.push({sql,params});
    if(sql.includes('FROM sx_retail_external_orders o JOIN sx_retail_store_connections s')&&sql.includes('o.order_ciphertext'))return [[dbRow],[]];
    if(sql.includes('FROM sx_retail_external_product_mappings m'))return [mappings,[]];
    throw new Error('Unexpected query: '+sql);
  }};
  const app=express();
  app.use('/api/workspace/retail',require('../modules/platform/retail-commerce-router').workspaceRouter({pool,env:{SALEMAX_RETAIL_CONNECTOR_PILOT_TENANTS:pilotTenants},authenticate(req,_res,next){
    const selectedRole=req.get('x-test-role')||role;
    req.businessContext={audience:'tenant',identity:{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},category,
      tenant:{id:req.get('x-test-tenant')||tenantId,status:'active',categoryKey:category.key,categoryVersion:category.version},
      membership:{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',tenantId:req.get('x-test-tenant')||tenantId,status:'active',role:selectedRole},
      subscription:{status:'active',capabilities:category.capabilities}};
    next();
  }}));
  return {app,calls,secret};
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
    source:'connected_store',connectionId:row.connectionId,provider:'woocommerce',storeName:'Synthetic Retail Store',connectionStatus:'active',
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

test('Retail attention queue filters only local deliveries that need an owner',async t=>{
  const fixture=appFor(),server=fixture.app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/workspace/retail/orders/search`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({page:0,queue:'delivery_attention'})});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.data.orders.length,0);
  assert.match(fixture.calls[0].sql,/o\.external_source_connection_id IS NULL AND o\.fulfillment='delivery'/);
  assert.match(fixture.calls[0].sql,/o\.delivery_state='failed'/);
  assert.match(fixture.calls[0].sql,/o\.driver_id IS NULL/);
  assert.deepEqual(fixture.calls[0].params,[tenantId,51,0]);
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

test('authorized merchants can read their own imported orders outside the provider-write pilot',async t=>{
  const fixture=appFor('manager','cccccccc-cccc-4ccc-8ccc-cccccccccccc'),server=fixture.app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/workspace/retail/orders/online/search`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({page:0})});
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.data.orders.length,1);
  assert.equal(fixture.calls[0].params[0],tenantId);
});

test('connected-order detail returns item and SKU mappings without decrypting customer data into the response',async t=>{
  const fixture=detailAppFor(),originalKey=process.env.SALEMAX_PLATFORM_KEY_BASE64;
  process.env.SALEMAX_PLATFORM_KEY_BASE64=fixture.secret;
  t.after(()=>{if(originalKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;else process.env.SALEMAX_PLATFORM_KEY_BASE64=originalKey;});
  const server=fixture.app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/workspace/retail/orders/online/detail`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({connectionId,externalOrderId:'9001'})});
  const body=await response.json();
  assert.equal(response.status,200);
  assert.deepEqual(body.data.lines.map(line=>({productId:line.productId,variationId:line.variationId,sku:line.sku,mappingStatus:line.mappingStatus,
    targetSku:line.target?.sku,quantity:line.quantity,total:line.total,skuMatches:line.skuMatches})),[
    {productId:'900',variationId:'901',sku:'WOO-BLUE',mappingStatus:'mapped',targetSku:'WOO-BLUE',quantity:'1.500000',total:'17.375000',skuMatches:true},
    {productId:'902',variationId:null,sku:'NEEDLE-3',mappingStatus:'mapped',targetSku:'NEEDLE-4',quantity:'2.000000',total:'6.000000',skuMatches:false},
    {productId:'903',variationId:null,sku:'BUTTON-1',mappingStatus:'unmapped',targetSku:undefined,quantity:'4.000000',total:'2.000000',skuMatches:null},
  ]);
  assert.equal(body.data.lineItemsTruncated,true);
  assert.doesNotMatch(JSON.stringify(body),/buyer-private@example\.invalid|\+97400000000/);
  assert.equal(fixture.calls.length,2);
  assert.match(fixture.calls[0].sql,/o\.tenant_id=\?/);
  assert.match(fixture.calls[1].sql,/m\.tenant_id=\?/);
  assert.deepEqual(fixture.calls[0].params,[tenantId,connectionId,'9001']);
  assert.deepEqual(fixture.calls[1].params,[tenantId,connectionId,'900','901','902','','903','']);
});

test('connected-order detail rejects unauthorized roles before reading order snapshots',async t=>{
  const fixture=detailAppFor('accountant'),server=fixture.app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/workspace/retail/orders/online/detail`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({connectionId,externalOrderId:'9001'})});
  assert.equal(response.status,403);
  assert.equal(fixture.calls.length,0);
});

test('connected-order detail rejects malformed identifiers before querying',async t=>{
  const fixture=detailAppFor(),server=fixture.app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/workspace/retail/orders/online/detail`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({connectionId,externalOrderId:'9001',email:'unexpected'})});
  const body=await response.json();
  assert.equal(response.status,400);
  assert.equal(body.code,'INVALID_ORDER_DETAIL');
  assert.equal(fixture.calls.length,0);
});

test('connected-order detail does not imply Woo SKU mappings for other store providers',async t=>{
  const fixture=detailAppFor('manager','shopify'),originalKey=process.env.SALEMAX_PLATFORM_KEY_BASE64;
  process.env.SALEMAX_PLATFORM_KEY_BASE64=fixture.secret;
  t.after(()=>{if(originalKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;else process.env.SALEMAX_PLATFORM_KEY_BASE64=originalKey;});
  const server=fixture.app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/workspace/retail/orders/online/detail`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({connectionId,externalOrderId:'9001'})});
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.data.provider,'shopify');
  assert.ok(body.data.lines.every(line=>line.mappingStatus==='not_supported'));
  assert.equal(fixture.calls.length,1);
});
