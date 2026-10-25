'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const service=require('../modules/platform/restaurant-orders');
const categories=require('../modules/platform/categories');
const plans=require('../modules/platform/plans');

const tenantId='11111111-1111-4111-8111-111111111111';
const ctx={audience:'tenant',identity:{id:'22222222-2222-4222-8222-222222222222'},tenant:{id:tenantId,categoryKey:'restaurant_cafe',categoryVersion:1,status:'active'},category:{key:'restaurant_cafe',version:1,capabilities:['restaurant.orders','restaurant.menu','products.catalog']},subscription:{status:'active',categoryKey:'restaurant_cafe',categoryVersion:1,capabilities:['restaurant.orders','restaurant.menu','products.catalog']},membership:{id:'33333333-3333-4333-8333-333333333333',tenantId,status:'active',role:'owner'}};
const request={customerName:'Guest',customerMobile:'+97455551234',fulfillmentMode:'pickup',branchSlug:'doha',deliveryAddress:'',paymentMethod:'cash_on_delivery',items:[{menuItemId:'44444444-4444-4444-8444-444444444444',quantity:2,modifierOptionIds:['55555555-5555-4555-8555-555555555555']}],requestKey:'66666666-6666-4666-8666-666666666666',guestAccessToken:'A'.repeat(43),consent:true};

test('guest restaurant order requests require explicit consent, a valid guest contact and bounded unique options',()=>{
  assert.equal(service.cleanOrder(request).items[0].modifierOptionIds.length,1);
  assert.throws(()=>service.cleanOrder({...request,consent:false}),{code:'CONSENT_REQUIRED'});
  assert.throws(()=>service.cleanOrder({...request,customerMobile:''}),{code:'CONTACT_REQUIRED'});
  assert.throws(()=>service.cleanOrder({...request,fulfillmentMode:'delivery'}),{code:'DELIVERY_ADDRESS_REQUIRED'});
  assert.throws(()=>service.cleanOrder({...request,items:[{...request.items[0],modifierOptionIds:[...request.items[0].modifierOptionIds,...request.items[0].modifierOptionIds]}]}),{code:'INVALID_ORDER_MODIFIERS'});
  assert.throws(()=>service.cleanOrder({...request,items:[{...request.items[0],quantity:21}]}),{code:'INVALID_ORDER_ITEM'});
});

test('modifier selections are checked per group and their bilingual labels and deltas are snapshotted',()=>{
  const groups=[{id:'g1',nameEn:'Size',nameAr:'الحجم',minSelections:1,maxSelections:1},{id:'g2',nameEn:'Extras',nameAr:'إضافات',minSelections:0,maxSelections:2}];
  const options=new Map([['g1',[{id:'o1',nameEn:'Large',nameAr:'كبير',priceDeltaMinor:250}]],['g2',[{id:'o2',nameEn:'Cheese',nameAr:'جبن',priceDeltaMinor:100}]]]);
  const result=service.snapshotGroups(groups,options,['o1','o2']);
  assert.equal(result.deltaTotal,350);assert.equal(result.snapshots.length,2);assert.equal(result.snapshots[0].options[0].nameAr,'كبير');
  assert.throws(()=>service.snapshotGroups(groups,options,[]),{code:'INVALID_MODIFIER_SELECTIONS'});
  assert.throws(()=>service.snapshotGroups(groups,options,['o1','99999999-9999-4999-8999-999999999999']),{code:'INVALID_MODIFIER_SELECTIONS'});
});

test('restaurant order authorization uses the restaurant capability and assigned order scope',()=>{
  assert.equal(service.authorize(ctx,'restaurant.orders.read'),'tenant');
  assert.equal(service.authorize(ctx,'restaurant.orders.fulfill'),'tenant');
  assert.equal(service.authorize({...ctx,membership:{...ctx.membership,role:'agent'}},'restaurant.orders.fulfill'),'assigned');
  assert.throws(()=>service.authorize({...ctx,membership:{...ctx.membership,role:'agent'}},'restaurant.orders.manage'),{code:'PERMISSION_DENIED'});
  assert.throws(()=>service.authorize({...ctx,tenant:{...ctx.tenant,categoryKey:'retail_boutique'}},'restaurant.orders.read'),{code:'CATEGORY_UNAVAILABLE'});
  const session=require('../modules/platform/feature-contract').describe({context:ctx});
  assert.equal(session.modules.restaurantOrders,true);
  assert.equal(session.permissions['restaurant.orders.fulfill'],true);
});

test('accountant order reads omit guest contact, address and menu-line details',async()=>{
  const accountant={...ctx,membership:{...ctx.membership,role:'accountant'}};const statements=[];
  const db={query:async sql=>{statements.push(sql);if(sql.startsWith('SELECT o.id'))return [[{id:'order-1',orderReference:'F-123',subtotalMinor:1200,revision:1}]];throw new Error('financial scope must not query order lines');}};
  const result=await service.listOrders(db,accountant);
  assert.equal(result.items.length,1);assert.deepEqual(result.items[0].items,[]);
  assert.doesNotMatch(statements[0],/customer_(?:name|email|mobile)|delivery_address/);
  assert.equal(statements.length,1);
});

test('private restaurant categories cannot serve public menus or guest requests before readiness',async()=>{
  let queries=0;const db={query:async()=>{queries++;throw new Error('must fail before database access');}};
  await assert.rejects(service.publicCatalog(db,tenantId,'doha'),{code:'CATEGORY_UNAVAILABLE'});
  await assert.rejects(service.requestOrder(db,tenantId,request),{code:'CATEGORY_UNAVAILABLE'});
  assert.equal(queries,0);
});

test('guest order creation checks branch hours and snapshots base plus selected modifier prices in one transaction',async()=>{
  const oldGet=categories.getCategory,oldEntitlements=plans.loadEntitlements;categories.getCategory=()=>({key:'restaurant_cafe',public:true,capabilities:['restaurant.orders','restaurant.menu','products.catalog']});plans.loadEntitlements=async()=>({status:'active',categoryKey:'restaurant_cafe',capabilities:['restaurant.orders','restaurant.menu','products.catalog']});
  const statements=[];let committed=false,rolledBack=false;
  const db={beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{rolledBack=true;},query:async(sql,params)=>{statements.push({sql,params});
    if(sql.startsWith('SELECT id,order_reference AS orderReference,payload_hash'))return [[]];
    if(sql.startsWith('SELECT id,slug,timezone,opening_hours'))return [[{id:'77777777-7777-4777-8777-777777777777',slug:'doha',timezone:'Asia/Qatar',openingHours:{monday:[{open:'09:00',close:'12:00'}]},preparationMinutes:20,fulfillmentModes:['pickup']}]];
    if(sql.startsWith('SELECT m.id AS menuItemId'))return [[{menuItemId:request.items[0].menuItemId,priceMinor:1000,currency:'QAR',code:'DISH-1',nameEn:'Soup',nameAr:'حساء'}]];
    if(sql.startsWith('SELECT id,name_en AS nameEn,name_ar AS nameAr,min_selections'))return [[{id:'88888888-8888-4888-8888-888888888888',nameEn:'Size',nameAr:'الحجم',minSelections:1,maxSelections:1}]];
    if(sql.startsWith('SELECT id,name_en AS nameEn,name_ar AS nameAr,price_delta_minor'))return [[{id:request.items[0].modifierOptionIds[0],nameEn:'Large',nameAr:'كبير',priceDeltaMinor:250}]];
    if(sql.startsWith('INSERT INTO sx_restaurant_order_items')){assert.equal(params[8],1000);assert.equal(params[9],1250);assert.equal(params[11],2500);const snapshot=JSON.parse(params[10]);assert.equal(snapshot[0].options[0].priceDeltaMinor,250);return [{affectedRows:1}];}
    if(sql.startsWith('INSERT INTO sx_restaurant_orders')||sql.startsWith('INSERT INTO sx_audit_events'))return [{affectedRows:1}];
    throw new Error(`Unexpected SQL: ${sql}`);
  }};
  try{
    const result=await service.requestOrder(db,tenantId,request,new Date('2026-10-26T06:00:00Z'));
    assert.equal(result.status,'requested');assert.equal(result.subtotalMinor,2500);assert.equal(result.paymentStatus,'unpaid');assert.equal(result.repeated,false);assert.equal(committed,true);assert.equal(rolledBack,false);
    assert.equal(statements.some(row=>row.sql.includes('sx_retail_stock')),false);
  }finally{categories.getCategory=oldGet;plans.loadEntitlements=oldEntitlements;}
});

test('restaurant guest-order migration stores tenant-bound modifier snapshots and request-only state',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../database/migrations/20270111_restaurant_guest_orders.sql'),'utf8');
  assert.match(sql,/guest_access_hash CHAR\(64\)/);
  assert.match(sql,/UNIQUE KEY uq_sx_restaurant_order_request \(tenant_id,request_key_hash\)/);
  assert.match(sql,/status ENUM\('requested','confirmed'/);
  assert.match(sql,/modifiers_snapshot JSON NOT NULL/);
  assert.match(sql,/base_price_minor BIGINT UNSIGNED NOT NULL/);
  assert.match(sql,/FOREIGN KEY \(tenant_id,branch_id\) REFERENCES sx_tenant_branches\(tenant_id,id\)/);
  assert.match(sql,/FOREIGN KEY \(tenant_id,menu_item_id\) REFERENCES sx_restaurant_menu_items\(tenant_id,id\)/);
  assert.doesNotMatch(sql,/\bDROP\s+(?:TABLE|COLUMN|INDEX)\b/i);
});

test('restaurant order endpoint, shared session module and bilingual existing-panel queue are wired',()=>{
  const root=path.join(__dirname,'..');
  const mount=fs.readFileSync(path.join(root,'modules/platform/mount-existing-upgrade.js'),'utf8');
  const web=fs.readFileSync(path.join(root,'modules/web/public-website.js'),'utf8');
  const api=fs.readFileSync(path.join(root,'client/public/workspace-api.js'),'utf8');
  const feature=fs.readFileSync(path.join(root,'modules/platform/feature-contract.js'),'utf8');
  const screen=fs.readFileSync(path.join(root,'client/public/restaurant-orders-workspace.js'),'utf8');
  const sidebar=fs.readFileSync(path.join(root,'client/public/training-sidebar.js'),'utf8');
  const shell=fs.readFileSync(path.join(root,'client/public/index.html'),'utf8');
  assert.match(mount,/\/api\/workspace\/restaurant-orders/);
  assert.match(web,/\/api\/public\/website\/restaurant-orders/);
  assert.match(api,/restaurantOrders:'\/api\/workspace\/restaurant-orders'/);
  assert.match(feature,/restaurantOrders:\['restaurant\.orders','restaurant\.orders\.read'\]/);
  assert.match(screen,/restaurant\.orders\.fulfill/);
  assert.match(screen,/session\.modules\?\.restaurantOrders!==true/);
  assert.match(screen,/awaiting business confirmation/i);
  assert.match(screen,/does not reserve kitchen or dining capacity/i);
  assert.match(sidebar,/restaurant-orders/);
  assert.match(shell,/restaurant-orders-workspace\.js/);
});
