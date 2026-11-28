'use strict';
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {randomUUID} = require('node:crypto');
const mysql = require('mysql2/promise');
const express = require('express');

async function main() {
  process.env.SALEMAX_PLATFORM_KEY_BASE64=require('node:crypto').randomBytes(32).toString('base64');
  const socketPath = process.env.INVENTORY_TEST_SOCKET;
  assert.match(socketPath || '', /^\/(?:private\/)?tmp\//);
  const database = 'inventory_test_' + randomUUID().replaceAll('-', '');
  const admin = await mysql.createConnection({socketPath, user: 'root'});
  await admin.query('CREATE DATABASE ' + database);
  const pool = mysql.createPool({socketPath, user: 'root', database, decimalNumbers:false});
  const tenant = randomUUID(), other = randomUUID(), item = randomUUID(), foreign = randomUUID(), legacy = randomUUID(), profiled = randomUUID(), fresh = randomUUID();
  const identity = randomUUID(), location = randomUUID(), secondLocation = randomUUID();
  const category = require('../modules/platform/categories').getCategory('retail_boutique', 1);
  assert.equal(category.public, false);
  const app = express();
  function authenticate(req,res,next){
    const role = req.get('x-test-role');
    if (!role) return res.sendStatus(401);
    req.businessContext = {audience: 'tenant', category, identity: {id: identity},
      tenant: {id: tenant, status: 'active', categoryKey: category.key, categoryVersion: 1},
      membership: {tenantId: tenant, status: 'active', role},
      subscription: {status: 'active', capabilities: category.capabilities}};
    next();
  }
  app.use(require('../modules/platform/business-inventory-router')({pool,authenticate}));
  app.use('/retail',require('../modules/platform/retail-commerce-router').workspaceRouter({pool,authenticate}));
  let server;
  try {
    await pool.query(`CREATE TABLE sx_tenants (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,status VARCHAR(20) NOT NULL DEFAULT 'active',
      category_key VARCHAR(80) NOT NULL DEFAULT 'retail_boutique',category_version INT NOT NULL DEFAULT 1,
      timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Qatar') ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_identities (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_product_catalog (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      code VARCHAR(40),name_en VARCHAR(200),name_ar VARCHAR(200),description_en TEXT,description_ar TEXT,deleted_at DATETIME NULL,status VARCHAR(20),
      UNIQUE KEY uq_test_product_tenant_id(tenant_id,id)) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_retail_locations (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      code VARCHAR(40),name_en VARCHAR(120),name_ar VARCHAR(120),address VARCHAR(500),map_pin VARCHAR(48),
      accepts_pickup TINYINT DEFAULT 1,accepts_delivery TINYINT DEFAULT 1,is_default TINYINT DEFAULT 0,status VARCHAR(20),
      UNIQUE KEY uq_test_location_tenant_id(tenant_id,id)) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_business_stock_movements (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,actor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      previous_revision VARCHAR(20) NOT NULL,previous_quantity INT UNSIGNED NOT NULL,quantity INT UNSIGNED NOT NULL,reason VARCHAR(200) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),UNIQUE KEY uq_business_stock_request(tenant_id,product_id,location_id,request_id),
      KEY ix_business_stock_history(tenant_id,product_id,location_id,id)) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_retail_stock_reservations (
      tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      quantity INT UNSIGNED NOT NULL,PRIMARY KEY(tenant_id,product_id,location_id,order_id)) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_retail_stock_transfers (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      source_location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,target_location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      quantity INT UNSIGNED NOT NULL,reason VARCHAR(200) NOT NULL,actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      UNIQUE KEY uq_retail_stock_transfer_request(tenant_id,request_id)) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_retail_return_lines (
      tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,return_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      quantity INT UNSIGNED NOT NULL,PRIMARY KEY(tenant_id,return_id,product_id)) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_retail_orders (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,request_hash CHAR(64) NOT NULL,
      buyer_name VARCHAR(120) NOT NULL,buyer_phone VARCHAR(30) NOT NULL,buyer_email VARCHAR(254) NULL,
      delivery_address VARCHAR(500) NOT NULL,delivery_pin VARCHAR(48) NULL,delivery_zone VARCHAR(100) NULL,
      fulfillment ENUM('pickup','delivery') NOT NULL,order_lines JSON NOT NULL,total_minor BIGINT UNSIGNED NOT NULL,
      delivery_fee INT UNSIGNED NOT NULL,location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      customer_directory_key CHAR(64) NULL,external_source_connection_id CHAR(36) NULL,delivery_state VARCHAR(32) NULL,delivery_proof_required TINYINT(1) NOT NULL DEFAULT 0,driver_id CHAR(36) NULL,
      status ENUM('placed','ready','dispatched','completed','cancelled','returned','partially_returned') NOT NULL DEFAULT 'placed',
      cash_received_at DATETIME(3) NULL,cash_received_by CHAR(36) NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_test_retail_request(tenant_id,request_id)) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_retail_store (
      tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,slug VARCHAR(80) NOT NULL UNIQUE,title VARCHAR(160) NOT NULL,
      about TEXT NOT NULL,contact VARCHAR(200) NOT NULL,delivery_fee INT UNSIGNED NULL,delivery_zones JSON NULL,enabled TINYINT(1) NOT NULL DEFAULT 1) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_retail_listings (
      tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,product_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      category VARCHAR(100) NOT NULL DEFAULT '',published TINYINT(1) NOT NULL DEFAULT 0,photo_id CHAR(36) NULL,
      PRIMARY KEY(tenant_id,product_id)) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_retail_variant_groups (
      id CHAR(36) PRIMARY KEY,tenant_id CHAR(36) NOT NULL,title_en VARCHAR(160),title_ar VARCHAR(160),option_label_en VARCHAR(80),option_label_ar VARCHAR(80)) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_retail_variant_products (
      tenant_id CHAR(36) NOT NULL,group_id CHAR(36) NOT NULL,product_id CHAR(36) NOT NULL,value_en VARCHAR(100),value_ar VARCHAR(100),sort_order SMALLINT NOT NULL,
      PRIMARY KEY(tenant_id,product_id)) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_product_offers (
      id CHAR(36) PRIMARY KEY,tenant_id CHAR(36) NOT NULL,course_id CHAR(36) NOT NULL,version INT NOT NULL,currency CHAR(3) NOT NULL,
      price_minor BIGINT UNSIGNED NOT NULL,valid_from DATE NULL,valid_until DATE NULL,status VARCHAR(20) NOT NULL) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_plan_versions (
      id CHAR(36) PRIMARY KEY,status VARCHAR(20) NOT NULL,category_key VARCHAR(80) NOT NULL,category_version INT NOT NULL,capabilities JSON NOT NULL) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_plan_assignments (
      id CHAR(36) PRIMARY KEY,tenant_id CHAR(36) NOT NULL,plan_version_id CHAR(36) NOT NULL,status VARCHAR(20) NOT NULL,
      current_tenant VARCHAR(36) NULL,effective_from DATETIME(3) NOT NULL,expires_at DATETIME(3) NULL) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_retail_customer_notification_consents (
      tenant_id CHAR(36) NOT NULL,order_id CHAR(36) NOT NULL,channel VARCHAR(20) NOT NULL,purpose VARCHAR(40) NOT NULL,status VARCHAR(20) NOT NULL,
      destination_hash CHAR(64) NULL,PRIMARY KEY(tenant_id,order_id)) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_retail_cash_receipts (
      id CHAR(36) PRIMARY KEY,tenant_id CHAR(36) NOT NULL,order_id CHAR(36) NOT NULL,request_id CHAR(36) NOT NULL,request_hash CHAR(64) NOT NULL,
      amount_minor BIGINT UNSIGNED NOT NULL,collector_membership_id CHAR(36) NOT NULL,recorded_by_identity_id CHAR(36) NOT NULL,
      settlement_id CHAR(36) NULL,received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_test_retail_cash_order(tenant_id,order_id),UNIQUE KEY uq_test_retail_cash_request(tenant_id,request_id)) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_retail_returns (
      id CHAR(36) PRIMARY KEY,tenant_id CHAR(36) NOT NULL,order_id CHAR(36) NOT NULL,request_id CHAR(36) NOT NULL,request_hash CHAR(64) NOT NULL,
      reason VARCHAR(200) NOT NULL,restocked TINYINT(1) NOT NULL,created_by_identity_id CHAR(36) NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_test_retail_return_request(tenant_id,request_id)) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_business_notification_settings (
      tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,enabled TINYINT(1) NOT NULL DEFAULT 1,
      daily_enabled TINYINT(1) NOT NULL DEFAULT 1,daily_time TIME NOT NULL DEFAULT '18:00:00',qr_instance_id BIGINT UNSIGNED NULL,
      retail_orders_enabled TINYINT(1) NOT NULL DEFAULT 0,retail_customer_updates_enabled TINYINT(1) NOT NULL DEFAULT 0) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_business_notification_events (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      event_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      kind ENUM('invoice_issued','payment_due','payment_received','daily_summary','ai_usage_monthly','chatbot_handoff','retail_order_event','retail_customer_order_event') NOT NULL,
      source_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,source_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      payload_json JSON NULL,status ENUM('queued','prepared','failed') NOT NULL DEFAULT 'queued',last_error_code VARCHAR(100) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),UNIQUE KEY uq_test_business_event(tenant_id,event_key)) ENGINE=InnoDB`);
    await pool.query("INSERT INTO sx_tenants(id,status,category_key,timezone) VALUES (?,'active','retail_boutique','Asia/Qatar'),(?,'active','retail_boutique','Asia/Qatar')",[tenant,other]);
    await pool.query('INSERT INTO sx_identities(id) VALUES (?)',[identity]);
    await pool.query("INSERT INTO sx_product_catalog(id,tenant_id,code,name_en,name_ar,deleted_at,status) VALUES (?,?,'YARD-1','Fabric','قماش',NULL,'active'),(?,?,'OTHER','Other','آخر',NULL,'active'),(?,?,'LEGACY','Legacy','قديم',NULL,'active'),(?,?,'PROFILED','Profiled','محدد',NULL,'active'),(?,?,'FRESH','Fresh','جديد',NULL,'active')", [item, tenant, foreign, other, legacy, tenant,profiled,tenant,fresh,tenant]);
    await pool.query("UPDATE sx_product_catalog SET description_en='Fabric sold by yard',description_ar='قماش يباع بالياردة' WHERE tenant_id=? AND id=?",[tenant,item]);
    await pool.query("INSERT INTO sx_retail_locations (id,tenant_id,code,name_en,name_ar,address,map_pin,accepts_pickup,accepts_delivery,is_default,status) VALUES (?,?,'main','Main','الرئيسي','',NULL,1,1,1,'active'),(?,?,'west','West','الغربي','',NULL,1,1,0,'active')", [location,tenant,secondLocation,tenant]);
    const planVersion=randomUUID(),planAssignment=randomUUID();
    await pool.query("INSERT INTO sx_plan_versions(id,status,category_key,category_version,capabilities) VALUES (?,'published','retail_boutique',1,JSON_ARRAY('retail.commerce'))",[planVersion]);
    await pool.query("INSERT INTO sx_plan_assignments(id,tenant_id,plan_version_id,status,current_tenant,effective_from,expires_at) VALUES (?,?,?,'active',?,'2000-01-01 00:00:00','2099-01-01 00:00:00')",[planAssignment,tenant,planVersion,tenant]);
    await pool.query("INSERT INTO sx_retail_store(tenant_id,slug,title,about,contact,delivery_fee,delivery_zones,enabled) VALUES (?,'essentials-test','Essentials Test','Synthetic retail store','',NULL,JSON_ARRAY(),1)",[tenant]);
    await pool.query("INSERT INTO sx_retail_listings(tenant_id,product_id,category,published) VALUES (?,?,'fabric',1)",[tenant,item]);
    await pool.query("INSERT INTO sx_product_offers(id,tenant_id,course_id,version,currency,price_minor,valid_from,valid_until,status) VALUES (?,?,?,1,'QAR',2000,NULL,NULL,'active')",[randomUUID(),tenant,item]);
    await pool.query(`INSERT INTO sx_business_stock_movements
      (tenant_id,product_id,location_id,request_id,actor_id,previous_revision,previous_quantity,quantity,reason)
      VALUES (?,?,?,?,?,'0',0,7,'Legacy whole stock')`,[tenant,legacy,location,randomUUID(),identity]);
    await pool.query(`CREATE TABLE sx_retail_customer_search_tokens (
      tenant_id CHAR(36),connection_id CHAR(36),source_kind VARCHAR(30),source_id VARCHAR(191),
      customer_directory_key CHAR(64),token_kind VARCHAR(20),token_hash CHAR(64),
      PRIMARY KEY(tenant_id,source_kind,source_id,token_kind,token_hash)) ENGINE=InnoDB`);
    const migration=readFileSync(require.resolve('../database/migrations/20270207_retail_exact_inventory_quantities.sql'),'utf8');
    for(const statement of migration.split(';').map(value=>value.replace(/^--.*$/gm,'').trim()).filter(Boolean))await pool.query(statement);
    const alertMigration=readFileSync(require.resolve('../database/migrations/20270209_retail_inventory_alerts.sql'),'utf8');
    for(const statement of alertMigration.split(';').map(value=>value.replace(/^--.*$/gm,'').trim()).filter(Boolean))await pool.query(statement);
    await pool.query(`INSERT INTO sx_retail_product_inventory_units
      (tenant_id,product_id,base_unit_code,quantity_precision,quantity_increment,revision,updated_by_identity_id)
      VALUES (?,?,'yard',2,0.250000,4,?)`,[tenant,profiled,identity]);
    await pool.query(`INSERT INTO sx_business_stock_movements
      (tenant_id,product_id,location_id,request_id,actor_id,previous_revision,previous_quantity,quantity,reason)
      VALUES (?, ?, ?, ?, ?, '0',0,5,'Existing configured unit movement')`,[tenant,profiled,location,randomUUID(),identity]);
    const historicalOrderId=randomUUID();
    await pool.query(`INSERT INTO sx_retail_orders
      (id,tenant_id,request_id,request_hash,buyer_name,buyer_phone,delivery_address,fulfillment,order_lines,total_minor,delivery_fee,location_id,status)
      VALUES (?,?,?,?,?,'+97455550001','', 'pickup',JSON_ARRAY(JSON_OBJECT('id',?,'quantity','0.25','quantityPrecision',2,'quantityIncrement','0.25')),
        500,0,?,'completed')`,[historicalOrderId,tenant,randomUUID(),'a'.repeat(64),'Historic Buyer',profiled,location]);
    const recountMigration=readFileSync(require.resolve('../database/migrations/20270212_retail_inventory_unit_recount.sql'),'utf8');
    for(const statement of recountMigration.split(';').map(value=>value.replace(/^--.*$/gm,'').trim()).filter(Boolean))await pool.query(statement);
    await pool.query('INSERT INTO sx_business_notification_settings(tenant_id,enabled) VALUES (?,1)',[tenant]);
    const [[legacyRow]]=await pool.query('SELECT CAST(quantity AS CHAR) AS quantity FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=?',[tenant,legacy]);
    assert.equal(String(legacyRow.quantity),'7.000000');
    const [[profiledMovement]]=await pool.query('SELECT previous_unit_revision AS previousUnitRevision,unit_revision AS unitRevision FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=?',[tenant,profiled]);
    assert.equal(Number(profiledMovement.previousUnitRevision),4,'existing movements inherit the locked profile revision');
    assert.equal(Number(profiledMovement.unitRevision),4,'existing movement quantity remains in its configured historical unit');
    const [[historicalOrder]]=await pool.query('SELECT JSON_EXTRACT(order_lines,\'$[0].unitRevision\') AS unitRevision FROM sx_retail_orders WHERE tenant_id=? AND id=?',[tenant,historicalOrderId]);
    assert.equal(historicalOrder.unitRevision,null,'migration leaves old order snapshots intact for guarded runtime handling');
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const send = (path, role, body, method=body?'POST':'GET') => fetch('http://127.0.0.1:' + server.address().port + path, {
      method,
      headers: {'content-type': 'application/json', ...(role && {'x-test-role': role})},
      body: body && JSON.stringify(body)
    });
    const noneLow=await send('/?locationId='+location+'&lowStock=1','owner');
    assert.equal(noneLow.status,200);
    assert.deepEqual((await noneLow.json()).data.items,[],'items without configured thresholds stay out of low-stock view');
    const legacyPreviewResponse=await send('/products/'+legacy+'/unit/rebase-preview','owner');
    assert.equal(legacyPreviewResponse.status,200);
    const legacyPreview=(await legacyPreviewResponse.json()).data;
    assert.equal(legacyPreview.canRebase,true);
    assert.equal(legacyPreview.product.unitRevision,0);
    assert.equal(legacyPreview.locations.find(value=>value.id===location).currentQuantity,7);
    assert.equal((await send('/products/'+legacy+'/threshold','owner',{locationId:location,lowStockThreshold:'3',expectedRevision:'0'},'PUT')).status,200);
    const legacyRebaseBody={baseUnitCode:'yard',baseUnitLabel:'',baseUnitLabelAr:'',quantityPrecision:2,quantityIncrement:'0.25',expectedUnitRevision:'0',reason:'Initial physical yard recount',
      locations:legacyPreview.locations.map(value=>({locationId:value.id,expectedStockRevision:String(value.expectedStockRevision),quantity:value.id===location?'2.25':'0.75'}))};
    assert.equal((await send('/products/'+legacy+'/unit/rebase','agent',{...legacyRebaseBody,requestId:randomUUID()})).status,403);
    assert.equal((await send('/products/'+legacy+'/unit/rebase','owner',{...legacyRebaseBody,requestId:randomUUID(),locations:legacyRebaseBody.locations.map((value,index)=>index?value:{...value,quantity:'0.1'})})).status,400,
      'recount quantities must honor the new unit increment');
    const incompleteRebase=await send('/products/'+legacy+'/unit/rebase','owner',{...legacyRebaseBody,requestId:randomUUID(),locations:legacyRebaseBody.locations.slice(0,1)});
    assert.equal(incompleteRebase.status,409);assert.equal((await incompleteRebase.json()).code,'INVENTORY_REBASE_LOCATIONS_CHANGED');
    const staleRebase=await send('/products/'+legacy+'/unit/rebase','owner',{...legacyRebaseBody,requestId:randomUUID(),locations:legacyRebaseBody.locations.map(value=>({...value,expectedStockRevision:'999999'}))});
    assert.equal(staleRebase.status,409);assert.equal((await staleRebase.json()).code,'STOCK_CHANGED');
    const legacyRebaseRequestId=randomUUID();
    const legacyRebase=await send('/products/'+legacy+'/unit/rebase','owner',{...legacyRebaseBody,requestId:legacyRebaseRequestId});
    const legacyRebasePayload=await legacyRebase.json();
    assert.equal(legacyRebase.status,200,JSON.stringify(legacyRebasePayload));
    const legacyRebaseResult=legacyRebasePayload.data;
    assert.equal(legacyRebaseResult.unitRevision,1);assert.equal(legacyRebaseResult.thresholdsDisabled,true);
    const legacyReplay=await send('/products/'+legacy+'/unit/rebase','owner',{...legacyRebaseBody,requestId:legacyRebaseRequestId});
    assert.equal(legacyReplay.status,200);assert.equal((await legacyReplay.json()).data.replayed,true,'physical recount retry is idempotent');
    const conflictingReplay=await send('/products/'+legacy+'/unit/rebase','owner',{...legacyRebaseBody,requestId:legacyRebaseRequestId,reason:'Different recount'});
    assert.equal(conflictingReplay.status,409,'same idempotency key cannot represent different recount data');
    const legacyHistory=await (await send('/'+legacy+'/history?locationId='+location,'owner')).json();
    assert.equal(legacyHistory.data[0].previousQuantity,'7');assert.equal(legacyHistory.data[0].quantity,'2.25');
    assert.equal(legacyHistory.data[0].previousUnit.baseUnitCode,'unit');assert.equal(legacyHistory.data[0].unit.baseUnitCode,'yard');
    assert.equal(legacyHistory.data[1].unit.baseUnitCode,'unit','legacy movement history retains its original unit');
    const [[legacyThreshold]]=await pool.query('SELECT low_stock_threshold AS threshold FROM sx_retail_inventory_location_thresholds WHERE tenant_id=? AND product_id=? AND location_id=?',[tenant,legacy,location]);
    assert.equal(legacyThreshold.threshold,null,'unit rebasing clears thresholds that use the old unit');
    const [[legacyAlertState]]=await pool.query('SELECT observed_state AS observed,notified_state AS notified FROM sx_retail_inventory_alert_states WHERE tenant_id=? AND product_id=? AND location_id=?',[tenant,legacy,location]);
    assert.equal(legacyAlertState.observed,'unknown');assert.equal(legacyAlertState.notified,'unknown');
    assert.equal((await send('/products/'+legacy+'/unit','owner',{baseUnitCode:'yard',baseUnitLabel:'',baseUnitLabelAr:'',quantityPrecision:2,quantityIncrement:'0.5',expectedRevision:'1'},'PUT')).status,409,'ordinary unit changes remain locked after movement');
    const profiledPreview=(await (await send('/products/'+profiled+'/unit/rebase-preview','owner')).json()).data;
    assert.equal(profiledPreview.canRebase,true);
    const profiledRebase=await send('/products/'+profiled+'/unit/rebase','owner',{requestId:randomUUID(),baseUnitCode:'piece',baseUnitLabel:'',baseUnitLabelAr:'',
      quantityPrecision:0,quantityIncrement:'1',expectedUnitRevision:String(profiledPreview.product.unitRevision),reason:'Synthetic legacy-order unit change',
      locations:profiledPreview.locations.map(value=>({locationId:value.id,expectedStockRevision:String(value.expectedStockRevision),quantity:value.id===location?'1':'0'}))});
    assert.equal(profiledRebase.status,200,'legacy SKU profile can be recounted with known per-location counts');
    await assert.rejects(require('../modules/platform/retail-commerce').returnItems(pool,tenant,{identityId:identity},historicalOrderId,
      {requestId:randomUUID(),reason:'Old snapshot return',restock:true,lines:[{id:profiled,quantity:'0.25'}]}),{code:'RETURN_UNIT_RECOUNT_REQUIRED'});
    await assert.rejects(require('../modules/platform/retail-commerce').transition(pool,tenant,{identityId:identity},historicalOrderId,'returned',false),{code:'RETURN_UNIT_RECOUNT_REQUIRED'});
    const historicalNoRestock=await require('../modules/platform/retail-commerce').returnItems(pool,tenant,{identityId:identity},historicalOrderId,
      {requestId:randomUUID(),reason:'Old snapshot requires manual stock review',restock:false,lines:[{id:profiled,quantity:'0.25'}]});
    assert.equal(historicalNoRestock.status,'returned','legacy order lines without a unit snapshot can be returned without automatic stock conversion');
    const freshCount=await send('/'+fresh+'/count','owner',{requestId:randomUUID(),expectedRevision:'0',quantity:'2',reason:'Synthetic default-unit opening count',locationId:location});
    assert.equal(freshCount.status,200,'first movement seeds a historical version even when the SKU has no explicit unit profile');
    const freshHistory=await (await send('/'+fresh+'/history?locationId='+location,'owner')).json();
    assert.equal(freshHistory.data[0].unit.baseUnitCode,'unit');
    const freshPreview=(await (await send('/products/'+fresh+'/unit/rebase-preview','owner')).json()).data;
    const freshRebase=await send('/products/'+fresh+'/unit/rebase','owner',{requestId:randomUUID(),baseUnitCode:'panel',baseUnitLabel:'',baseUnitLabelAr:'',
      quantityPrecision:0,quantityIncrement:'1',expectedUnitRevision:String(freshPreview.product.unitRevision),reason:'Synthetic new-SKU recount',
      locations:freshPreview.locations.map(value=>({locationId:value.id,expectedStockRevision:String(value.expectedStockRevision),quantity:value.id===location?'1':'0'}))});
    assert.equal(freshRebase.status,200,'new SKUs can be recounted after their first stock movement');
    const freshRecountHistory=await (await send('/'+fresh+'/history?locationId='+location,'owner')).json();
    assert.equal(freshRecountHistory.data[0].previousUnit.baseUnitCode,'unit');assert.equal(freshRecountHistory.data[0].unit.baseUnitCode,'panel');
    const unitBody={baseUnitCode:'yard',baseUnitLabel:'',quantityPrecision:2,quantityIncrement:'0.25',expectedRevision:'0'};
    assert.equal((await send('/','agent')).status,403);
    assert.equal((await send('/products/'+foreign+'/unit','owner',unitBody,'PUT')).status,404);
    assert.equal((await send('/products/'+item+'/unit','owner',{...unitBody,quantityPrecision:1,quantityIncrement:'0.25'},'PUT')).status,400);
    const configured=await send('/products/'+item+'/unit','owner',unitBody,'PUT');
    assert.equal(configured.status,200);
    assert.equal((await configured.json()).data.quantityIncrement,'0.25');
    const countA={requestId:randomUUID(),expectedRevision:'0',quantity:'1.25',reason:'Opening measure',locationId:location};
    const countB={requestId:randomUUID(),expectedRevision:'0',quantity:'2.25',reason:'Opening measure',locationId:location};
    assert.equal((await send('/'+foreign+'/count','owner',countA)).status,404);
    const race=await Promise.all([send('/'+item+'/count','owner',countA),send('/'+item+'/count','manager',countB)]);
    assert.deepEqual(race.map(result=>result.status).sort(),[200,409]);
    const winnerIndex=race[0].status===200?0:1,winningBody=winnerIndex===0?countA:countB;
    assert.equal((await send('/'+item+'/count','owner',winningBody)).status,200);
    const stock=await (await send('/?locationId='+location,'accountant')).json();
    const row=stock.data.items.find(value=>value.id===item);
    assert.equal(row.baseUnitCode,'yard');assert.equal(row.quantityPrecision,2);assert.equal(typeof row.quantityPrecision,'number');
    assert.equal(typeof row.unitRevision,'number');assert.equal(typeof row.thresholdRevision,'number');assert.equal(row.quantityIncrement,'0.25');
    assert.ok(['1.25','2.25'].includes(row.quantity));assert.equal(row.reserved,0);
    const unchangedUnit=await send('/products/'+item+'/unit','owner',{...unitBody,expectedRevision:String(row.unitRevision)},'PUT');
    assert.equal(unchangedUnit.status,200);assert.equal((await unchangedUnit.json()).data.revision,1,'saving an unchanged unit does not create a revision or block returns');
    assert.equal((await send('/'+item+'/count','owner',{...winningBody,requestId:randomUUID(),expectedRevision:row.revision,quantity:'1.10'})).status,400);
    const threshold=await send('/products/'+item+'/threshold','owner',{locationId:location,lowStockThreshold:'0.50',expectedRevision:'0'},'PUT');
    assert.equal(threshold.status,200);
    assert.equal((await send('/retail/notifications','agent',{retailOrdersEnabled:true,retailInventoryEnabled:true},'PUT')).status,403);
    const notificationSettings=await send('/retail/notifications','owner',{retailOrdersEnabled:true,retailInventoryEnabled:true},'PUT');
    assert.equal(notificationSettings.status,200);
    const [[settings]]=await pool.query('SELECT retail_orders_enabled AS ordersEnabled,retail_inventory_enabled AS inventoryEnabled FROM sx_business_notification_settings WHERE tenant_id=?',[tenant]);
    assert.equal(Number(settings.ordersEnabled),1);assert.equal(Number(settings.inventoryEnabled),1);
    assert.equal((await send('/products/'+item+'/unit','owner',{...unitBody,expectedRevision:'1',quantityIncrement:'0.5'},'PUT')).status,409);
    const adjust=await send('/'+item+'/count','owner',{requestId:randomUUID(),expectedRevision:row.revision,quantity:'0.25',reason:'Low stock test',locationId:location});
    assert.equal(adjust.status,200);
    const low=await (await send('/?locationId='+location,'owner')).json();
    assert.equal(low.data.items.find(value=>value.id===item).lowStock,true);
    const alertService=require('../modules/platform/retail-inventory-alerts');
    const alertDb=await pool.getConnection();try{await alertService.evaluate(alertDb,tenant,item,location);}finally{alertDb.release();}
    let [alertEvents]=await pool.query("SELECT event_key,payload_json FROM sx_business_notification_events WHERE tenant_id=? AND kind='retail_inventory_event' ORDER BY event_key",[tenant]);
    assert.equal(alertEvents.length,1,'rechecking the same low state does not duplicate the alert');
    const lowRow=low.data.items.find(value=>value.id===item);
    assert.equal((await send('/'+item+'/count','owner',{requestId:randomUUID(),expectedRevision:lowRow.revision,quantity:'0.75',reason:'Back in stock',locationId:location})).status,200);
    const healthy=await (await send('/?locationId='+location,'owner')).json(),healthyRow=healthy.data.items.find(value=>value.id===item);
    assert.equal(healthyRow.lowStock,false);
    assert.equal((await send('/'+item+'/count','owner',{requestId:randomUUID(),expectedRevision:healthyRow.revision,quantity:'0.25',reason:'Low again',locationId:location})).status,200);
    [alertEvents]=await pool.query("SELECT event_key,payload_json FROM sx_business_notification_events WHERE tenant_id=? AND kind='retail_inventory_event' ORDER BY event_key",[tenant]);
    assert.equal(alertEvents.length,3,'low, back-in-stock and a later low transition each enqueue once');
    assert.deepEqual(alertEvents.map(row=>(typeof row.payload_json==='string'?JSON.parse(row.payload_json):row.payload_json).state),['low','healthy','low']);
    const badTransfer=await send('/stock/transfers','owner',{productId:item,sourceLocationId:location,targetLocationId:secondLocation,requestId:randomUUID(),quantity:'0.1',reason:'invalid increment'});
    assert.equal(badTransfer.status,400);
    const transfer=await send('/stock/transfers','owner',{productId:item,sourceLocationId:location,targetLocationId:secondLocation,requestId:randomUUID(),quantity:'0.25',reason:'Move between stores'});
    const transferResult=await transfer.json();assert.equal(transfer.status,200,JSON.stringify(transferResult));
    const from=await (await send('/?locationId='+location,'owner')).json(),to=await (await send('/?locationId='+secondLocation,'owner')).json();
    assert.equal(from.data.items.find(value=>value.id===item).quantity,0);
    assert.equal(to.data.items.find(value=>value.id===item).quantity,'0.25');
    const history=await (await send('/'+item+'/history?locationId='+secondLocation,'owner')).json();
    assert.equal(history.data[0].quantity,'0.25');
    const beforeOrders=await (await send('/?locationId='+location,'owner')).json();
    const beforeOrder=beforeOrders.data.items.find(value=>value.id===item);
    assert.equal((await send('/'+item+'/count','owner',{requestId:randomUUID(),expectedRevision:beforeOrder.revision,quantity:'0.75',reason:'Synthetic order lifecycle stock',locationId:location})).status,200);
    const commerce=require('../modules/platform/retail-commerce');
    const checkoutBody=requestId=>({requestId,name:'Synthetic Buyer',phone:'+97455550000',fulfillment:'pickup',locationId:location,
      lines:[{id:item,quantity:'0.50'}],expectedTotal:1000});
    const competing=[checkoutBody(randomUUID()),checkoutBody(randomUUID())];
    const raceOrders=await Promise.allSettled(competing.map(body=>commerce.checkout(pool,'essentials-test',body)));
    assert.equal(raceOrders.filter(result=>result.status==='fulfilled').length,1,
      'only one 0.50-yard checkout fits in 0.75 yards: '+raceOrders.map(result=>result.status==='fulfilled'?'fulfilled':`${result.reason.code||result.reason.name}: ${result.reason.message}`).join(' | '));
    const failedOrder=raceOrders.find(result=>result.status==='rejected');
    assert.equal(failedOrder.reason.code,'STOCK_CHANGED');
    const acceptedIndex=raceOrders.findIndex(result=>result.status==='fulfilled'),acceptedBody=competing[acceptedIndex],accepted=raceOrders[acceptedIndex].value;
    const [[acceptedOrder]]=await pool.query('SELECT status,total_minor AS total FROM sx_retail_orders WHERE tenant_id=? AND id=?',[tenant,accepted.reference]);
    assert.equal(acceptedOrder.status,'placed');assert.equal(Number(acceptedOrder.total),1000);
    const [[reservation]]=await pool.query('SELECT CAST(quantity AS CHAR) AS quantity FROM sx_retail_stock_reservations WHERE tenant_id=? AND product_id=? AND order_id=?',[tenant,item,accepted.reference]);
    assert.equal(reservation.quantity,'0.500000');
    const activePreview=(await (await send('/products/'+item+'/unit/rebase-preview','owner')).json()).data;
    assert.equal(activePreview.hasReservations,true);assert.equal(activePreview.hasOpenOrders,true);
    const blockedRebase=await send('/products/'+item+'/unit/rebase','owner',{requestId:randomUUID(),baseUnitCode:'piece',baseUnitLabel:'',baseUnitLabelAr:'',
      quantityPrecision:0,quantityIncrement:'1',expectedUnitRevision:String(activePreview.product.unitRevision),reason:'Must wait for order',
      locations:activePreview.locations.map(value=>({locationId:value.id,expectedStockRevision:String(value.expectedStockRevision),quantity:'0'}))});
    assert.equal(blockedRebase.status,409);assert.equal((await blockedRebase.json()).code,'INVENTORY_REBASE_HAS_OPEN_STOCK');
    const replay=await commerce.checkout(pool,'essentials-test',acceptedBody);
    assert.equal(replay.reference,accepted.reference,'checkout retry returns the same order');
    let [[orderCount]]=await pool.query("SELECT COUNT(*) AS n FROM sx_retail_orders WHERE tenant_id=? AND JSON_SEARCH(order_lines,'one',?,NULL,'$[*].id') IS NOT NULL",[tenant,item]);
    assert.equal(Number(orderCount.n),1,'failed concurrent checkout leaves no order');
    await commerce.transition(pool,tenant,{identityId:identity},accepted.reference,'cancelled',false);
    let [[reservationCount]]=await pool.query('SELECT COUNT(*) AS n FROM sx_retail_stock_reservations WHERE tenant_id=? AND product_id=?',[tenant,item]);
    assert.equal(Number(reservationCount.n),0,'cancellation releases the fractional reservation');
    let afterCancel=await (await send('/?locationId='+location,'owner')).json();
    assert.equal(afterCancel.data.items.find(value=>value.id===item).quantity,'0.75');

    const fulfilBody=checkoutBody(randomUUID());
    const fulfilOrder=await commerce.checkout(pool,'essentials-test',fulfilBody);
    await commerce.transition(pool,tenant,{identityId:identity},fulfilOrder.reference,'ready',false);
    await commerce.recordCashReceipt(pool,tenant,{identityId:identity,membershipId:identity,role:'owner'},fulfilOrder.reference,
      {requestId:randomUUID(),amountMinor:1000});
    await commerce.transition(pool,tenant,{identityId:identity},fulfilOrder.reference,'completed',false);
    let afterFulfil=await (await send('/?locationId='+location,'owner')).json();
    assert.equal(afterFulfil.data.items.find(value=>value.id===item).quantity,'0.25','fulfilment deducts exact fractional stock');
    const firstReturn={requestId:randomUUID(),reason:'Synthetic partial return',restock:true,lines:[{id:item,quantity:'0.25'}]};
    const partial=await commerce.returnItems(pool,tenant,{identityId:identity},fulfilOrder.reference,firstReturn);
    assert.equal(partial.status,'partially_returned');
    const returnCountAfterFirst=await pool.query('SELECT COUNT(*) AS n FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=? AND location_id=?',[tenant,item,location]);
    const duplicateReturn=await commerce.returnItems(pool,tenant,{identityId:identity},fulfilOrder.reference,firstReturn);
    assert.equal(duplicateReturn.replayed,true,'return retry is idempotent');
    const returnCountAfterReplay=await pool.query('SELECT COUNT(*) AS n FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=? AND location_id=?',[tenant,item,location]);
    assert.equal(Number(returnCountAfterReplay[0][0].n),Number(returnCountAfterFirst[0][0].n),'replayed return adds no stock movement');
    await assert.rejects(commerce.returnItems(pool,tenant,{identityId:identity},fulfilOrder.reference,
      {requestId:randomUUID(),reason:'Excess synthetic return',restock:true,lines:[{id:item,quantity:'0.50'}]}),{code:'RETURN_QUANTITY_EXCEEDED'});
    const finalReturn=await commerce.returnItems(pool,tenant,{identityId:identity},fulfilOrder.reference,
      {requestId:randomUUID(),reason:'Synthetic remaining return',restock:true,lines:[{id:item,quantity:'0.25'}]});
    assert.equal(finalReturn.status,'returned');
    const afterReturn=await (await send('/?locationId='+location,'owner')).json();
    assert.equal(afterReturn.data.items.find(value=>value.id===item).quantity,'0.75','restocked returns restore exact fractional stock');
    const oldUnitOrder=await commerce.checkout(pool,'essentials-test',{...checkoutBody(randomUUID()),lines:[{id:item,quantity:'0.25'}],expectedTotal:500});
    await commerce.transition(pool,tenant,{identityId:identity},oldUnitOrder.reference,'ready',false);
    await commerce.recordCashReceipt(pool,tenant,{identityId:identity,membershipId:identity,role:'owner'},oldUnitOrder.reference,
      {requestId:randomUUID(),amountMinor:500});
    await commerce.transition(pool,tenant,{identityId:identity},oldUnitOrder.reference,'completed',false);
    const beforeUnitRebase=(await (await send('/products/'+item+'/unit/rebase-preview','owner')).json()).data;
    assert.equal(beforeUnitRebase.canRebase,true);
    const oldMovementCount=await pool.query('SELECT COUNT(*) AS n FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=?',[tenant,item]);
    const itemRebase=await send('/products/'+item+'/unit/rebase','owner',{requestId:randomUUID(),baseUnitCode:'piece',baseUnitLabel:'',baseUnitLabelAr:'',
      quantityPrecision:0,quantityIncrement:'1',expectedUnitRevision:String(beforeUnitRebase.product.unitRevision),reason:'Synthetic test unit change',
      locations:beforeUnitRebase.locations.map(value=>({locationId:value.id,expectedStockRevision:String(value.expectedStockRevision),quantity:value.id===location?'1':'0'}))});
    assert.equal(itemRebase.status,200,JSON.stringify(await itemRebase.json()));
    await assert.rejects(commerce.returnItems(pool,tenant,{identityId:identity},oldUnitOrder.reference,
      {requestId:randomUUID(),reason:'Historical yard return',restock:true,lines:[{id:item,quantity:'0.25'}]}),{code:'RETURN_UNIT_RECOUNT_REQUIRED'});
    await assert.rejects(commerce.transition(pool,tenant,{identityId:identity},oldUnitOrder.reference,'returned',false),{code:'RETURN_UNIT_RECOUNT_REQUIRED'});
    const noRestock=await commerce.returnItems(pool,tenant,{identityId:identity},oldUnitOrder.reference,
      {requestId:randomUUID(),reason:'Historical yard return without guessed conversion',restock:false,lines:[{id:item,quantity:'0.25'}]});
    assert.equal(noRestock.status,'returned');
    const newMovementCount=await pool.query('SELECT COUNT(*) AS n FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=?',[tenant,item]);
    assert.equal(Number(newMovementCount[0][0].n),Number(oldMovementCount[0][0].n)+2,'only the two physical recount locations add stock movements');
    const rebasedStock=(await (await send('/?locationId='+location,'owner')).json()).data.items.find(value=>value.id===item);
    assert.equal(rebasedStock.baseUnitCode,'piece');assert.equal(rebasedStock.quantity,1);
    console.log('Exact inventory, role denial, audited multi-location unit rebase, historical unit snapshots/returns, concurrent counts and checkouts, reservations, cancellation, fulfilment, fractional returns, alerts, transfers, and history passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    await admin.query('DROP DATABASE ' + database);
    await admin.end();
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
