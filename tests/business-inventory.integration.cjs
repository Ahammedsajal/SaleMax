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
  const pool = mysql.createPool({socketPath, user: 'root', database});
  const tenant = randomUUID(), other = randomUUID(), item = randomUUID(), foreign = randomUUID();
  const category = require('../modules/platform/categories').getCategory('retail_boutique', 1);
  assert.equal(category.public, false);
  const app = express();
  app.use(require('../modules/platform/business-inventory-router')({pool, authenticate(req, res, next) {
    const role = req.get('x-test-role');
    if (!role) return res.sendStatus(401);
    req.businessContext = {audience: 'tenant', category, identity: {id: tenant},
      tenant: {id: tenant, status: 'active', categoryKey: category.key, categoryVersion: 1},
      membership: {tenantId: tenant, status: 'active', role},
      subscription: {status: 'active', capabilities: category.capabilities}};
    next();
  }}));
  let server;
  try {
    await pool.query('CREATE TABLE sx_product_catalog (id CHAR(36) PRIMARY KEY, tenant_id CHAR(36), code VARCHAR(40), name_en VARCHAR(200), name_ar VARCHAR(200), deleted_at DATETIME NULL, status VARCHAR(20)) ENGINE=InnoDB');
    await pool.query(readFileSync(require.resolve('../database/migrations/20270125_private_business_inventory.sql'), 'utf8'));
    await pool.query("INSERT INTO sx_product_catalog VALUES (?,?,'TEST','Test item','عنصر تجريبي',NULL,'active'),(?,?,'OTHER','Other','آخر',NULL,'active')", [item, tenant, foreign, other]);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const send = (path, role, body) => fetch('http://127.0.0.1:' + server.address().port + path, {
      method: body ? 'POST' : 'GET',
      headers: {'content-type': 'application/json', ...(role && {'x-test-role': role})},
      body: body && JSON.stringify(body)
    });
    const payload = {requestId: randomUUID(), expectedRevision: '0', quantity: 12, reason: 'Opening stock'};
    const path = '/' + item + '/count';
    assert.equal((await send('/')).status, 401);
    assert.equal((await send('/', 'agent')).status, 403);
    assert.equal((await send(path, 'accountant', payload)).status, 403);
    assert.equal((await send('/' + foreign + '/count', 'owner', payload)).status, 404);
    const race = await Promise.all([send(path, 'owner', payload), send(path, 'manager', {...payload, requestId: randomUUID()})]);
    assert.deepEqual(race.map(result => result.status).sort(), [200, 409]);
    const winner = race[0].status === 200;
    if (winner) assert.equal((await send(path, 'owner', payload)).status, 200);
    const data = await (await send('/', 'accountant')).json();
    assert.deepEqual(data.data.items.map(product => [product.id, product.quantity]), [[item, 12]]);
    const history = await (await send('/' + item + '/history', 'owner')).json();
    assert.equal(history.data.length, 1);
    console.log('Inventory migration, role and tenant denials, final revision race, and history passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    await admin.query('DROP DATABASE ' + database);
    await admin.end();
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
