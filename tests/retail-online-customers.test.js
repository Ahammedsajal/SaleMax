'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const express=require('express');
const category=require('../modules/platform/categories').getCategory('retail_boutique',1);
const connector=require('../modules/platform/retail-connected-stores');
const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const connectionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function customerRow(id,customer,secret){
  const normalized=connector.normalizeCustomer('woocommerce',{id,...customer});
  const encrypted=connector.seal(normalized,tenantId,connectionId,`customer:${id}`,{SALEMAX_PLATFORM_KEY_BASE64:secret});
  return {connectionId,externalCustomerId:String(id),storeName:'Essentials by D',connectionStatus:'active',...encrypted,sourceUpdatedAt:'2026-11-18T10:00:00.000Z'};
}
function appFor({role='manager',pilotTenants=tenantId,customers=[],crmRows=[],orders=[]}={}){
  const secret=Buffer.alloc(32,61).toString('base64'),calls=[];
  const encryptedCustomers=customers.map(([id,value])=>customerRow(id,value,secret));
  const encryptedOrders=orders.map(order=>({externalOrderId:String(order.id),orderNumber:String(order.number),status:order.status,financialStatus:order.financialStatus,
    currency:order.currency,totalAmount:order.total,orderDate:'2026-11-18T10:00:00.000000Z',
    ...connector.seal(order.snapshot,tenantId,connectionId,`order:${order.id}`,{SALEMAX_PLATFORM_KEY_BASE64:secret})}));
  const pool={async query(sql,params){
    calls.push({sql,params});
    if(sql.includes('COUNT(*) AS total FROM sx_retail_external_customers x'))return [[{total:encryptedCustomers.length}],[]];
    if(sql.includes('SELECT x.connection_id AS connectionId'))return [encryptedCustomers,[]];
    if(sql.includes('FROM sx_legacy_ownership o'))return [[{uid:'owner-uid',legacy_uid_hash:require('node:crypto').createHash('sha256').update('owner-uid').digest('hex')}],[]];
    if(sql.includes('SELECT crm.id,crm.source,crm.name'))return [crmRows,[]];
    if(sql.includes('SELECT connection_id AS connectionId,customer_external_id AS externalCustomerId'))return [encryptedCustomers.map(row=>({connectionId,externalCustomerId:row.externalCustomerId,orderCount:encryptedOrders.filter(order=>String(order.snapshot.customerId||'')===row.externalCustomerId).length,lastOrderAt:null})),[]];
    if(sql.includes('SELECT COUNT(*) AS total FROM sx_retail_external_orders'))return [[{total:encryptedOrders.length}],[]];
    if(sql.includes('SELECT external_order_id AS externalOrderId,order_number AS orderNumber'))return [encryptedOrders,[]];
    throw new Error('Unexpected query: '+sql);
  }};
  const app=express();
  app.use('/api/workspace/retail',require('../modules/platform/retail-commerce-router').workspaceRouter({pool,env:{SALEMAX_RETAIL_CONNECTOR_PILOT_TENANTS:pilotTenants},authenticate(req,_res,next){
    req.businessContext={audience:'tenant',identity:{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},category,
      tenant:{id:tenantId,status:'active',categoryKey:category.key,categoryVersion:category.version},
      membership:{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',tenantId,status:'active',role},
      subscription:{status:'active',capabilities:category.capabilities}};next();
  }}));
  return {app,calls,secret};
}
async function start(t,app){const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));return `http://127.0.0.1:${server.address().port}`;}

test('Retail Customers matches only unique exact CRM records and keeps ambiguous matches separate',async t=>{
  const fixture=appFor({customers:[
    ['15',{id:'15',email:'alice@example.invalid',phone:'+974 5555 1111',first_name:'Alice',marketing_consent:true}],
    ['16',{id:'16',email:'review@example.invalid',phone:'+974 5555 2222',first_name:'Review',marketingConsent:'denied'}],
  ],crmRows:[
    {id:'crm-alice',source:'contact',name:'Alice CRM',email:'alice@example.invalid',phone:'97455551111'},
    {id:'crm-review-1',source:'contact',name:'Review one',email:'review@example.invalid',phone:'97455552222'},
    {id:'crm-review-2',source:'lead',name:'Review two',email:'other@example.invalid',phone:'97455552222'},
  ]});
  const originalKey=process.env.SALEMAX_PLATFORM_KEY_BASE64;process.env.SALEMAX_PLATFORM_KEY_BASE64=fixture.secret;
  t.after(()=>{if(originalKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;else process.env.SALEMAX_PLATFORM_KEY_BASE64=originalKey;});
  const base=await start(t,fixture.app),response=await fetch(base+'/api/workspace/retail/customers/online/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({page:0})});
  const body=await response.json();
  assert.equal(response.status,200);assert.equal(body.data.customers.length,2);
  assert.deepEqual(body.data.customers.map(row=>row.crmMatch.status),['unique','ambiguous']);
  assert.equal(body.data.customers[0].crmMatch.records[0].id,'crm-alice');
  assert.equal(body.data.customers[1].crmMatch.count,2);
  assert.equal(body.data.customers[0].marketingPermission,'not_granted_by_import');
  assert.equal(body.data.customers[0].sourceMarketingPreference,'granted');
  assert.equal(fixture.calls.every(call=>call.params.includes(tenantId)||call.sql.includes('FROM sx_legacy_ownership')),true);
  assert.ok(fixture.calls.some(call=>call.sql.includes('x.email_lookup_hash=?'))===false,'unfiltered listing should not hash-match query');
});

test('Retail customer profile links Woo order history by external customer ID and remains read-only',async t=>{
  const fixture=appFor({customers:[['15',{id:'15',email:'alice@example.invalid',phone:'+97455551111',first_name:'Alice',billing:{address_1:'1 Main Street',city:'Doha'},marketingConsent:'unknown'}]],
    crmRows:[{id:'crm-alice',source:'contact',name:'Alice CRM',email:'alice@example.invalid',phone:'+97455551111'}],
    orders:[{id:'9001',number:'EB-9001',status:'processing',financialStatus:'paid_reported_by_store',currency:'QAR',total:'150.250000',snapshot:{customerId:'15',lineItems:[
      {id:'line-1',productId:'100',variantId:'101',title:'Blue linen',sku:'LINEN-BLUE',quantity:'1.5',unitPrice:'100',subtotal:'150',discount:'0',total:'150',tax:'0'}]}}]});
  const originalKey=process.env.SALEMAX_PLATFORM_KEY_BASE64;process.env.SALEMAX_PLATFORM_KEY_BASE64=fixture.secret;
  t.after(()=>{if(originalKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;else process.env.SALEMAX_PLATFORM_KEY_BASE64=originalKey;});
  const base=await start(t,fixture.app),response=await fetch(base+'/api/workspace/retail/customers/online/detail',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({connectionId,externalCustomerId:'15',page:0})});
  const body=await response.json();
  assert.equal(response.status,200);assert.equal(body.data.externalCustomerId,'15');
  assert.equal(body.data.crmMatch.status,'unique');assert.equal(body.data.billing.address1,'1 Main Street');
  assert.equal(body.data.marketingPermission,'not_granted_by_import');
  assert.equal(body.data.purchaseHistory.total,1);assert.equal(body.data.purchaseHistory.orders[0].externalOrderId,'9001');
  assert.equal(body.data.purchaseHistory.orders[0].lineItems[0].variationId,'101');
  assert.equal(body.data.purchaseHistory.orders[0].lineItems[0].sku,'LINEN-BLUE');
  assert.ok(fixture.calls.every(call=>call.sql.trimStart().startsWith('SELECT')));
});

test('Retail customer records are denied to roles without retail order permission',async t=>{
  const fixture=appFor({role:'accountant',customers:[['15',{id:'15',email:'alice@example.invalid'}]]}),base=await start(t,fixture.app);
  const response=await fetch(base+'/api/workspace/retail/customers/online/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({page:0})});
  assert.equal(response.status,403);assert.equal(fixture.calls.length,0);
});

test('Retail customer import is disabled outside the connector pilot allowlist',async t=>{
  const fixture=appFor({pilotTenants:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',customers:[['15',{id:'15',email:'alice@example.invalid'}]]}),base=await start(t,fixture.app);
  const response=await fetch(base+'/api/workspace/retail/customers/online/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({page:0})});
  const body=await response.json();assert.equal(response.status,403);assert.equal(body.code,'RETAIL_CONNECTOR_PILOT_DISABLED');assert.equal(fixture.calls.length,0);
});
