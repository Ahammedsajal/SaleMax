'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const retail=require('../modules/platform/retail-orders');
const categories=require('../modules/platform/categories');

const ctx={audience:'tenant',identity:{id:'11111111-1111-4111-8111-111111111111'},tenant:{id:'22222222-2222-4222-8222-222222222222',categoryKey:'retail_boutique',categoryVersion:1,status:'active'},membership:{id:'33333333-3333-4333-8333-333333333333',tenantId:'22222222-2222-4222-8222-222222222222',role:'manager',status:'active'},category:categories.retailBoutique,subscription:{status:'active',capabilities:['products.catalog','retail.orders']}};

test('retail permissions distinguish product catalogue administration from order fulfillment',()=>{
  assert.equal(retail.authorize(ctx,'products.read'),'tenant');
  assert.equal(retail.authorize(ctx,'products.manage'),'tenant');
  assert.equal(retail.authorize(ctx,'orders.fulfill'),'tenant');
  assert.throws(()=>retail.authorize({...ctx,membership:{...ctx.membership,role:'accountant'}},'orders.fulfill'),{code:'PERMISSION_DENIED'});
});

test('variant and initial branch stock are created together and audited in one transaction',async()=>{
  const statements=[];let committed=false,rolledBack=false;
  const db={beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{rolledBack=true;},query:async(sql)=>{statements.push(sql);if(sql.startsWith('SELECT id FROM sx_product_catalog'))return [[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}]];if(sql.startsWith('SELECT id FROM sx_tenant_branches'))return [[{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}]];if(sql.startsWith('INSERT INTO sx_retail_variants'))return [{affectedRows:1}];if(sql.startsWith('INSERT INTO sx_retail_stock'))return [{affectedRows:1}];if(sql.startsWith('INSERT INTO sx_audit_events'))return [{affectedRows:1}];throw new Error(`Unexpected SQL: ${sql}`);}};
  const result=await retail.createVariant(db,ctx,{productId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',branchId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',onHand:7,sku:'SKU-7',nameEn:'Seven',nameAr:'سبعة',priceMinor:1200,currency:'QAR'});
  assert.equal(result.onHand,7);assert.equal(result.branchId,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');assert.equal(committed,true);assert.equal(rolledBack,false);
  assert.equal(statements.filter(sql=>sql.startsWith('INSERT INTO sx_retail_variants')).length,1);assert.equal(statements.filter(sql=>sql.startsWith('INSERT INTO sx_retail_stock')).length,1);assert.equal(statements.filter(sql=>sql.startsWith('INSERT INTO sx_audit_events')).length,1);
});

test('variant creation rolls back when its requested branch is not active',async()=>{
  const statements=[];let rolledBack=false;
  const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rolledBack=true;},query:async(sql)=>{statements.push(sql);if(sql.startsWith('SELECT id FROM sx_product_catalog'))return [[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}]];if(sql.startsWith('SELECT id FROM sx_tenant_branches'))return [[]];throw new Error(`Unexpected SQL: ${sql}`);}};
  await assert.rejects(retail.createVariant(db,ctx,{productId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',branchId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',onHand:7,sku:'SKU-7',nameEn:'Seven',priceMinor:1200,currency:'QAR'}),{code:'RETAIL_BRANCH_UNAVAILABLE'});
  assert.equal(rolledBack,true);assert.equal(statements.some(sql=>sql.startsWith('INSERT INTO sx_retail_variants')),false);
});

test('guest checkout validates contact, consent, unique variants, and idempotency key',()=>{
  const input={customerName:'Guest',customerMobile:'+97455551234',fulfillmentMode:'pickup',branchSlug:'doha',deliveryAddress:'',paymentMethod:'cash_on_delivery',items:[{variantId:'44444444-4444-4444-8444-444444444444',quantity:2}],requestKey:'55555555-5555-4555-8555-555555555555',guestAccessToken:'A'.repeat(43),consent:true};
  assert.equal(retail.cleanCheckout(input).items[0].quantity,2);
  assert.throws(()=>retail.cleanCheckout({...input,consent:false}),{code:'CONSENT_REQUIRED'});
  assert.throws(()=>retail.cleanCheckout({...input,items:[...input.items,...input.items]}),{code:'INVALID_ORDER_ITEMS'});
  assert.throws(()=>retail.cleanCheckout({...input,customerMobile:'55551234'}),{code:'INVALID_CUSTOMER_MOBILE'});
  assert.equal(retail.cleanCheckout({...input,customerMobile:'',customerEmail:'guest@example.qa'}).customerEmail,'guest@example.qa');
  assert.throws(()=>retail.cleanCheckout({...input,guestAccessToken:'weak'}),{code:'INVALID_GUEST_ACCESS_TOKEN'});
});

test('retail orders reserve at checkout, consume stock on completion, and release on cancellation or return',async()=>{
  const cases=[
    {from:'ready',to:'completed',expected:/reserved=reserved-\?,on_hand=on_hand-\?/},
    {from:'confirmed',to:'cancelled',expected:/reserved=reserved-\?,revision=/},
    {from:'return_requested',to:'returned',expected:/SET on_hand=on_hand\+\?/}
  ];
  for(const item of cases){
    const statements=[];let committed=false,rolledBack=false;
    const db={beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{rolledBack=true;},query:async(sql)=>{
      statements.push(sql);
      if(sql.startsWith('SELECT o.status'))return [[{status:item.from,revision:1,fulfillmentMode:'pickup',branchId:'66666666-6666-4666-8666-666666666666',routeMembershipId:null}]];
      if(sql.startsWith('SELECT variant_id'))return [[{variantId:'77777777-7777-4777-8777-777777777777',quantity:2}]];
      if(sql.startsWith('UPDATE sx_retail_stock'))return [{affectedRows:1}];
      if(sql.startsWith('UPDATE sx_retail_orders'))return [{affectedRows:1}];
      if(sql.startsWith('INSERT INTO sx_audit_events'))return [{affectedRows:1}];
      throw new Error(`Unexpected SQL: ${sql}`);
    }};
    const result=await retail.updateOrder(db,ctx,'88888888-8888-4888-8888-888888888888',{expectedRevision:1,status:item.to,...(item.to==='returned'?{returnReason:'Customer return'}:{})});
    assert.equal(result.status,item.to);assert.equal(committed,true);assert.equal(rolledBack,false);
    const stockSql=statements.find(sql=>sql.startsWith('UPDATE sx_retail_stock'));
    assert.match(stockSql,item.expected);
  }
});

test('guest return requests use the tenant-scoped access hash and write an audit event once',async()=>{
  const sql=[];let committed=false;
  const db={beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{},query:async(statement)=>{sql.push(statement);if(statement.startsWith('SELECT id,status,revision'))return [[{id:'99999999-9999-4999-8999-999999999999',status:'completed',revision:3}]];if(statement.startsWith('UPDATE sx_retail_orders'))return [{affectedRows:1}];if(statement.startsWith('INSERT INTO sx_audit_events'))return [{affectedRows:1}];throw new Error(`Unexpected SQL: ${statement}`);}};
  const result=await retail.requestReturn(db,ctx.tenant.id,{orderReference:'R-0123456789',guestAccessToken:'Z'.repeat(43),reason:'Wrong size'});
  assert.deepEqual(result,{orderReference:'R-0123456789',status:'return_requested',repeated:false});assert.equal(committed,true);assert.equal(sql.filter(statement=>statement.startsWith('INSERT INTO sx_audit_events')).length,1);
  assert.match(sql[0],/guest_access_hash=\? FOR UPDATE/);
});

test('retail migration stores only a guest access-token hash and constrains tenant, branch and inventory relationships',()=>{
  const migration=fs.readFileSync(path.join(__dirname,'../database/migrations/20270108_retail_storefront_orders.sql'),'utf8');
  assert.match(migration,/guest_access_hash CHAR\(64\)/);
  assert.match(migration,/UNIQUE KEY uq_sx_retail_order_request \(tenant_id,request_key_hash\)/);
  assert.match(migration,/FOREIGN KEY \(tenant_id,branch_id\) REFERENCES sx_tenant_branches\(tenant_id,id\)/);
  assert.match(migration,/CHECK \(reserved <= on_hand\)/);
});

test('retail orders reuse shared workspace authentication and existing business shell routes',()=>{
  const root=path.join(__dirname,'..'),mount=fs.readFileSync(path.join(root,'modules/platform/mount-existing-upgrade.js'),'utf8'),client=fs.readFileSync(path.join(root,'client/public/workspace-api.js'),'utf8'),screen=fs.readFileSync(path.join(root,'client/public/retail-orders-workspace.js'),'utf8'),sidebar=fs.readFileSync(path.join(root,'client/public/training-sidebar.js'),'utf8'),index=fs.readFileSync(path.join(root,'client/public/index.html'),'utf8');
  assert.match(mount,/\/api\/workspace\/retail-orders/);assert.match(mount,/authenticate:featureSession\.guard/);assert.match(client,/retailOrders:'\/api\/workspace\/retail-orders'/);assert.match(screen,/SaleMaxWorkspace\.session/);assert.match(screen,/SaleMaxWorkspace\.request/);assert.match(screen,/branches\.filter\(b=>b\.status==='active'\)/);assert.match(screen,/stock\?\.stockRevision\?\?0/);assert.match(sidebar,/retail-orders/);assert.match(index,/retail-orders-workspace\.js/);
});
