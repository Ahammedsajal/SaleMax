'use strict';
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {randomUUID} = require('node:crypto');
const mysql = require('mysql2/promise');
const express = require('express');

async function main() {
  const socketPath = process.env.INVENTORY_TEST_SOCKET;
  assert.match(socketPath || '', /^\/(?:private\/)?tmp\//);
  const database = 'inventory_test_' + randomUUID().replaceAll('-', '');
  const admin = await mysql.createConnection({socketPath, user: 'root'});
  await admin.query('CREATE DATABASE ' + database);
  const pool = mysql.createPool({socketPath, user: 'root', database, decimalNumbers:false});
  const tenant = randomUUID(), other = randomUUID(), item = randomUUID(), foreign = randomUUID(), legacy = randomUUID();
  const identity = randomUUID(), location = randomUUID(), secondLocation = randomUUID();
  const category = require('../modules/platform/categories').getCategory('retail_boutique', 1);
  assert.equal(category.public, false);
  const app = express();
  app.use(require('../modules/platform/business-inventory-router')({pool, authenticate(req, res, next) {
    const role = req.get('x-test-role');
    if (!role) return res.sendStatus(401);
    req.businessContext = {audience: 'tenant', category, identity: {id: identity},
      tenant: {id: tenant, status: 'active', categoryKey: category.key, categoryVersion: 1},
      membership: {tenantId: tenant, status: 'active', role},
      subscription: {status: 'active', capabilities: category.capabilities}};
    next();
  }}));
  let server;
  try {
    await pool.query(`CREATE TABLE sx_tenants (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_identities (id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE sx_product_catalog (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      code VARCHAR(40),name_en VARCHAR(200),name_ar VARCHAR(200),deleted_at DATETIME NULL,status VARCHAR(20),
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
      location_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,order_lines JSON NOT NULL,status VARCHAR(32) NOT NULL) ENGINE=InnoDB`);
    await pool.query('INSERT INTO sx_tenants(id) VALUES (?), (?)',[tenant,other]);
    await pool.query('INSERT INTO sx_identities(id) VALUES (?)',[identity]);
    await pool.query("INSERT INTO sx_product_catalog VALUES (?,?,'YARD-1','Fabric','قماش',NULL,'active'),(?,?,'OTHER','Other','آخر',NULL,'active'),(?,?,'LEGACY','Legacy','قديم',NULL,'active')", [item, tenant, foreign, other, legacy, tenant]);
    await pool.query("INSERT INTO sx_retail_locations (id,tenant_id,code,name_en,name_ar,address,map_pin,accepts_pickup,accepts_delivery,is_default,status) VALUES (?,?,'main','Main','الرئيسي','',NULL,1,1,1,'active'),(?,?,'west','West','الغربي','',NULL,1,1,0,'active')", [location,tenant,secondLocation,tenant]);
    await pool.query(`INSERT INTO sx_business_stock_movements
      (tenant_id,product_id,location_id,request_id,actor_id,previous_revision,previous_quantity,quantity,reason)
      VALUES (?,?,?,?,?,'0',0,7,'Legacy whole stock')`,[tenant,legacy,location,randomUUID(),identity]);
    const migration=readFileSync(require.resolve('../database/migrations/20270207_retail_exact_inventory_quantities.sql'),'utf8');
    for(const statement of migration.split(';').map(value=>value.replace(/^--.*$/gm,'').trim()).filter(Boolean))await pool.query(statement);
    const [[legacyRow]]=await pool.query('SELECT CAST(quantity AS CHAR) AS quantity FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=?',[tenant,legacy]);
    assert.equal(String(legacyRow.quantity),'7.000000');
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const send = (path, role, body, method=body?'POST':'GET') => fetch('http://127.0.0.1:' + server.address().port + path, {
      method,
      headers: {'content-type': 'application/json', ...(role && {'x-test-role': role})},
      body: body && JSON.stringify(body)
    });
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
    assert.equal(row.baseUnitCode,'yard');assert.equal(row.quantityPrecision,2);assert.equal(row.quantityIncrement,'0.25');
    assert.ok(['1.25','2.25'].includes(row.quantity));assert.equal(row.reserved,0);
    assert.equal((await send('/'+item+'/count','owner',{...winningBody,requestId:randomUUID(),expectedRevision:row.revision,quantity:'1.10'})).status,400);
    const threshold=await send('/products/'+item+'/threshold','owner',{locationId:location,lowStockThreshold:'0.50',expectedRevision:'0'},'PUT');
    assert.equal(threshold.status,200);
    assert.equal((await send('/products/'+item+'/unit','owner',{...unitBody,expectedRevision:'1',quantityIncrement:'0.5'},'PUT')).status,409);
    const adjust=await send('/'+item+'/count','owner',{requestId:randomUUID(),expectedRevision:row.revision,quantity:'0.25',reason:'Low stock test',locationId:location});
    assert.equal(adjust.status,200);
    const low=await (await send('/?locationId='+location,'owner')).json();
    assert.equal(low.data.items.find(value=>value.id===item).lowStock,true);
    const badTransfer=await send('/stock/transfers','owner',{productId:item,sourceLocationId:location,targetLocationId:secondLocation,requestId:randomUUID(),quantity:'0.1',reason:'invalid increment'});
    assert.equal(badTransfer.status,400);
    const transfer=await send('/stock/transfers','owner',{productId:item,sourceLocationId:location,targetLocationId:secondLocation,requestId:randomUUID(),quantity:'0.25',reason:'Move between stores'});
    const transferResult=await transfer.json();assert.equal(transfer.status,200,JSON.stringify(transferResult));
    const from=await (await send('/?locationId='+location,'owner')).json(),to=await (await send('/?locationId='+secondLocation,'owner')).json();
    assert.equal(from.data.items.find(value=>value.id===item).quantity,0);
    assert.equal(to.data.items.find(value=>value.id===item).quantity,'0.25');
    const history=await (await send('/'+item+'/history?locationId='+secondLocation,'owner')).json();
    assert.equal(history.data[0].quantity,'0.25');
    console.log('Exact inventory migration, role and tenant denial, SKU units/increments, stock race, thresholds, location transfer, and history passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    await admin.query('DROP DATABASE ' + database);
    await admin.end();
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
