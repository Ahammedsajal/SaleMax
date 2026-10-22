'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const inventory=require('../modules/platform/retail-inventory');
const categories=require('../modules/platform/categories');
const {discover}=require('../database/migration-runner');

const tenantId='11111111-1111-4111-8111-111111111111';
const identityId='22222222-2222-4222-8222-222222222222';
const membershipId='33333333-3333-4333-8333-333333333333';
const locationId='44444444-4444-4444-8444-444444444444';
const productId='55555555-5555-4555-8555-555555555555';
const requestKey='66666666-6666-4666-8666-666666666666';
const retail=categories.retailShop;
const context=(role='owner',overrides={})=>({audience:'tenant',identity:{id:identityId},tenant:{id:tenantId,status:'active',categoryKey:retail.key,categoryVersion:retail.version},membership:{id:membershipId,tenantId,role,status:'active'},category:retail,subscription:{status:'active',categoryKey:retail.key,categoryVersion:retail.version,capabilities:retail.capabilities},...overrides});
const adjustment=(overrides={})=>({locationId,productId,quantityDelta:'5.250',reason:'opening_balance',note:'Opening count',requestKey,expectedRevision:0,...overrides});

test('Retail is private and non-planable until the category workflow is accepted',()=>{
  assert.equal(retail.key,'retail_shop');
  assert.equal(retail.public,false);
  assert.equal(retail.planable,false);
  assert.ok(retail.capabilities.includes('retail.inventory'));
  assert.equal(categories.listCategories().find(item=>item.key==='retail_shop').planable,false);
});

test('stock quantities round-trip MariaDB DECIMAL strings including zero exactly',()=>{
  assert.equal(inventory.quantityMilli('15.125'),15125n);
  assert.equal(inventory.quantityMilli('-0.125'),-125n);
  assert.equal(inventory.quantityMilli('0.000',{allowZero:true}),0n);
  assert.equal(inventory.formatQuantity('0.000'),'0.000');
  assert.equal(inventory.formatQuantity('15.125'),'15.125');
  assert.equal(inventory.formatQuantity(-125n),'-0.125');
  assert.throws(()=>inventory.quantityMilli('0.000'),{code:'INVALID_STOCK_QUANTITY'});
  assert.throws(()=>inventory.quantityMilli('1000000000000000.000'),{code:'INVALID_STOCK_QUANTITY'});
});

test('inventory reads and adjustments enforce category, plan and role authority',()=>{
  assert.equal(inventory.authorize(context(),'inventory.adjust').allowed,true);
  assert.equal(inventory.authorize(context('accountant'),'inventory.read').allowed,true);
  assert.throws(()=>inventory.authorize(context('accountant'),'inventory.adjust'),{code:'PERMISSION_DENIED'});
  assert.throws(()=>inventory.authorize(context('agent'),'inventory.adjust'),{code:'PERMISSION_DENIED'});
  const training=categories.trainingCenter;
  assert.throws(()=>inventory.authorize(context('owner',{tenant:{id:tenantId,status:'active',categoryKey:training.key,categoryVersion:1},category:training,subscription:{status:'active',categoryKey:training.key,categoryVersion:1,capabilities:training.capabilities}}),'inventory.read'),{code:'CATEGORY_UNAVAILABLE'});
  assert.throws(()=>inventory.authorize(context('owner',{subscription:{status:'active',categoryKey:retail.key,categoryVersion:1,capabilities:[]}}),'inventory.read'),{code:'FEATURE_UNAVAILABLE'});
});

test('location creation commits its audit record atomically and rolls back on audit failure',async()=>{
  const calls=[];let rolledBack=false,committed=false;
  const db={beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{rolledBack=true;},query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('retail.inventory-location-created'))throw Object.assign(Error('audit failure'),{code:'AUDIT_FAILED'});return [{affectedRows:1}];}};
  await assert.rejects(inventory.createLocation(db,context(),{code:'MAIN',nameEn:'Main store',nameAr:'المتجر الرئيسي'}),{code:'AUDIT_FAILED'});
  assert.equal(rolledBack,true);assert.equal(committed,false);
  assert.equal(calls.length,2);assert.match(calls[0].sql,/tenant_id/);assert.equal(calls[0].args[1],tenantId);
});

test('stock listing binds tenant scope and formats stored decimal quantities',async()=>{
  const calls=[],db={query:async(sql,args)=>{calls.push({sql,args});if(sql.startsWith('SELECT id FROM sx_retail_locations'))return [[{id:locationId}]];if(sql.startsWith('SELECT COUNT'))return [[{total:1}]];if(sql.startsWith('SELECT p.id'))return [[{productId,code:'ITEM-1',nameEn:'Tea',nameAr:'شاي',quantityOnHand:'0.000',revision:0}]];throw Error('UNEXPECTED_QUERY');}};
  const result=await inventory.listStock(db,context('accountant'),{locationId,search:'Tea'});
  assert.equal(result.items[0].quantityOnHand,'0.000');
  assert.equal(result.items[0].revision,0);
  assert.ok(calls.every(call=>call.args.includes(tenantId)));
  assert.match(calls[1].sql,/p\.tenant_id=\?/);
  assert.match(calls[2].sql,/b\.tenant_id=p\.tenant_id/);
});

test('stock adjustments are repeat-safe, revision guarded and never allow negative stock',async()=>{
  const state={balance:null,movements:[]},calls=[];
  const db={
    beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},
    query:async(sql,args)=>{
      calls.push({sql,args});
      if(sql.includes('FROM sx_retail_stock_movements WHERE tenant_id=? AND request_key=?'))return [state.movements.filter(row=>row.requestKey===args[1])];
      if(sql.startsWith('SELECT id FROM sx_retail_locations'))return [[{id:locationId}]];
      if(sql.startsWith('SELECT id FROM sx_product_catalog'))return [[{id:productId}]];
      if(sql.startsWith('INSERT INTO sx_retail_inventory_balances')){if(!state.balance)state.balance={quantityOnHand:'0.000',revision:0};return [{affectedRows:1}];}
      if(sql.startsWith('SELECT quantity_on_hand AS quantityOnHand'))return [[state.balance&&{...state.balance}].filter(Boolean)];
      if(sql.startsWith('UPDATE sx_retail_inventory_balances')){state.balance={quantityOnHand:args[0],revision:args[1]};return [{affectedRows:1}];}
      if(sql.startsWith('INSERT INTO sx_retail_stock_movements')){state.movements.push({id:args[0],locationId:args[2],productId:args[3],requestKey:args[4],payloadHash:args[5],quantityDelta:args[6],quantityAfter:args[7],revision:args[8],reason:args[9],note:args[10],createdAt:'2026-10-22 12:00:00.000'});return [{affectedRows:1}];}
      if(sql.startsWith('INSERT INTO sx_audit_events'))return [{affectedRows:1}];
      if(sql.startsWith('SELECT created_at AS createdAt'))return [[{createdAt:'2026-10-22 12:00:00.000'}]];
      throw Error(`UNEXPECTED_QUERY ${sql}`);
    },
  };
  const first=await inventory.adjust(db,context(),adjustment());
  assert.equal(first.balance.quantityOnHand,'5.250');assert.equal(first.balance.revision,1);assert.equal(first.movement.createdAt,'2026-10-22 12:00:00.000');
  const replay=await inventory.adjust(db,context(),adjustment());
  assert.equal(replay.replayed,true);assert.equal(replay.balance.quantityOnHand,'5.250');
  await assert.rejects(inventory.adjust(db,context(),adjustment({quantityDelta:'4.000'})),{code:'IDEMPOTENCY_CONFLICT'});
  await assert.rejects(inventory.adjust(db,context(),adjustment({requestKey:'77777777-7777-4777-8777-777777777777',reason:'correction',quantityDelta:'-6.000',expectedRevision:1})),{code:'INSUFFICIENT_STOCK'});
  assert.equal(state.balance.quantityOnHand,'5.250');assert.equal(state.balance.revision,1);
  assert.ok(calls.filter(call=>call.sql.includes('tenant_id=?')).length>=8);
});

test('forward migration is discoverable and encodes tenant-bound ledger constraints',()=>{
  const root=path.join(__dirname,'../database/migrations'),migration=discover(root).find(item=>item.file==='20261227_retail_inventory.sql');
  assert.ok(migration);assert.equal(migration.statements.length,3);
  const sql=fs.readFileSync(path.join(root,migration.file),'utf8');
  assert.match(sql,/PRIMARY KEY \(tenant_id,location_id,product_id\)/);
  assert.match(sql,/UNIQUE KEY uq_sx_retail_movement_request \(tenant_id,request_key\)/);
  assert.match(sql,/FOREIGN KEY \(tenant_id,product_id\) REFERENCES sx_product_catalog\(tenant_id,id\)/);
  assert.match(sql,/CHECK \(quantity_on_hand >= 0\)/);
  assert.doesNotMatch(sql,/UPDATE sx_plan_versions/);
});
