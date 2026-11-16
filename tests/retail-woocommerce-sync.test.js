'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const Module = require('node:module');
const {splitSql} = require('../database/migration-runner');
const connector = require('../modules/platform/retail-connected-stores');
const load = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'express') return {};
  return load.call(this, request, parent, isMain);
};
const {syncWoo, processWebhook} = require('../modules/platform/retail-connected-stores-router');
Module._load = load;

test('Retail connector preserves decimal amounts and quantities without binary float arithmetic', () => {
  assert.equal(connector.safeAmount('0.1'), '0.100000');
  assert.equal(connector.safeAmount('0.0000005'), '0.000001');
  assert.equal(connector.safeAmount('-0.0000005'), '-0.000001');
  assert.equal(connector.decimalAdd(['0.1','0.2','-0.05']), '0.250000');
  assert.equal(connector.decimalAbs('-2.500000'), '2.500000');
  assert.equal(connector.safeQuantity('1.125'), '1.125000');
  assert.throws(() => connector.safeAmount('1e3'), /INVALID_PROVIDER_AMOUNT/);
  assert.throws(() => connector.safeQuantity('-0.25'), /INVALID_PROVIDER_QUANTITY/);
});

test('Woo products, variations and order breakdowns retain source IDs, SKUs, quantities and stock evidence', () => {
  const product = connector.normalizeProduct('woocommerce', {id: 100, name: 'Linen', sku: 'LINEN', price: '', status: 'publish',
    variations: [101, 102], manage_stock: false, stock_quantity: null, stock_status: 'instock', date_modified_gmt: '2026-11-15T10:00:00'});
  assert.equal(product.id, '100');
  assert.equal(product.sku, 'LINEN');
  assert.equal(product.variationCount, 2);
  assert.equal(product.priceUnavailable, true);
  assert.deepEqual(product.sourceStock, {managed: false, quantity: null, status: 'instock'});

  const variation = connector.normalizeProductVariation('woocommerce', 100, {id: 101, sku: 'LINEN-M', price: '20.10',
    parent_id: 100, status: 'publish', purchasable: true, attributes: [{name: 'Size', option: 'M'}], manage_stock: true, stock_quantity: '2.5', stock_status: 'instock'}, 'QAR');
  assert.equal(variation.id, '101');
  assert.equal(variation.productId, '100');
  assert.equal(variation.sku, 'LINEN-M');
  assert.equal(variation.status, 'publish');
  assert.equal(variation.purchasable, true);
  assert.equal(variation.price, '20.100000');
  assert.equal(variation.sourceStock.quantity, '2.500000');

  const order = connector.normalizeOrder('woocommerce', {id: 900, status: 'processing', currency: 'QAR', total: '115.50',
    subtotal: '100.00', discount_total: '5.00', shipping_total: '10.00', total_tax: '10.50', fee_lines: [{name: 'Gift wrap', total: '1.25'}],
    refunds: [{id: 12, total: '-2.00'}], date_modified_gmt: '2026-11-15T10:00:00', line_items: [
      {id: 1, product_id: 100, variation_id: 101, sku: 'LINEN-M', name: 'Linen M', quantity: '1.25', subtotal: '100.00', total: '95.00', total_tax: '9.5'},
    ]});
  assert.equal(order.updatedAt, '2026-11-15T10:00:00');
  assert.deepEqual(order.breakdown, {subtotal: '100.000000', discount: '5.000000', shipping: '10.000000', tax: '10.500000', fees: '1.250000', refunds: '2.000000'});
  assert.equal(order.lineItems[0].quantity, '1.250000');
  assert.equal(order.lineItems[0].discount, '5.000000');
  assert.equal(order.lineItems[0].variantId, '101');
});

test('Woo sync paginates source resources and imports variations through GET-only requests', async () => {
  const originalRequest = connector.requestHttps;
  const originalKey = process.env.SALEMAX_PLATFORM_KEY_BASE64;
  const originalFetch = globalThis.fetch;
  const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const connectionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  process.env.SALEMAX_PLATFORM_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');
  const creds = connector.seal({consumerKey: 'ck_' + 'A'.repeat(32), consumerSecret: 'cs_' + 'B'.repeat(32)}, tenantId, connectionId, 'credentials');
  const connection = {id: connectionId, tenant_id: tenantId, provider: 'woocommerce', status: 'active', default_currency: 'QAR',
    store_domain: 'https://store.example.com', sync_cursor: null, credentials_ciphertext: creds.ciphertext,
    credentials_iv: creds.iv, credentials_auth_tag: creds.authTag};
  const requests = [], writes = [];
  connector.requestHttps = async (url, options) => {
    requests.push({url, method: options.method || 'GET'});
    const parsed = new URL(url), pathname = parsed.pathname, page = Number(parsed.searchParams.get('page') || 1);
    let rows;
    if (pathname.endsWith('/products/100/variations')) rows = [{id: 101, parent_id: 100, sku: 'LINEN-M', price: '20.00',
      attributes: [{name: 'Size', option: 'M'}], stock_quantity: '3', manage_stock: true, stock_status: 'instock', date_modified_gmt: '2026-11-15T10:00:00'}];
    else if (pathname.endsWith('/products') && page === 1) rows = [{id: 100, name: 'Linen', sku: 'LINEN', price: '20.00', status: 'publish',
      variations: [101], date_modified_gmt: '2026-11-15T10:00:00'}];
    else if (pathname.endsWith('/products')) rows = [{id: 200, name: 'Cotton', sku: 'COTTON', price: '5.00', status: 'publish',
      variations: [], date_modified_gmt: '2026-11-15T11:00:00'}];
    else if (pathname.endsWith('/orders') && page === 1) rows = [{id: 900, status: 'processing', currency: 'QAR', total: '20.00', subtotal: '20.00',
      discount_total: '0.00', shipping_total: '0.00', total_tax: '0.00', fee_lines: [], refunds: [], date_modified_gmt: '2026-11-15T10:00:00',
      line_items: [{id: 1, product_id: 100, variation_id: 101, sku: 'LINEN-M', name: 'Linen M', quantity: '1', subtotal: '20.00', total: '20.00', total_tax: '0.00'}]}];
    else if (pathname.endsWith('/orders')) rows = [{id: 901, status: 'processing', currency: 'QAR', total: '5.00', subtotal: '5.00',
      discount_total: '0.00', shipping_total: '0.00', total_tax: '0.00', fee_lines: [], refunds: [], date_modified_gmt: '2026-11-15T11:00:00', line_items: []}];
    else if (pathname.endsWith('/customers') && page === 1) rows = [{id: 5, email: 'pilot@example.invalid', first_name: 'Synthetic', date_modified_gmt: '2026-11-15T10:00:00'}];
    else if (pathname.endsWith('/customers')) rows = [{id: 6, email: 'second@example.invalid', first_name: 'Synthetic Two', date_modified_gmt: '2026-11-15T11:00:00'}];
    else throw new Error('Unexpected Woo request: ' + pathname);
    const paged = !pathname.endsWith('/products/100/variations');
    return {status: 200, headers: {'x-wp-totalpages': paged ? '2' : '1', 'x-wp-total': paged ? '2' : String(rows.length)}, data: rows};
  };
  let stagedCursor = null, committedCursor = null;
  const writer = {beginTransaction: async()=>{stagedCursor = null;}, commit: async()=>{if(stagedCursor)committedCursor=stagedCursor;}, rollback: async()=>{stagedCursor=null;}, release: ()=>{}, query: async(sql,params)=>{
    writes.push({sql,params});
    if(sql.includes('SET sync_cursor=?'))stagedCursor=params[0];
    return sql.startsWith('SELECT source_updated_at') ? [[],[]] : [{affectedRows: 1},[]];
  }};
  const pool = {get cursor(){return committedCursor;}, query: async(sql,params)=>{
    if (sql.includes('SET sync_cursor=?')) committedCursor = params[0];
    return [{affectedRows: 1},[]];
  }, getConnection: async()=>writer};
  try {
    const first = await syncWoo(pool, connection);
    assert.equal(first.complete, false);
    assert.equal(first.resources.products.hasMore, true);
    assert.equal(first.resources.variations.imported, 1);
    connection.sync_cursor = pool.cursor;
    const second = await syncWoo(pool, connection);
    assert.equal(second.complete, true);
    assert.equal(second.resources.products.sourceTotal, 2);
    assert.equal(second.resources.orders.sourceTotal, 2);
    assert.equal(second.resources.customers.sourceTotal, 2);
    assert.equal(second.resources.orders.scanned, 2);
    assert.ok(requests.length >= 7);
    assert.ok(requests.every(request => request.method === 'GET'));
    assert.ok(requests.some(request => new URL(request.url).pathname.endsWith('/products/100/variations')));
    assert.ok(requests.some(request => new URL(request.url).searchParams.get('page') === '2'));
    assert.ok(requests.filter(request => /\/products(?:\/\d+\/variations)?$/.test(new URL(request.url).pathname) || /\/orders$/.test(new URL(request.url).pathname))
      .every(request => new URL(request.url).searchParams.get('status') === 'any'));
    assert.ok(writes.some(write => write.sql.includes('external_variant_id')));
    assert.ok(writes.some(write => write.sql.includes('subtotal_amount')));
    const cursor = JSON.parse(pool.cursor).woocommerce;
    assert.equal(cursor.lastCompleteScan.sourceCounts.orders.total, 2);
    assert.equal(cursor.lastCompleteScan.queryScope.products.status, 'any');
    assert.equal(cursor.lastCompleteScan.orderAmounts['QAR|processing|unknown'].total, '25.000000');
  } finally {
    connector.requestHttps = originalRequest;
    if (originalKey === undefined) delete process.env.SALEMAX_PLATFORM_KEY_BASE64;
    else process.env.SALEMAX_PLATFORM_KEY_BASE64 = originalKey;
    globalThis.fetch = originalFetch;
  }
});

test('older provider snapshots cannot replace newer synced records', () => {
  assert.equal(connector.sourceTimestampIsStale('2026-11-15T10:00:00Z', '2026-11-15T09:59:59Z'), true);
  assert.equal(connector.sourceTimestampIsStale('2026-11-15T10:00:00Z', '2026-11-15T10:00:00Z'), false);
  assert.equal(connector.sourceTimestampIsStale('2026-11-15T10:00:00Z', null), true);
});

test('Woo variation and reconciliation migration parses as additive SQL', () => {
  const migration = fs.readFileSync(path.resolve(__dirname, '../database/migrations/20270205_retail_woocommerce_variations_reconciliation.sql'), 'utf8');
  const statements = splitSql(migration);
  assert.equal(statements.length, 3);
  assert.match(statements[0], /^ALTER TABLE sx_retail_external_orders/i);
  assert.match(statements[1], /^ALTER TABLE sx_retail_external_products/i);
  assert.match(statements[2], /^CREATE TABLE sx_retail_external_product_variants/i);
  assert.doesNotMatch(migration, /\bDROP\s+(TABLE|COLUMN)\b/i);
});

test('redacted customers are not restored by later order or checkout imports', async () => {
  const originalKey = process.env.SALEMAX_PLATFORM_KEY_BASE64;
  process.env.SALEMAX_PLATFORM_KEY_BASE64 = Buffer.alloc(32, 9).toString('base64');
  const tenantId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const connectionId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const connection = {id: connectionId, tenant_id: tenantId, provider: 'woocommerce', default_currency: 'QAR'};
  const writes = [];
  const db = {query: async(sql,params)=>{
    if (sql.startsWith('SELECT source_updated_at AS sourceUpdatedAt,customer_status AS customerStatus FROM sx_retail_external_customers')) {
      return [[{sourceUpdatedAt: new Date('2026-11-15T10:00:00Z'), customerStatus: 'redacted'}],[]];
    }
    if (sql.startsWith('SELECT source_updated_at AS sourceUpdatedAt FROM sx_retail_external_orders') ||
        sql.startsWith('SELECT source_updated_at AS sourceUpdatedAt FROM sx_retail_external_checkouts')) return [[],[]];
    writes.push({sql,params});return [{affectedRows:1},[]];
  }};
  try {
    await connector.upsertCustomer(db, connection, {id: 55, email: 'private@example.invalid', date_modified_gmt: '2026-11-15T11:00:00'});
    await connector.upsertOrder(db, connection, {id: 900, status: 'processing', currency: 'QAR', total: '20.00', customer_id: 55,
      billing: {email: 'private@example.invalid', first_name: 'Private'}, date_modified_gmt: '2026-11-15T11:00:00', line_items: []});
    await connector.upsertCheckout(db, connection, {id: 990, status: 'abandoned', currency: 'QAR', total: '20.00',
      customer: {id: 55, email: 'private@example.invalid'}, recoveryUrl: 'https://store.example.com/cart/?key=private',
      contactConsent: 'granted', updated_at: '2026-11-15T11:00:00'});
    assert.equal(writes.some(write => write.sql.startsWith('INSERT INTO sx_retail_external_customers')), false);
    const orderWrite = writes.find(write => write.sql.startsWith('INSERT INTO sx_retail_external_orders'));
    const checkoutWrite = writes.find(write => write.sql.startsWith('INSERT INTO sx_retail_external_checkouts'));
    assert.ok(orderWrite && checkoutWrite);
    assert.equal(orderWrite.params[14], null);
    assert.equal(orderWrite.params[15], 'unknown');
    assert.equal(orderWrite.params[17], null);
    const order = connector.openJson({ciphertext: orderWrite.params[20], iv: orderWrite.params[21], authTag: orderWrite.params[22]}, tenantId, connectionId, 'order:900');
    assert.equal(order.customer, null);
    assert.equal(checkoutWrite.params[6], null);
    assert.equal(checkoutWrite.params[7], 'unknown');
    assert.equal(checkoutWrite.params[12], null);
    const checkout = connector.openJson({ciphertext: checkoutWrite.params[15], iv: checkoutWrite.params[16], authTag: checkoutWrite.params[17]}, tenantId, connectionId, 'checkout:990');
    assert.equal(checkout.customer, null);
    assert.equal(checkout.recoveryUrl, null);
  } finally {
    if (originalKey === undefined) delete process.env.SALEMAX_PLATFORM_KEY_BASE64;
    else process.env.SALEMAX_PLATFORM_KEY_BASE64 = originalKey;
  }
});

test('Woo webhook deliveries are signed, replay-safe and ignore stale order snapshots', async () => {
  const originalKey = process.env.SALEMAX_PLATFORM_KEY_BASE64;
  process.env.SALEMAX_PLATFORM_KEY_BASE64 = Buffer.alloc(32, 8).toString('base64');
  const tenantId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const connectionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const secret = 'pilot-signing-secret';
  const raw = Buffer.from(JSON.stringify({id: 900, status: 'processing', currency: 'QAR', total: '20.00',
    date_modified_gmt: '2026-11-15T09:00:00', line_items: []}));
  const signature = require('node:crypto').createHmac('sha256', secret).update(raw).digest('base64');
  assert.equal(connector.wooSignature(raw, signature, secret), true);
  assert.equal(connector.wooSignature(raw, 'invalid', secret), false);
  let eventStatus = null;
  const writes = [];
  const db = {beginTransaction: async()=>{}, commit: async()=>{}, rollback: async()=>{}, release: ()=>{}, query: async(sql,params)=>{
    writes.push(sql);
    if (sql.startsWith('INSERT IGNORE INTO sx_retail_external_events')) {
      if (!eventStatus) { eventStatus = 'received'; return [{affectedRows:1},[]]; }
      return [{affectedRows:0},[]];
    }
    if (sql.includes('SELECT id,status FROM sx_retail_external_events')) return [[{id: 1, status: eventStatus}],[]];
    if (sql.includes('UPDATE sx_retail_external_events SET status=\'processed\'')) { eventStatus = 'processed'; return [{affectedRows:1},[]]; }
    if (sql.startsWith('SELECT source_updated_at AS sourceUpdatedAt FROM sx_retail_external_orders')) {
      return [[{sourceUpdatedAt: new Date('2026-11-15T10:00:00Z')}],[]];
    }
    return [{affectedRows:1},[]];
  }};
  const pool = {getConnection: async()=>db, query: async()=>[{affectedRows:1},[]]};
  const connection = {id: connectionId, tenant_id: tenantId, provider: 'woocommerce', default_currency: 'QAR'};
  try {
    const first = await processWebhook(pool, connection, {topic:'order.updated', resource:'order', eventId:'delivery-1', raw});
    assert.equal(first.duplicate, false);
    assert.equal(eventStatus, 'processed');
    assert.ok(writes.some(sql => sql.startsWith('SELECT source_updated_at AS sourceUpdatedAt FROM sx_retail_external_orders')));
    assert.equal(writes.some(sql => sql.startsWith('INSERT INTO sx_retail_external_orders')), false);
    const second = await processWebhook(pool, connection, {topic:'order.updated', resource:'order', eventId:'delivery-1', raw});
    assert.equal(second.duplicate, true);
  } finally {
    if (originalKey === undefined) delete process.env.SALEMAX_PLATFORM_KEY_BASE64;
    else process.env.SALEMAX_PLATFORM_KEY_BASE64 = originalKey;
  }
});
