'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const menu=require('../modules/platform/restaurant-menu');

const tenantId='11111111-1111-4111-8111-111111111111';
const ctx={audience:'tenant',identity:{id:'22222222-2222-4222-8222-222222222222'},tenant:{id:tenantId,categoryKey:'restaurant_cafe',categoryVersion:1,status:'active'},category:{key:'restaurant_cafe',version:1,capabilities:['restaurant.menu']},subscription:{status:'active',categoryKey:'restaurant_cafe',categoryVersion:1,capabilities:['restaurant.menu']},membership:{tenantId,status:'active',role:'owner'}};

test('restaurant menu authorization is category and active membership scoped',()=>{
  assert.equal(menu.access(ctx,'products.read'),'tenant');
  assert.equal(menu.access(ctx,'products.manage'),'tenant');
  assert.equal(require('../modules/platform/feature-contract').describe({context:ctx}).modules.restaurantMenu,true);
  assert.throws(()=>menu.access({...ctx,tenant:{...ctx.tenant,categoryKey:'retail_boutique'}},'products.read'),{code:'CATEGORY_UNAVAILABLE'});
  assert.throws(()=>menu.access({...ctx,membership:{...ctx.membership,status:'inactive'}},'products.read'),{code:'CATEGORY_UNAVAILABLE'});
  assert.throws(()=>menu.access({...ctx,membership:{...ctx.membership,role:'agent'}},'products.manage'),{code:'PERMISSION_DENIED'});
});

test('modifier groups and options validate bilingual labels, selection bounds and QAR minor units',()=>{
  assert.deepEqual(menu.groupInput({nameEn:'Size',nameAr:'الحجم',minSelections:0,maxSelections:2}),{nameEn:'Size',nameAr:'الحجم',min:0,max:2,status:'active'});
  assert.deepEqual(menu.optionInput({nameEn:'Large',nameAr:'كبير',priceDeltaMinor:250}),{nameEn:'Large',nameAr:'كبير',priceDeltaMinor:250,status:'active'});
  for(const input of [{nameEn:'',maxSelections:1},{nameEn:'Choice',minSelections:3,maxSelections:2},{nameEn:'Choice',minSelections:0,maxSelections:21}])assert.throws(()=>menu.groupInput(input));
  for(const input of [{nameEn:'',priceDeltaMinor:0},{nameEn:'Extra',priceDeltaMinor:-1},{nameEn:'Extra',priceDeltaMinor:1.5}])assert.throws(()=>menu.optionInput(input));
});

test('restaurant order hours use the branch timezone and reserve preparation time before closing',()=>{
  const {isAcceptingOrders}=require('../modules/platform/tenant-branches');
  const hours={monday:[{open:'09:00',close:'17:00'}]};
  assert.equal(isAcceptingOrders(hours,'Asia/Qatar',new Date('2026-10-26T06:30:00Z')),true);
  assert.equal(isAcceptingOrders(hours,'Asia/Qatar',new Date('2026-10-26T14:00:00Z')),false,'the exact closing minute is closed');
  assert.equal(isAcceptingOrders(hours,'Asia/Qatar',new Date('2026-10-26T13:40:00Z'),20),true,'preparation can finish exactly at closing');
  assert.equal(isAcceptingOrders(hours,'Asia/Qatar',new Date('2026-10-26T13:41:00Z'),20),false,'preparation cannot finish after closing');
  assert.equal(isAcceptingOrders({},'Asia/Qatar',new Date('2026-10-26T06:30:00Z')),false,'missing hours fail closed');
  assert.equal(isAcceptingOrders(hours,'invalid/timezone',new Date('2026-10-26T06:30:00Z')),false,'invalid time zones fail closed');
});

test('restaurant category remains private and migration preserves tenant and branch constraints',()=>{
  const {restaurantCafe}=require('../modules/platform/categories');
  assert.equal(restaurantCafe.public,false);
  assert.equal(restaurantCafe.planable,true);
  assert.ok(restaurantCafe.capabilities.includes('restaurant.menu'));
  assert.ok(restaurantCafe.capabilities.includes('restaurant.orders'));
  const migration=fs.readFileSync(path.join(__dirname,'../database/migrations/20270110_restaurant_menu.sql'),'utf8');
  assert.match(migration,/FOREIGN KEY \(tenant_id,branch_id\) REFERENCES sx_tenant_branches\(tenant_id,id\)/);
  assert.match(migration,/UNIQUE KEY uq_sx_restaurant_menu_item_branch_product \(tenant_id,branch_id,product_id\)/);
  assert.match(migration,/FOREIGN KEY \(tenant_id,menu_item_id\) REFERENCES sx_restaurant_menu_items\(tenant_id,id\)/);
  assert.doesNotMatch(migration,/\bDROP\s+(?:TABLE|COLUMN|INDEX)\b/i);
});

test('existing business panel loads bilingual menu editor using the shared workspace session and API',()=>{
  const root=path.join(__dirname,'..');
  const router=fs.readFileSync(path.join(root,'modules/platform/restaurant-menu-router.js'),'utf8');
  const mount=fs.readFileSync(path.join(root,'modules/platform/mount-existing-upgrade.js'),'utf8');
  const api=fs.readFileSync(path.join(root,'client/public/workspace-api.js'),'utf8');
  const screen=fs.readFileSync(path.join(root,'client/public/restaurant-menu-workspace.js'),'utf8');
  const sidebar=fs.readFileSync(path.join(root,'client/public/training-sidebar.js'),'utf8');
  const shell=fs.readFileSync(path.join(root,'client/public/index.html'),'utf8');
  assert.match(router,/router\.use\(express\.json\(\{limit:'16kb',strict:true\}\),authenticate\)/);
  assert.match(mount,/\/api\/workspace\/restaurant-menu/);
  assert.match(api,/restaurantMenu:'\/api\/workspace\/restaurant-menu'/);
  assert.match(screen,/SaleMaxWorkspace\.session\(\)/);
  assert.match(screen,/SaleMaxWorkspace\.request\('restaurantMenu'/);
  assert.match(screen,/session\.categoryKey!=='restaurant_cafe'/);
  assert.match(screen,/menu pricing and availability/i);
  assert.match(screen,/Modifier option added/);
  assert.match(screen,/does not accept or confirm customer orders/i);
  assert.match(sidebar,/restaurant-menu/);
  assert.match(shell,/restaurant-menu-workspace\.js/);
});
