'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const Module = require('node:module');
const {splitSql} = require('../database/migration-runner');
const connector = require('../modules/platform/retail-connected-stores');
const load = Module._load;
const expressRouters = [];
const expressStub = {
  Router() {
    const routes = new Map();
    const router = {routes, use() { return this; }};
    for (const method of ['get','post','put','patch','delete']) router[method] = (path, ...handlers) => {
      routes.set(`${method.toUpperCase()} ${path}`, handlers.at(-1)); return router;
    };
    expressRouters.push(router);
    return router;
  },
  json: () => (_req,_res,next) => next(),
  raw: () => (_req,_res,next) => next(),
};
Module._load = function(request, parent, isMain) {
  if (request === 'express') return expressStub;
  return load.call(this, request, parent, isMain);
};
const {syncWoo, processWebhook, workspaceRouter, compareOrderAmountGroups, connectionReconciliation} = require('../modules/platform/retail-connected-stores-router');
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
  const product = connector.normalizeProduct('woocommerce', {id: 100, name: 'Linen', sku: 'LINEN', type: 'variable', price: '', status: 'publish',
    variations: [101, 102], manage_stock: false, stock_quantity: null, stock_status: 'instock', date_modified_gmt: '2026-11-15T10:00:00'});
  assert.equal(product.id, '100');
  assert.equal(product.productType, 'variable');
  assert.equal(product.sku, 'LINEN');
  assert.equal(product.variationCount, 2);
  assert.equal(product.priceUnavailable, true);
  assert.deepEqual(product.sourceStock, {managed: false, managementMode: 'unmanaged', quantity: null, status: 'instock'});

  const variation = connector.normalizeProductVariation('woocommerce', 100, {id: 101, sku: 'LINEN-M', price: '20.10',
    parent_id: 100, status: 'publish', purchasable: true, attributes: [{name: 'Size', option: 'M'}], manage_stock: true, stock_quantity: '2.5', stock_status: 'instock'}, 'QAR');
  assert.equal(variation.id, '101');
  assert.equal(variation.productId, '100');
  assert.equal(variation.sku, 'LINEN-M');
  assert.equal(variation.status, 'publish');
  assert.equal(variation.purchasable, true);
  assert.equal(variation.price, '20.100000');
  assert.equal(variation.sourceStock.managementMode, 'managed');
  assert.equal(variation.sourceStock.quantity, '2.500000');
  const parentManaged = connector.normalizeProductVariation('woocommerce', 100, {id: 102, sku: 'LINEN-L', price: '20.10',
    status: 'publish', purchasable: true, manage_stock: 'parent', stock_quantity: 8, stock_status: 'instock'}, 'QAR');
  assert.equal(parentManaged.sourceStock.managementMode, 'parent');
  assert.equal(parentManaged.sourceStock.managed, false);
  assert.equal(parentManaged.sourceStock.quantity, null);
  const unknownStock = connector.normalizeProductVariation('woocommerce', 100, {id: 103, sku: 'LINEN-XL', price: '20.10', status: 'publish'}, 'QAR');
  assert.equal(unknownStock.sourceStock.managementMode, 'unknown');
  assert.equal(unknownStock.sourceStock.quantity, null);
  assert.equal(connector.safeStockQuantity('-1.25'), '-1.250000');

  const order = connector.normalizeOrder('woocommerce', {id: 900, status: 'processing', currency: 'QAR', total: '115.50',
    subtotal: '100.00', discount_total: '5.00', shipping_total: '10.00', total_tax: '10.50', fee_lines: [{name: 'Gift wrap', total: '1.25'}],
    refunds: [{id: 12, total: '-2.00'}], date_created_gmt: '2026-11-14T08:30:00', date_modified_gmt: '2026-11-15T10:00:00', line_items: [
      {id: 1, product_id: 100, variation_id: 101, sku: 'LINEN-M', name: 'Linen M', quantity: '1.25', subtotal: '100.00', total: '95.00', total_tax: '9.5'},
    ]});
  assert.equal(order.createdAt, '2026-11-14T08:30:00.000Z');
  assert.equal(order.updatedAt, '2026-11-15T10:00:00.000Z');
  assert.deepEqual(order.breakdown, {subtotal: '100.000000', discount: '5.000000', shipping: '10.000000', tax: '10.500000', fees: '1.250000', refunds: '2.000000'});
  assert.equal(order.lineItems[0].quantity, '1.250000');
  assert.equal(order.lineItems[0].discount, '5.000000');
  assert.equal(order.lineItems[0].variantId, '101');
});

test('Woo order reconciliation compares exact currency/status buckets and marks unavailable components for review', () => {
  const source=[{currency:'QAR',status:'processing',financialStatus:'paid_reported_by_store',count:1,total:'100.000000',subtotal:'90.000000',
    discount:'5.000000',shipping:'5.000000',tax:'10.000000',fee:'0.000000',refund:'0.000000'}];
  const local=[{currency:'QAR',status:'processing',financialStatus:'paid_reported_by_store',count:1,total:'100.000000',subtotal:'90.000000',
    discount:'5.000000',shipping:'5.000000',tax:'10.000000',fees:'0.000000',refunds:'0.000000'}];
  const exact=compareOrderAmountGroups(source,local,true,true);
  assert.equal(exact.state,'matched');
  assert.equal(exact.groups[0].state,'matched');
  assert.equal(exact.groups[0].amounts.total.delta,'0.000000');

  const changed=compareOrderAmountGroups(source,[{...local[0],count:2,total:'125.500000'}],true,true);
  assert.equal(changed.state,'mismatch');
  assert.equal(changed.groups[0].countDelta,1);
  assert.equal(changed.groups[0].amounts.total.delta,'25.500000');

  const incomplete=compareOrderAmountGroups([{...source[0],feeComplete:false,fee:undefined,refundComplete:false,refund:undefined}],local,true,true);
  assert.equal(incomplete.state,'needs_review');
  assert.equal(incomplete.groups[0].amounts.fees.state,'unavailable');
  assert.equal(incomplete.groups[0].amounts.refunds.delta,null);
  assert.equal(compareOrderAmountGroups(source,local,true,false).state,'source_changed');
  assert.equal(compareOrderAmountGroups(source,local,false,false).state,'scan_incomplete');
});

test('Woo reconciliation endpoint only reports a passing order check for a complete stable scan', async () => {
  const localAmounts=[{currency:'QAR',status:'processing',financialStatus:'paid_reported_by_store',count:1,total:'100.000000',subtotal:'90.000000',
    discount:'5.000000',shipping:'5.000000',tax:'10.000000',fees:'0.000000',refunds:'0.000000'}];
  const sourceAmounts={'QAR|processing|paid_reported_by_store':{currency:'QAR',status:'processing',financialStatus:'paid_reported_by_store',
    count:1,total:'100.000000',subtotal:'90.000000',discount:'5.000000',shipping:'5.000000',tax:'10.000000',fee:'0.000000',refund:'0.000000'}};
  const completeScan={sourceCounts:{products:{total:2,scanned:2,sourceChangedDuringScan:false},orders:{total:1,scanned:1,sourceChangedDuringScan:false},
    customers:{total:1,scanned:1,sourceChangedDuringScan:false}},orderAmounts:sourceAmounts};
  const run=async(lastCompleteScan,local=localAmounts)=>{
    const pool={query:async sql=>{
      if(sql.includes('AS checkouts'))return [[{products:2,variations:0,orders:1,customers:1,checkouts:0}],[]];
      if(sql.startsWith('SELECT currency,order_status AS status'))return [local,[]];
      if(sql.includes('AS variations')&&sql.includes('AS products'))return [[{products:0,variations:0}],[]];
      if(sql.startsWith('SELECT\n    SUM(mapping_status='))return [[{mapped:0,ignored:0,invalidTargets:0}],[]];
      if(sql.startsWith('SELECT\n    COUNT(*) AS mapped'))return [[{mapped:0,quantityManaged:0,managedQuantityUnavailable:0,sourceStockSnapshotUnknown:0,
        parentShared:0,readyForReadOnlyComparison:0}],[]];
      if(sql.startsWith('SELECT normalizedSku AS sku'))return [[],[]];
      if(sql.startsWith('SELECT COUNT(*) AS count FROM (SELECT normalizedSku'))return [[{count:0}],[]];
      throw new Error('Unexpected reconciliation query: '+sql);
    }};
    return connectionReconciliation(pool,{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',tenant_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      provider:'woocommerce',last_sync_at:null,last_error_code:null,sync_cursor:JSON.stringify({woocommerce:lastCompleteScan?{lastCompleteScan}: {}})});
  };
  const exact=await run(completeScan);
  assert.equal(exact.orderReconciliation.state,'matched');
  assert.equal(exact.orderReconciliation.groups[0].amounts.refunds.delta,'0.000000');
  const mismatch=await run(completeScan,[{...localAmounts[0],total:'101.000000'}]);
  assert.equal(mismatch.orderReconciliation.state,'mismatch');
  const incomplete=await run({...completeScan,sourceCounts:{...completeScan.sourceCounts,orders:{...completeScan.sourceCounts.orders,total:2}}});
  assert.equal(incomplete.orderReconciliation.state,'scan_incomplete');
  assert.equal(incomplete.scan.countsFullyScanned,false);
  const missingMetadata=await run({...completeScan,sourceCounts:{...completeScan.sourceCounts,customers:{...completeScan.sourceCounts.customers,total:null}}});
  assert.equal(missingMetadata.orderReconciliation.state,'scan_incomplete');
  assert.equal(missingMetadata.scan.sourceCountMetadataAvailable,false);
  const missingOrderTotals=await run({...completeScan,orderAmounts:{}});
  assert.equal(missingOrderTotals.orderReconciliation.state,'scan_incomplete');
  assert.equal(missingOrderTotals.scan.orderAmountMetadataAvailable,false);
});

test('Woo sync paginates resources, retries transient GET failures, and imports variations', async () => {
  const originalRequest = connector.requestHttps;
  const originalKey = process.env.SALEMAX_PLATFORM_KEY_BASE64;
  const originalFetch = globalThis.fetch;
  const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const connectionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  process.env.SALEMAX_PLATFORM_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');
  const creds = connector.seal({consumerKey: 'ck_' + 'A'.repeat(32), consumerSecret: 'cs_' + 'B'.repeat(32)}, tenantId, connectionId, 'credentials');
  const connection = {id: connectionId, tenant_id: tenantId, provider: 'woocommerce', status: 'active',
    credentials_verified_at: new Date('2026-11-15T09:00:00Z'), default_currency: 'QAR',
    store_domain: 'https://store.example.com', sync_cursor: JSON.stringify({woocommerce:{customers:{page:4,complete:false,sourceTotal:178,scanned:150}}}), credentials_ciphertext: creds.ciphertext,
    credentials_iv: creds.iv, credentials_auth_tag: creds.authTag};
  const requests = [], writes = [];
  let networkRetryInjected=false,httpRetryInjected=false;
  connector.requestHttps = async (url, options) => {
    requests.push({url, method: options.method || 'GET'});
    const parsed = new URL(url), pathname = parsed.pathname, page = Number(parsed.searchParams.get('page') || 1);
    if(pathname.endsWith('/products')&&page===1&&!networkRetryInjected){networkRetryInjected=true;throw Object.assign(new Error('synthetic connection reset'),{code:'ECONNRESET'});}
    if(pathname.endsWith('/orders')&&page===1&&!httpRetryInjected){httpRetryInjected=true;return {status:429,headers:{'retry-after':'0'},data:null};}
    let rows;
    if (pathname.endsWith('/products/100/variations')) rows = [{id: 101, parent_id: 100, sku: 'LINEN-M', price: '20.00',
      attributes: [{name: 'Size', option: 'M'}], stock_quantity: '3', manage_stock: true, stock_status: 'instock', date_modified_gmt: '2026-11-15T10:00:00'}];
    else if (pathname.endsWith('/products') && page === 1) rows = [{id: 100, name: 'Linen', sku: 'LINEN', price: '20.00', status: 'publish',
      variations: [101], date_modified_gmt: '2026-11-15T10:00:00'}];
    else if (pathname.endsWith('/products')) rows = [{id: 200, name: 'Cotton', sku: 'COTTON', price: '5.00', status: 'publish',
      variations: [], date_modified_gmt: '2026-11-15T11:00:00'}];
    else if (pathname.endsWith('/orders') && page === 1) rows = [{id: 900, status: 'processing', currency: 'QAR', total: '20.00', subtotal: '20.00',
      discount_total: '0.00', shipping_total: '0.00', total_tax: '0.00', fee_lines: [], refunds: [], date_created_gmt: '2026-11-14T08:30:00', date_modified_gmt: '2026-11-15T10:00:00',
      line_items: [{id: 1, product_id: 100, variation_id: 101, sku: 'LINEN-M', name: 'Linen M', quantity: '1', subtotal: '20.00', total: '20.00', total_tax: '0.00'}]}];
    else if (pathname.endsWith('/orders')) rows = [{id: 901, status: 'processing', currency: 'QAR', total: '5.00', subtotal: '5.00',
      discount_total: '0.00', shipping_total: '0.00', total_tax: '0.00', fee_lines: [], refunds: [], date_modified_gmt: '2026-11-15T11:00:00', line_items: []}];
    else if (pathname.endsWith('/wc-analytics/reports/customers') && page === 1) rows = [{id: 500, user_id: 5, email: 'pilot@example.invalid',
      first_name: 'Synthetic', last_name: 'Registered', billing_phone: '+97400000001', country: 'QA', city: 'Doha', postcode: '00000',
      date_registered: '2026-01-01T00:00:00'}];
    else if (pathname.endsWith('/wc-analytics/reports/customers')) rows = [{id: 950, user_id: 0, email: 'second@example.invalid',
      first_name: 'Synthetic Two', last_name: 'Guest', shipping_phone: '+97400000002', country: 'QA', city: 'Doha',
      date_registered: '2026-02-01T00:00:00'}];
    else throw new Error('Unexpected Woo request: ' + pathname);
    const paged = !pathname.endsWith('/products/100/variations');
    return {status: 200, headers: {'x-wp-totalpages': paged ? '2' : '1', 'x-wp-total': paged ? '2' : String(rows.length)}, data: rows};
  };
  let stagedCursor = null, committedCursor = null;
  const writer = {beginTransaction: async()=>{stagedCursor = null;}, commit: async()=>{if(stagedCursor)committedCursor=stagedCursor;}, rollback: async()=>{stagedCursor=null;}, release: ()=>{}, query: async(sql,params)=>{
    writes.push({sql,params});
    if(sql.includes('SET sync_cursor=?'))stagedCursor=params[0];
    if (sql.includes('COALESCE(MAX(version),0) AS version')) return [[{version: 0}],[]];
    return sql.trimStart().startsWith('SELECT') ? [[],[]] : [{affectedRows: 1},[]];
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
    const legacyCustomerCursorWasReset = requests.some(request => {
      const url = new URL(request.url);
      return url.pathname.endsWith('/wc-analytics/reports/customers') && url.searchParams.get('page') === '1';
    });
    assert.equal(legacyCustomerCursorWasReset, true);
    const customerWrites = writes.filter(write => write.sql.startsWith('INSERT INTO sx_retail_external_customers'));
    assert.deepEqual(customerWrites.slice(0, 2).map(write => write.params[2]), ['5', 'analytics:950']);
    const registeredCustomer = connector.openJson({ciphertext:customerWrites[0].params[3],iv:customerWrites[0].params[4],authTag:customerWrites[0].params[5]},
      tenantId, connectionId, 'customer:5');
    const guestCustomer = connector.openJson({ciphertext:customerWrites[1].params[3],iv:customerWrites[1].params[4],authTag:customerWrites[1].params[5]},
      tenantId, connectionId, 'customer:analytics:950');
    assert.equal(registeredCustomer.phone, '+97400000001');
    assert.equal(registeredCustomer.address.city, 'Doha');
    assert.equal(guestCustomer.phone, '+97400000002');
    const customerRequests = requests.filter(request => new URL(request.url).pathname.endsWith('/wc-analytics/reports/customers'));
    assert.ok(customerRequests.every(request => {
      const url = new URL(request.url);
      return url.searchParams.get('orderby') === 'date_registered' && url.searchParams.get('order') === 'asc';
    }));
    assert.equal(requests.filter(request => new URL(request.url).pathname.endsWith('/wc/v3/customers')).length, 0);
    assert.ok(requests.length >= 7);
    assert.ok(requests.every(request => request.method === 'GET'));
    assert.ok(requests.filter(request=>new URL(request.url).pathname.endsWith('/products')&&new URL(request.url).searchParams.get('page')==='1').length >= 2);
    assert.ok(requests.filter(request=>new URL(request.url).pathname.endsWith('/orders')&&new URL(request.url).searchParams.get('page')==='1').length >= 2);
    assert.ok(requests.some(request => new URL(request.url).pathname.endsWith('/products/100/variations')));
    assert.ok(requests.some(request => new URL(request.url).searchParams.get('page') === '2'));

    connection.sync_cursor = pool.cursor;
    const nextScanFirstPage = await syncWoo(pool, connection);
    assert.equal(nextScanFirstPage.complete, false);
    connection.sync_cursor = pool.cursor;
    const nextScanSecondPage = await syncWoo(pool, connection);
    assert.equal(nextScanSecondPage.complete, true);
    const customerPageCounts = requests.filter(request => new URL(request.url).pathname.endsWith('/wc-analytics/reports/customers'))
      .reduce((counts, request) => {
        const page = new URL(request.url).searchParams.get('page');
        counts[page] = (counts[page] || 0) + 1;
        return counts;
      }, {});
    assert.deepEqual(customerPageCounts, {'1':2,'2':2});
    assert.ok(requests.filter(request => /\/products(?:\/\d+\/variations)?$/.test(new URL(request.url).pathname) || /\/orders$/.test(new URL(request.url).pathname))
      .every(request => new URL(request.url).searchParams.get('status') === 'any'));
    assert.ok(writes.some(write => write.sql.includes('external_variant_id')));
    assert.ok(writes.some(write => write.sql.startsWith('INSERT INTO sx_product_catalog')));
    assert.ok(writes.some(write => write.sql.startsWith('INSERT INTO sx_retail_catalogue_imports')));
    assert.ok(writes.some(write => write.sql.startsWith('INSERT INTO sx_retail_orders')));
    assert.ok(writes.some(write => write.sql.startsWith('INSERT IGNORE INTO sx_retail_customer_search_tokens')));
    const variationStockWrite=writes.find(write=>write.sql.includes('source_stock_quantity')&&write.sql.includes('external_variant_id'));
    assert.equal(variationStockWrite.params[11],1);
    assert.equal(variationStockWrite.params[12],'managed');
    assert.equal(variationStockWrite.params[13],'3.000000');
    assert.ok(writes.some(write => write.sql.includes('subtotal_amount')));
    const syncedOrder=writes.find(write=>write.sql.startsWith('INSERT INTO sx_retail_external_orders'));
    assert.ok(syncedOrder.sql.includes('source_created_at'));
    assert.equal(syncedOrder.params.at(-1),'2026-11-14 08:30:00.000');
    const cursor = JSON.parse(pool.cursor).woocommerce;
    assert.equal(cursor.lastCompleteScan.sourceCounts.orders.total, 2);
    assert.equal(cursor.lastCompleteScan.queryScope.products.status, 'any');
    assert.deepEqual(cursor.lastCompleteScan.queryScope.customers, {source:'wc-analytics/reports/customers', userTypes:'registered and guest',
      orderby:'date_registered', order:'asc'});
    assert.equal(cursor.customers.source, 'wc-analytics-customers-v1');
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

test('WooCommerce connection persists a verified read-only store without starting an import', async () => {
  const originalRequest = connector.requestHttps;
  const originalKey = process.env.SALEMAX_PLATFORM_KEY_BASE64;
  process.env.SALEMAX_PLATFORM_KEY_BASE64 = Buffer.alloc(32, 12).toString('base64');
  const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const connectionWrites = [];
  const requests = [];
  const db = {
    beginTransaction: async () => {},
    query: async (sql, params) => {
      connectionWrites.push({sql, params});
      if (sql.startsWith('SELECT id,tenant_id,status,credentials_verified_at AS credentialsVerifiedAt FROM sx_retail_store_connections')) return [[],[]];
      return [{affectedRows: 1},[]];
    },
    commit: async () => {}, rollback: async () => {}, release: () => {},
  };
  const pool = {getConnection: async () => db};
  const authenticate = (_req,_res,next) => next();
  const router = workspaceRouter({pool, authenticate, origin: 'https://workspace.example.invalid'});
  const handler = router.routes.get('POST /woocommerce');
  const context = {audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:'retail_boutique',categoryVersion:1,currency:'QAR'},
    membership:{tenantId,status:'active',role:'owner'},subscription:{status:'active',capabilities:['retail.commerce']},
    category:{key:'retail_boutique',version:1,capabilities:['retail.commerce']},
    identity:{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}};
  let response = null, error = null;
  const req = {businessContext:context,params:{},query:{},body:{storeUrl:'https://store.example.com',displayName:'Test Store',currency:'QAR',
    consumerKey:'ck_'+'A'.repeat(32),consumerSecret:'cs_'+'B'.repeat(32)}};
  const res = {json(value){response={status:200,value};return this;},sendStatus(status){response={status};return this;}};
  connector.requestHttps = async (url, options) => {
    requests.push({url,method:options.method || 'GET'});
    return {status:200,data:[]};
  };
  try {
    await handler(req,res,value=>{error=value;});
    assert.equal(error, null);
    assert.equal(response.status, 200);
    assert.equal(response.value.success, true);
    assert.equal(response.value.data.connection.provider, 'woocommerce');
    assert.equal(response.value.data.connection.status, 'active');
    assert.equal(response.value.data.connection.storeDomain, 'https://store.example.com');
    assert.equal(Object.hasOwn(response.value.data, 'webhookSecret'), false);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'GET');
    assert.match(new URL(requests[0].url).pathname, /\/wp-json\/wc\/v3\/orders$/);
    assert.equal(connectionWrites.filter(item=>item.sql.startsWith('INSERT INTO sx_retail_store_connections')).length, 1);
    assert.match(connectionWrites.find(item=>item.sql.startsWith('INSERT INTO sx_retail_store_connections')).sql,/credentials_verified_at/);
    assert.equal(connectionWrites.filter(item=>/sx_retail_external_(products|product_variants|orders|customers)/.test(item.sql)).length, 0);
  } finally {
    connector.requestHttps = originalRequest;
    if (originalKey === undefined) delete process.env.SALEMAX_PLATFORM_KEY_BASE64;
    else process.env.SALEMAX_PLATFORM_KEY_BASE64 = originalKey;
  }
});

test('reconnecting a revoked Woo store reuses its ID and resets the resumable cursor after a read-only check',async()=>{
  const originalRequest=connector.requestHttps,originalKey=process.env.SALEMAX_PLATFORM_KEY_BASE64;
  process.env.SALEMAX_PLATFORM_KEY_BASE64=Buffer.alloc(32,13).toString('base64');
  const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',connectionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const calls=[],requests=[],db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.startsWith('SELECT id,tenant_id,status,credentials_verified_at AS credentialsVerifiedAt FROM sx_retail_store_connections'))return [[{id:connectionId,tenant_id:tenantId,status:'revoked',credentialsVerifiedAt:null}],[]];
    return [{affectedRows:1},[]];
  }};
  const pool={getConnection:async()=>db},router=workspaceRouter({pool,authenticate:(_req,_res,next)=>next(),origin:'https://workspace.example.invalid'});
  const handler=router.routes.get('POST /woocommerce'),context={audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:'retail_boutique',categoryVersion:1,currency:'QAR'},
    membership:{tenantId,status:'active',role:'owner'},subscription:{status:'active',capabilities:['retail.commerce']},
    category:{key:'retail_boutique',version:1,capabilities:['retail.commerce']},identity:{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}};
  let response=null,error=null;
  const req={businessContext:context,params:{},query:{},body:{storeUrl:'https://store.example.com',displayName:'Test Store',currency:'QAR',consumerKey:'ck_'+'C'.repeat(32),consumerSecret:'cs_'+'D'.repeat(32)}};
  const res={json(value){response={status:200,value};return this;},sendStatus(status){response={status};return this;}};
  connector.requestHttps=async(url,options)=>{requests.push({url,method:options.method||'GET'});return {status:200,data:[]};};
  try{
    await handler(req,res,value=>{error=value;});
    assert.equal(error,null);assert.equal(response.status,200);assert.equal(response.value.data.connection.id,connectionId);
    assert.equal(response.value.data.connection.status,'active');
    assert.equal(JSON.stringify(response.value).includes('ck_'+'C'.repeat(32)),false);
    assert.equal(JSON.stringify(response.value).includes('cs_'+'D'.repeat(32)),false);
    assert.equal(requests.length,1);assert.equal(requests[0].method,'GET');
    const reconnect=calls.find(item=>item.sql.startsWith('UPDATE sx_retail_store_connections'));
    assert.ok(reconnect);assert.match(reconnect.sql,/sync_cursor=NULL/);assert.match(reconnect.sql,/sync_lock_token=NULL/);
    assert.deepEqual(reconnect.params.slice(-2),[tenantId,connectionId]);
    assert.equal(calls.some(item=>/INSERT INTO sx_retail_external_(products|product_variants|orders|customers)/.test(item.sql)),false);
    assert.ok(calls.some(item=>item.params?.includes('retail.store-reconnected')));
  }finally{
    connector.requestHttps=originalRequest;
    if(originalKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;else process.env.SALEMAX_PLATFORM_KEY_BASE64=originalKey;
  }
});

test('WooCommerce image backfill is bounded, tenant-scoped, credential-gated and owner-only', async () => {
  const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',connectionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const connection={id:connectionId,tenant_id:tenantId,provider:'woocommerce',status:'active',credentials_verified_at:new Date()};
  const queries=[];const pool={query:async(sql,params)=>{queries.push({sql,params});if(sql.startsWith('SELECT * FROM sx_retail_store_connections'))return [[connection],[]];throw new Error('Unexpected image-backfill query: '+sql);}};
  const contextFor=(role='owner')=>({audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:'retail_boutique',categoryVersion:1},
    membership:{tenantId,status:'active',role},subscription:{status:'active',capabilities:['retail.commerce']},
    category:{key:'retail_boutique',version:1,capabilities:['retail.commerce']},identity:{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}});
  const router=workspaceRouter({pool,authenticate:(_req,_res,next)=>next(),origin:'https://workspace.example.invalid'});
  const handler=router.routes.get('POST /:id/images/backfill'),backfill=require('../modules/platform/retail-native-import-backfill');
  const original=backfill.backfillProductImagesOnly;let backfillCalls=0;
  backfill.backfillProductImagesOnly=async(actualPool,actualConnection,options)=>{assert.equal(actualPool,pool);assert.equal(actualConnection,connection);assert.deepEqual(options,{limit:25});backfillCalls++;return {images:25,failed:0,failures:[],pendingImages:17};};
  const invoke=async(role='owner')=>{let response=null,error=null;const req={businessContext:contextFor(role),params:{id:connectionId},body:{}};
    const res={status(code){this.code=code;return this;},json(value){response={status:this.code||200,value};return this;},sendStatus(status){response={status};return this;}};
    await handler(req,res,value=>{error=value;});return {response,error};};
  try{
    const denied=await invoke('manager');assert.equal(denied.response.status,403);assert.equal(queries.length,0);assert.equal(backfillCalls,0);
    const allowed=await invoke();assert.equal(allowed.response.status,200);assert.deepEqual(allowed.response.value.data,{images:25,failed:0,failures:[],pendingImages:17});
    assert.equal(backfillCalls,1);assert.deepEqual(queries[0].params,[tenantId,connectionId]);
    connection.credentials_verified_at=null;queries.length=0;
    const unverified=await invoke();assert.equal(unverified.error?.code,'STORE_CREDENTIALS_REVALIDATION_REQUIRED');assert.equal(backfillCalls,1);
  }finally{backfill.backfillProductImagesOnly=original;}
});

test('connected-store reads are tenant-scoped and owner-only', async () => {
  const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const otherTenantId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const connectionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const connection = {id: connectionId, tenant_id: tenantId, provider: 'woocommerce', status: 'active', default_currency: 'QAR'};
  const queries = [];
  const pool = {query: async(sql,params)=>{
    queries.push({sql,params});
    if (sql.startsWith('SELECT * FROM sx_retail_store_connections')) return params[0] === tenantId ? [[connection],[]] : [[],[]];
    if (sql.startsWith('SELECT external_customer_id AS id')) return [[],[]];
    throw new Error('Unexpected tenant-scope query: ' + sql);
  }};
  const authenticate = (_req,_res,next)=>next();
  const router = workspaceRouter({pool, authenticate, origin: 'https://workspace.example.invalid'});
  const handler = router.routes.get('GET /:id/data/:kind');
  const contextFor = (id, role='owner') => ({audience:'tenant',tenant:{id,status:'active',categoryKey:'retail_boutique',categoryVersion:1},
    membership:{tenantId:id,status:'active',role},subscription:{status:'active',capabilities:['retail.commerce']},
    category:{key:'retail_boutique',version:1,capabilities:['retail.commerce']},identity:{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'}});
  const invoke = async context => {
    let response = null, error = null;
    const req = {businessContext:context,params:{id:connectionId,kind:'customers'},query:{page:'1'}};
    const res = {json(value){response={status:200,value};return this;},sendStatus(status){response={status};return this;}};
    await handler(req,res,value=>{error=value;});
    return {response,error};
  };
  const own = await invoke(contextFor(tenantId));
  assert.equal(own.response.status, 200);
  assert.deepEqual(own.response.value.data.items, []);
  const other = await invoke(contextFor(otherTenantId));
  assert.equal(other.error?.code, 'STORE_CONNECTION_NOT_FOUND');
  assert.equal(other.error?.status, 404);
  const connectionLookups = queries.filter(item=>item.sql.startsWith('SELECT * FROM sx_retail_store_connections'));
  assert.deepEqual(connectionLookups.map(item=>item.params[0]), [tenantId,otherTenantId]);
  const customerLists = queries.filter(item=>item.sql.startsWith('SELECT external_customer_id AS id'));
  assert.equal(customerLists.length, 1);
  assert.deepEqual(customerLists[0].params.slice(0,2), [tenantId,connectionId]);
  const beforeDenied = queries.length;
  const staff = await invoke(contextFor(tenantId,'manager'));
  assert.equal(staff.response.status, 403);
  assert.equal(queries.length, beforeDenied);
  assert.equal(expressRouters.includes(router), true);
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

test('Woo product mapping migration is additive and tenant scoped', () => {
  const migration = fs.readFileSync(path.resolve(__dirname, '../database/migrations/20270206_retail_external_product_mappings.sql'), 'utf8');
  const statements = splitSql(migration);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /^CREATE TABLE sx_retail_external_product_mappings/i);
  assert.match(migration, /UNIQUE KEY uq_retail_external_mapping_source \(tenant_id,connection_id,external_product_id,external_variant_id\)/);
  assert.match(migration, /FOREIGN KEY \(tenant_id,connection_id\)\s+REFERENCES sx_retail_store_connections\(tenant_id,id\)/);
  assert.match(migration, /FOREIGN KEY \(tenant_id,target_product_id\)\s+REFERENCES sx_product_catalog\(tenant_id,id\)/);
  assert.doesNotMatch(migration, /\bDROP\s+(TABLE|COLUMN)\b/i);
});

test('Woo stock mapping migration stores source stock and requires explicit location/unit scope', () => {
  const migration = fs.readFileSync(path.resolve(__dirname, '../database/migrations/20270208_retail_woocommerce_stock_mapping.sql'), 'utf8');
  const statements = splitSql(migration);
  assert.equal(statements.length, 3);
  assert.match(statements[0], /^ALTER TABLE sx_retail_external_products/i);
  assert.match(statements[1], /^ALTER TABLE sx_retail_external_product_variants/i);
  assert.match(statements[2], /^ALTER TABLE sx_retail_external_product_mappings/i);
  assert.match(migration, /source_stock_quantity DECIMAL\(20,6\)/);
  assert.match(migration, /stock_scope ENUM\('unverified','single_location','aggregate'\)/);
  assert.match(migration, /FOREIGN KEY \(tenant_id,target_location_id\)\s+REFERENCES sx_retail_locations\(tenant_id,id\)/);
  assert.match(migration, /source_unit_confirmed=1 AND target_unit_revision IS NOT NULL/);
  assert.doesNotMatch(migration, /\bDROP\s+(TABLE|COLUMN)\b/i);
});

test('Woo stock-management mode migration keeps legacy boolean snapshots unknown until resynced', () => {
  const migration = fs.readFileSync(path.resolve(__dirname, '../database/migrations/20270211_retail_woocommerce_stock_management_modes.sql'), 'utf8');
  const statements = splitSql(migration);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /^ALTER TABLE sx_retail_external_products/i);
  assert.match(statements[1], /^ALTER TABLE sx_retail_external_product_variants/i);
  assert.equal((migration.match(/ENUM\('unknown','managed','unmanaged','parent'\)/g) || []).length, 2);
  assert.equal((migration.match(/DEFAULT 'unknown'/g) || []).length, 2);
  assert.doesNotMatch(migration, /UPDATE\s+sx_retail_external_/i);
  assert.doesNotMatch(migration, /\bDROP\s+(TABLE|COLUMN)\b/i);
});

test('external order source-date migration is additive and indexed for the tenant order list', () => {
  const migration = fs.readFileSync(path.resolve(__dirname, '../database/migrations/20270210_retail_external_order_source_dates.sql'), 'utf8');
  const statements = splitSql(migration);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /^ALTER TABLE sx_retail_external_orders/i);
  assert.match(migration, /ADD COLUMN source_created_at DATETIME\(3\) DEFAULT NULL/);
  assert.match(migration, /ix_retail_external_orders_created \(tenant_id,source_created_at,connection_id,external_order_id\)/);
  assert.doesNotMatch(migration, /\bDROP\s+(TABLE|COLUMN)\b/i);
});

function mappingHarness({productType='simple', parentStatus='publish', variationStatus='publish', existingMapping=null, stockManaged=false,
  sourceStockManagement=stockManaged?'managed':'unmanaged', variationStockManagement='unmanaged', sourceStockQuantity='2.5', unitProfile=null}={}) {
  const tenantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const connectionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const identityId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const targetId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const product=connector.seal({productType,sourceStock:{managed:sourceStockManagement==='managed',managementMode:sourceStockManagement,
    quantity:sourceStockManagement==='managed'?sourceStockQuantity:null,status:'instock'}},tenantId,connectionId,'product:100');
  const variation=connector.seal({purchasable:true,sourceStock:{managed:variationStockManagement==='managed',managementMode:variationStockManagement,
    quantity:variationStockManagement==='managed'?sourceStockQuantity:null,status:'instock'}},tenantId,connectionId,'product-variant:101');
  const connection={id:connectionId,tenant_id:tenantId,provider:'woocommerce',status:'active',default_currency:'QAR'};
  const queries=[];
  let mapping=existingMapping,commits=0,rollbacks=0;
  const db={beginTransaction:async()=>{},commit:async()=>{commits++;},rollback:async()=>{rollbacks++;},release:()=>{},query:async(sql,params)=>{
    queries.push({sql,params});
    if(sql.startsWith('SELECT id,status,provider FROM sx_retail_store_connections'))return [[{id:connectionId,status:'active',provider:'woocommerce'}],[]];
    if(sql.startsWith('SELECT product_status AS status,sku,product_ciphertext'))return [[{status:parentStatus,sku:'WOO-100',ciphertext:product.ciphertext,iv:product.iv,authTag:product.authTag,
      sourceStockManagement,sourceStockManaged:stockManaged?1:0,sourceStockQuantity:stockManaged?sourceStockQuantity:null,sourceStockStatus:'instock'}],[]];
    if(sql.startsWith('SELECT variant_status AS status,sku,variant_ciphertext'))return [[{status:variationStatus,sku:'WOO-101',ciphertext:variation.ciphertext,iv:variation.iv,authTag:variation.authTag,
      sourceStockManagement:variationStockManagement,sourceStockManaged:variationStockManagement==='managed'?1:variationStockManagement==='unmanaged'?0:null,
      sourceStockQuantity:variationStockManagement==='managed'?sourceStockQuantity:null,sourceStockStatus:'instock'}],[]];
    if(sql.startsWith('SELECT id,mapping_status AS mappingStatus,target_product_id AS targetProductId,stock_scope'))return [mapping?[mapping]:[],[]];
    if(sql.startsWith('SELECT id,code FROM sx_product_catalog'))return [[{id:targetId,code:'LOCAL-100'}],[]];
    if(sql.startsWith('SELECT base_unit_code AS baseUnitCode'))return unitProfile?[[{...unitProfile}],[]]:[[],[]];
    if(sql.startsWith('SELECT id FROM sx_retail_locations'))return [[{id:'ffffffff-ffff-4fff-8fff-ffffffffffff'}],[]];
    if(sql.startsWith('INSERT INTO sx_retail_external_product_mappings')){
      mapping={id:params[0],mappingStatus:params[5],targetProductId:params[6],stockScope:params[7],targetLocationId:params[8],sourceUnitConfirmed:params[9],targetUnitRevision:params[10],revision:params[11]};
      return [{affectedRows:1},[]];
    }
    if(sql.startsWith('INSERT INTO sx_audit_events'))return [{affectedRows:1},[]];
    throw new Error('Unexpected mapping query: '+sql);
  }};
  const pool={query:async(sql,params)=>{
    if(sql.startsWith('SELECT * FROM sx_retail_store_connections'))return [[connection],[]];
    throw new Error('Unexpected mapping pool query: '+sql);
  },getConnection:async()=>db};
  const authenticate=(_req,_res,next)=>next();
  const router=workspaceRouter({pool,authenticate,origin:'https://workspace.example.invalid'});
  const handler=router.routes.get('PUT /:id/mappings');
  const context={audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:'retail_boutique',categoryVersion:1,currency:'QAR'},
    membership:{tenantId,status:'active',role:'owner'},subscription:{status:'active',capabilities:['retail.commerce']},
    category:{key:'retail_boutique',version:1,capabilities:['retail.commerce']},identity:{id:identityId}};
  return {tenantId,connectionId,targetId,identityId,handler,context,queries,commits,rollbacks,get mapping(){return mapping;},db};
}

test('Woo mapping writes are audited and an identical retry is idempotent', async () => {
  const originalKey=process.env.SALEMAX_PLATFORM_KEY_BASE64;
  process.env.SALEMAX_PLATFORM_KEY_BASE64=Buffer.alloc(32,13).toString('base64');
  try {
    const fixture=mappingHarness();
    const invoke=async()=>{
      let response=null,error=null;
      const req={businessContext:fixture.context,params:{id:fixture.connectionId},query:{},body:{externalProductId:'100',externalVariationId:null,
        targetProductId:fixture.targetId,action:'map',expectedRevision:0,expectedSku:'WOO-100'}};
      const res={json(value){response={status:200,value};return this;},sendStatus(status){response={status};return this;}};
      await fixture.handler(req,res,value=>{error=value;});
      return {response,error};
    };
    const first=await invoke(),retry=await invoke();
    assert.equal(first.error,null);
    assert.equal(first.response.value.data.status,'mapped');
    assert.equal(first.response.value.data.replayed,false);
    assert.equal(retry.error,null);
    assert.equal(retry.response.value.data.replayed,true);
    assert.equal(fixture.queries.filter(query=>query.sql.startsWith('INSERT INTO sx_retail_external_product_mappings')).length,1);
    const audit=fixture.queries.find(query=>query.sql.startsWith('INSERT INTO sx_audit_events'));
    assert.ok(audit);
    assert.equal(audit.params[1],fixture.tenantId);
    assert.equal(audit.params[2],fixture.identityId);
  } finally {
    if(originalKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;
    else process.env.SALEMAX_PLATFORM_KEY_BASE64=originalKey;
  }
});

test('Woo stock mapping requires location, exact unit compatibility, and owner unit confirmation', async () => {
  const originalKey=process.env.SALEMAX_PLATFORM_KEY_BASE64;
  process.env.SALEMAX_PLATFORM_KEY_BASE64=Buffer.alloc(32,22).toString('base64');
  const locationId='ffffffff-ffff-4fff-8fff-ffffffffffff';
  const unit={baseUnitCode:'yard',baseUnitLabel:'',baseUnitLabelAr:'',quantityPrecision:2,quantityIncrement:'0.250000',revision:3};
  try {
    const fixture=mappingHarness({stockManaged:true,unitProfile:unit});
    const invoke=async body=>{
      let response=null,error=null;
      await fixture.handler({businessContext:fixture.context,params:{id:fixture.connectionId},query:{},body},
        {json(value){response={status:200,value};return this;},sendStatus(status){response={status};return this;}},value=>{error=value;});
      return {response,error};
    };
    const missingConfirmation=await invoke({externalProductId:'100',externalVariationId:null,targetProductId:fixture.targetId,action:'map',expectedRevision:0,
      expectedSku:'WOO-100',stockScope:'single_location',targetLocationId:locationId,expectedUnitRevision:3});
    assert.equal(missingConfirmation.error?.code,'INVALID_PRODUCT_MAPPING');
    assert.equal(fixture.queries.some(query=>query.sql.startsWith('INSERT INTO sx_retail_external_product_mappings')),false);

    const incompatible=mappingHarness({stockManaged:true,unitProfile:{...unit,quantityPrecision:0,quantityIncrement:'1.000000'}});
    const invalid=await (async()=>{
      let error=null;
      await incompatible.handler({businessContext:incompatible.context,params:{id:incompatible.connectionId},query:{},body:{externalProductId:'100',externalVariationId:null,
        targetProductId:incompatible.targetId,action:'map',expectedRevision:0,expectedSku:'WOO-100',stockScope:'single_location',targetLocationId:locationId,
        sourceUnitConfirmed:true,expectedUnitRevision:3}},
      {json(){return this;},sendStatus(){return this;}},value=>{error=value;});
      return error;
    })();
    assert.equal(invalid?.code,'WOOCOMMERCE_STOCK_UNIT_MISMATCH');
    assert.equal(incompatible.queries.some(query=>query.sql.startsWith('INSERT INTO sx_retail_external_product_mappings')),false);

    const valid=mappingHarness({stockManaged:true,unitProfile:unit});
    let saved=null;
    await valid.handler({businessContext:valid.context,params:{id:valid.connectionId},query:{},body:{externalProductId:'100',externalVariationId:null,
      targetProductId:valid.targetId,action:'map',expectedRevision:0,expectedSku:'WOO-100',stockScope:'single_location',targetLocationId:locationId,
      sourceUnitConfirmed:true,expectedUnitRevision:3}},
    {json(value){saved=value;return this;},sendStatus(){return this;}},error=>{throw error;});
    const mappingInsert=valid.queries.find(query=>query.sql.startsWith('INSERT INTO sx_retail_external_product_mappings'));
    assert.equal(saved.data.stockScope,'single_location');
    assert.equal(mappingInsert.params[7],'single_location');
    assert.equal(mappingInsert.params[8],locationId);
    assert.equal(mappingInsert.params[9],1);
    assert.equal(mappingInsert.params[10],3);
  } finally {
    if(originalKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;
    else process.env.SALEMAX_PLATFORM_KEY_BASE64=originalKey;
  }
});

test('Woo parent-managed or legacy-unknown stock cannot be mapped as an independent quantity', async () => {
  const originalKey=process.env.SALEMAX_PLATFORM_KEY_BASE64;
  process.env.SALEMAX_PLATFORM_KEY_BASE64=Buffer.alloc(32,24).toString('base64');
  const locationId='ffffffff-ffff-4fff-8fff-ffffffffffff';
  const unit={baseUnitCode:'yard',baseUnitLabel:'',baseUnitLabelAr:'',quantityPrecision:2,quantityIncrement:'0.250000',revision:3};
  const invokeStockMap=async(fixture,externalVariationId,expectedSku)=>{
    let error=null;
    await fixture.handler({businessContext:fixture.context,params:{id:fixture.connectionId},query:{},body:{externalProductId:'100',externalVariationId,
      targetProductId:fixture.targetId,action:'map',expectedRevision:0,expectedSku,stockScope:'single_location',targetLocationId:locationId,
      sourceUnitConfirmed:true,expectedUnitRevision:3}},
    {json(){return this;},sendStatus(){return this;}},value=>{error=value;});
    return error;
  };
  try {
    const parentManaged=mappingHarness({productType:'variable',stockManaged:true,variationStockManagement:'parent',unitProfile:unit});
    const parentError=await invokeStockMap(parentManaged,'101','WOO-101');
    assert.equal(parentError?.code,'PRODUCT_STOCK_SCOPE_UNAVAILABLE');
    assert.equal(parentManaged.queries.some(query=>query.sql.startsWith('INSERT INTO sx_retail_external_product_mappings')),false);

    const unknownLegacy=mappingHarness({stockManaged:true,sourceStockManagement:'unknown',unitProfile:unit});
    const unknownError=await invokeStockMap(unknownLegacy,null,'WOO-100');
    assert.equal(unknownError?.code,'PRODUCT_STOCK_SCOPE_UNAVAILABLE');
    assert.equal(unknownLegacy.queries.some(query=>query.sql.startsWith('INSERT INTO sx_retail_external_product_mappings')),false);
  } finally {
    if(originalKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;
    else process.env.SALEMAX_PLATFORM_KEY_BASE64=originalKey;
  }
});

test('Woo variation mapping rejects a published child under a non-published parent', async () => {
  const originalKey=process.env.SALEMAX_PLATFORM_KEY_BASE64;
  process.env.SALEMAX_PLATFORM_KEY_BASE64=Buffer.alloc(32,14).toString('base64');
  try {
    const fixture=mappingHarness({productType:'variable',parentStatus:'draft'});
    let error=null;
    const req={businessContext:fixture.context,params:{id:fixture.connectionId},query:{},body:{externalProductId:'100',externalVariationId:'101',
      targetProductId:fixture.targetId,action:'map',expectedRevision:0,expectedSku:'WOO-101'}};
    const res={json(){return this;},sendStatus(status){return this;}};
    await fixture.handler(req,res,value=>{error=value;});
    assert.equal(error?.code,'INVALID_PRODUCT_MAPPING_SOURCE');
    assert.equal(fixture.queries.some(query=>query.sql.startsWith('SELECT variant_status AS status,sku,variant_ciphertext')) ,false);
    assert.equal(fixture.queries.some(query=>query.sql.startsWith('INSERT INTO sx_retail_external_product_mappings')),false);
  } finally {
    if(originalKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;
    else process.env.SALEMAX_PLATFORM_KEY_BASE64=originalKey;
  }
});

test('Woo mapping rejects stale edits before updating the target catalogue', async () => {
  const originalKey=process.env.SALEMAX_PLATFORM_KEY_BASE64;
  process.env.SALEMAX_PLATFORM_KEY_BASE64=Buffer.alloc(32,15).toString('base64');
  try {
    const fixture=mappingHarness({existingMapping:{id:'11111111-1111-4111-8111-111111111111',mappingStatus:'mapped',
      targetProductId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',revision:2}});
    let error=null;
    const req={businessContext:fixture.context,params:{id:fixture.connectionId},query:{},body:{externalProductId:'100',externalVariationId:null,
      targetProductId:fixture.targetId,action:'map',expectedRevision:1,expectedSku:'WOO-100'}};
    const res={json(){return this;},sendStatus(status){return this;}};
    await fixture.handler(req,res,value=>{error=value;});
    assert.equal(error?.code,'STORE_PRODUCT_MAPPING_CONFLICT');
    assert.equal(fixture.queries.some(query=>query.sql.startsWith('SELECT id,code FROM sx_product_catalog')),false);
    assert.equal(fixture.queries.some(query=>query.sql.startsWith('INSERT INTO sx_retail_external_product_mappings')),false);
    assert.equal(fixture.queries.some(query=>query.sql.startsWith('INSERT INTO sx_audit_events')),false);
  } finally {
    if(originalKey===undefined)delete process.env.SALEMAX_PLATFORM_KEY_BASE64;
    else process.env.SALEMAX_PLATFORM_KEY_BASE64=originalKey;
  }
});

test('redacted customers are not restored by later order or checkout imports', async () => {
  const originalKey = process.env.SALEMAX_PLATFORM_KEY_BASE64;
  process.env.SALEMAX_PLATFORM_KEY_BASE64 = Buffer.alloc(32, 9).toString('base64');
  const tenantId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const connectionId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const connection = {id: connectionId, tenant_id: tenantId, provider: 'woocommerce', default_currency: 'QAR'};
  const writes = [];
  const db = {query: async(sql,params)=>{
    if (sql.startsWith('SELECT source_updated_at AS sourceUpdatedAt,customer_status AS customerStatus,customer_directory_key AS customerDirectoryKey FROM sx_retail_external_customers')) {
      return [[{sourceUpdatedAt: new Date('2026-11-15T10:00:00Z'), customerStatus: 'redacted', customerDirectoryKey: null}],[]];
    }
    if (sql.startsWith('SELECT source_updated_at AS sourceUpdatedAt FROM sx_retail_external_orders') ||
        sql.startsWith('SELECT source_updated_at AS sourceUpdatedAt FROM sx_retail_external_checkouts')) return [[],[]];
    if (sql.trimStart().startsWith('SELECT')) return [[],[]];
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
    assert.equal(orderWrite.params[15], null);
    assert.equal(orderWrite.params[16], null);
    assert.equal(orderWrite.params[17], 'unknown');
    const order = connector.openJson({ciphertext: orderWrite.params[22], iv: orderWrite.params[23], authTag: orderWrite.params[24]}, tenantId, connectionId, 'order:900');
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
