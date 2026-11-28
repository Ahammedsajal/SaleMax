'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const directory = require('../modules/platform/retail-customer-directory');
const nativeImports = require('../modules/platform/retail-native-imports');
const retailCommerce = require('../modules/platform/retail-commerce');
const connector = require('../modules/platform/retail-connected-stores');
const shopifySync = require('../modules/platform/retail-shopify-sync');

const tenantId = '11111111-1111-4111-8111-111111111111';
const connectionId = '22222222-2222-4222-8222-222222222222';
const originalKey = process.env.SALEMAX_PLATFORM_KEY_BASE64;
process.env.SALEMAX_PLATFORM_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');
test.after(() => {
  if (originalKey === undefined) delete process.env.SALEMAX_PLATFORM_KEY_BASE64;
  else process.env.SALEMAX_PLATFORM_KEY_BASE64 = originalKey;
});

test('customer directory filters returning identities and exact order references inside the tenant',async()=>{
  const calls=[],profileKey='f'.repeat(64);
  const pool={async query(sql,params){calls.push({sql,params});
    if(sql.startsWith('SELECT COUNT(*) AS n FROM ('))return [[{n:1}],[]];
    if(sql.startsWith('SELECT purchase.customerDirectoryKey FROM'))return [[{customerDirectoryKey:profileKey}],[]];
    throw Error('Unexpected directory query: '+sql);
  }};
  const result=await directory.listKeys(pool,tenantId,{search:'Lina',order:'EB-9001',segment:'returning'});
  assert.deepEqual(result,{keys:[profileKey],total:1,page:1,limit:20,hasMore:false});
  assert.match(calls[0].sql,/purchase\.customerDirectoryKey/);
  assert.match(calls[0].sql,/HAVING MAX\(matched\)=1 AND COUNT\(\*\)>1/);
  assert.match(calls[0].sql,/sx_retail_customer_search_tokens/);
  assert.deepEqual(calls[0].params.slice(0,5),['EB-9001','EB-9001',tenantId,'EB-9001',tenantId]);
  assert.doesNotMatch(calls[0].sql,/buyer_phone|buyer_email|customer_ciphertext/i);
});

test('customer search indexes and erasure use the same connection-scoped source ID', async () => {
  const calls = [];
  const db = { async query(sql, params) { calls.push({ sql, params }); return [[], []]; } };
  const sourceId = 'external-customer-9';
  await directory.indexSource(db, { tenantId, connectionId, sourceKind: 'customer', sourceId,
    directoryKey: 'a'.repeat(64), customer: { firstName: 'Amina', lastName: 'Hassan', email: 'AMINA@example.qa', phone: '+974 5555 1234' } });
  const scopedId = crypto.createHash('sha256').update(connectionId).update('\0').update(sourceId).digest('hex');
  assert.deepEqual(calls[0].params, [tenantId, 'customer', scopedId]);
  const inserts = calls.filter(call => /INSERT IGNORE INTO sx_retail_customer_search_tokens/.test(call.sql));
  assert.ok(inserts.length > 5);
  assert.ok(inserts.every(call => call.params[3] === scopedId));
  assert.ok(inserts.every(call => !call.params.includes('AMINA@example.qa')));
});

test('tenant email grouping is exact, normalized, and isolated by tenant', () => {
  const first = directory.customerDirectoryKey(tenantId, connectionId, 'one', { email: '  Amina@Example.qa ' });
  const same = directory.customerDirectoryKey(tenantId, '33333333-3333-4333-8333-333333333333', 'two', { email: 'amina@example.qa' });
  const otherTenant = directory.customerDirectoryKey('44444444-4444-4444-8444-444444444444', connectionId, 'one', { email: 'amina@example.qa' });
  assert.equal(first, same);
  assert.notEqual(first, otherTenant);
  assert.notEqual(first, directory.customerDirectoryKey(tenantId, connectionId, 'one', { email: 'amina+shop@example.qa' }));
});

test('store-reported paid amount does not treat an unreported partial payment as fully paid', () => {
  assert.equal(directory.reportedNetPaid({ totalAmount: '125.000000', financialStatus: 'paid' }, []), '125.000000');
  assert.equal(directory.reportedNetPaid({ totalAmount: '125.000000', financialStatus: 'partially_paid' }, []), '0.000000');
  assert.equal(directory.reportedNetPaid({ totalAmount: '125.000000', financialStatus: 'partially_paid' }, [
    { kind: 'payment', status: 'success', amount: '40.000000' }, { kind: 'refund', status: 'success', amount: '5.000000' },
  ]), '35.000000');
});

test('Shopify GraphQL refund nodes normalize without losing refund transactions', () => {
  const order = connector.normalizeOrder('shopify', {
    id: 'gid://shopify/Order/900', name: '#900', displayFinancialStatus: 'PARTIALLY_REFUNDED',
    currency: 'USD', totalPriceSet: { shopMoney: { amount: '125.00', currencyCode: 'USD' } },
    createdAt: '2026-11-25T10:00:00.000Z', updatedAt: '2026-11-25T10:00:00.000Z',
    transactions: { nodes: [{ id: 'gid://shopify/OrderTransaction/1', kind: 'SALE', status: 'SUCCESS',
      amountSet: { shopMoney: { amount: '125.00', currencyCode: 'USD' } } }] },
    refunds: { nodes: [{ id: 'gid://shopify/Refund/1', transactions: { nodes: [{ id: 'gid://shopify/OrderTransaction/2',
      kind: 'REFUND', status: 'SUCCESS', amountSet: { shopMoney: { amount: '25.00', currencyCode: 'USD' } } }], pageInfo: { hasNextPage: false } } }],
      pageInfo: { hasNextPage: false } },
    lineItems: { nodes: [], pageInfo: { hasNextPage: false } },
  });
  assert.equal(order.id, 'gid://shopify/Order/900');
  assert.equal(order.transactions.length, 2);
  assert.equal(order.transactions[1].kind, 'REFUND');
  assert.equal(order.transactions[1].amount, '25.000000');
});

test('Shopify product variant pagination retains the source count and a durable cursor', () => {
  const product = connector.normalizeProduct('shopify', {
    id: 'gid://shopify/Product/100', title: 'Linen shirt', variantsCount: { count: '9' },
    variants: { nodes: [{ id: 'gid://shopify/ProductVariant/1001', title: 'Small', sku: 'LINEN-S', price: '12.50' }],
      pageInfo: { hasNextPage: true, endCursor: 'variant-cursor-1' } },
  });
  assert.equal(product.sku, null, 'Shopify variant SKUs are not duplicated onto the parent product');
  assert.equal(product.variationCount, 9);
  assert.equal(product.variantsTruncated, true);
  const queue = [];
  assert.equal(shopifySync.queueVariantPage(queue, { id: product.id,
    variants: { pageInfo: { hasNextPage: true, endCursor: 'variant-cursor-1' } } }), true);
  assert.equal(shopifySync.queueVariantPage(queue, { id: product.id,
    variants: { pageInfo: { hasNextPage: true, endCursor: 'variant-cursor-1' } } }), false);
  assert.deepEqual(queue, [{ productId: product.id, after: 'variant-cursor-1' }]);
  const queries = shopifySync.compactShopifyQueries();
  assert.match(queries.products, /products\(first: 25, after: \$after, sortKey: ID\)/);
  assert.match(queries.products, /variantsCount\s*\{\s*count\s*\}/);
  assert.match(queries.products, /pageInfo\s*\{\s*hasNextPage\s+endCursor\s*\}/);
  assert.match(queries.productVariants, /variants\(first: 100, after: \$after\)/);
});

test('Shopify variant records preserve SKU, selected options and currency for reconciliation', async () => {
  const calls = [];
  const db = { async query(sql, params = []) { calls.push({ sql, params }); return [[], []]; } };
  const connection = { tenant_id: tenantId, id: connectionId, provider: 'shopify', default_currency: 'QAR' };
  const normalized = connector.normalizeShopifyProductVariant('gid://shopify/Product/100', {
    id: 'gid://shopify/ProductVariant/1001', title: 'Small', sku: 'LINEN-S', price: '12.50',
    availableForSale: true, selectedOptions: [{ name: 'Size', value: 'S' }], updatedAt: '2026-11-25T10:00:00Z',
  }, 'USD');
  assert.equal(normalized.currency, 'USD');
  assert.equal(normalized.attributes[0].option, 'S');
  assert.equal(normalized.purchasable, true);
  assert.equal(normalized.sourceStock.managementMode, 'unknown');
  const result = await connector.persistShopifyProductVariants(db, connection, normalized.productId, [{
    id: 'gid://shopify/ProductVariant/1001', title: 'Small', sku: 'LINEN-S', price: '12.50',
    availableForSale: true, selectedOptions: [{ name: 'Size', value: 'S' }], updatedAt: '2026-11-25T10:00:00Z', currencyCode: 'USD',
  }], false);
  assert.deepEqual(result, { accepted: 1, total: 1 });
  const insert = calls.find(call => /INSERT INTO sx_retail_external_product_variants/.test(call.sql));
  assert.ok(insert);
  assert.equal((insert.sql.match(/\?/g) || []).length, insert.params.length);
  assert.equal(insert.params[3], normalized.id);
  assert.equal(insert.params[4], 'LINEN-S');
  assert.equal(insert.params[6], 'USD');
});

test('native Retail order and product imports bind every SQL parameter', async () => {
  const calls = [];
  const db = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (/SELECT id FROM sx_retail_locations/.test(sql)) return [[{ id: '55555555-5555-4555-8555-555555555555' }], []];
    if (/SELECT id FROM sx_retail_orders WHERE tenant_id/.test(sql)) return [[{ id: '66666666-6666-4666-8666-666666666666' }], []];
    if (/SELECT COALESCE\(MAX\(version\),0\)/.test(sql)) return [[{ version: 0 }], []];
    return [[], []];
  } };
  const connection = { tenant_id: tenantId, id: connectionId, provider: 'woocommerce', default_currency: 'QAR', created_by_identity_id: 'owner' };
  await nativeImports.upsertProduct(db, connection, { id: '100', title: 'Linen shirt', sku: 'LINEN', descriptionEn: 'Linen', price: '12.50', currency: 'QAR', variants: [] });
  await nativeImports.upsertOrder(db, connection, { id: '900', number: '900', currency: 'QAR', total: '25.00', status: 'processing',
    financialStatus: 'paid', breakdown: { refunds: '0' }, createdAt: '2026-11-25T10:00:00.000Z',
    customer: { firstName: 'Amina', email: 'amina@example.qa' }, lineItems: [{ id: 'line-1', productId: '100', variantId: '', title: 'Linen shirt', sku: 'LINEN', quantity: '2', unitPrice: '12.50', total: '25.00' }] },
  directory.customerDirectoryKey(tenantId, connectionId, 'customer-1', { email: 'amina@example.qa' }));
  for (const call of calls) assert.equal((call.sql.match(/\?/g) || []).length, call.params.length, call.sql.slice(0, 140));
  const catalogueInsert = calls.find(call => /INSERT INTO sx_product_catalog/.test(call.sql));
  const orderInsert = calls.find(call => /INSERT INTO sx_retail_orders/.test(call.sql));
  assert.ok(catalogueInsert);
  assert.ok(orderInsert);
  assert.equal(orderInsert.params[9], '55555555-5555-4555-8555-555555555555');
  assert.equal(orderInsert.params[10], 'QAR');
});

test('native imported orders are accepted before a default stock location exists', async () => {
  const calls = [];
  const db = { async query(sql, params = []) {
    calls.push({ sql, params });
    if (/SELECT id FROM sx_retail_orders WHERE tenant_id/.test(sql)) return [[{ id: '66666666-6666-4666-8666-666666666666' }], []];
    return [[], []];
  } };
  const connection = { tenant_id: tenantId, id: connectionId, provider: 'woocommerce', default_currency: 'QAR' };
  await nativeImports.upsertOrder(db, connection, { id: '901', currency: 'QAR', total: '25.00', status: 'processing',
    customer: { firstName: 'Amina' }, lineItems: [] },
  directory.customerDirectoryKey(tenantId, connectionId, 'customer-2', { email: 'amina@example.qa' }));
  const insert = calls.find(call => /INSERT INTO sx_retail_orders/.test(call.sql));
  assert.ok(insert);
  assert.equal(insert.params[9], null, 'unassigned source orders have no local stock location');
  assert.equal(calls.find(call => /SELECT id FROM sx_retail_locations/.test(call.sql)).params.length, 1);
  assert.equal((insert.sql.match(/\?/g) || []).length, insert.params.length);
});

test('imported Retail orders reject local fulfilment transitions', async () => {
  const queries = [];
  const db = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql) {
      queries.push(sql);
      if (/FROM sx_retail_orders/.test(sql)) return [[{ status: 'placed', fulfillment: 'pickup', externalSourceConnectionId: connectionId }], []];
      return [[], []];
    },
  };
  await assert.rejects(retailCommerce.transition({ getConnection: async () => db }, tenantId,
    { identityId: 'owner', membershipId: 'owner-membership' }, '66666666-6666-4666-8666-666666666666', 'ready', false),
  { code: 'IMPORTED_ORDER_READ_ONLY' });
  assert.equal(queries.length, 1);
  assert.match(queries[0], /external_source_connection_id AS externalSourceConnectionId/);
});


test('WooCommerce and Shopify product normalization retain ordered image galleries capped at twelve', () => {
  const wooImages = Array.from({ length: 14 }, (_, index) => ({ src: `https://cdn.store.qa/product-${index}.jpg` }));
  const woo = connector.normalizeProduct('woocommerce', { id: '101', name: 'Linen shirt', images: wooImages });
  assert.equal(woo.imageUrls.length, 12);
  assert.deepEqual(woo.imageUrls, wooImages.slice(0, 12).map(image => image.src));
  assert.equal(woo.imageUrl, woo.imageUrls[0]);

  const shopifyImages = Array.from({ length: 14 }, (_, index) => ({
    image: { url: `https://cdn.store.qa/shopify-${index}.jpg`, altText: `View ${index}` },
  }));
  const shopify = connector.normalizeProduct('shopify', {
    id: 'gid://shopify/Product/101', title: 'Linen shirt', media: { nodes: shopifyImages },
  });
  assert.equal(shopify.imageUrls.length, 12);
  assert.deepEqual(shopify.imageUrls, shopifyImages.slice(0, 12).map(image => image.image.url));
  assert.equal(shopify.imageUrl, shopify.imageUrls[0]);
  assert.match(shopifySync.compactShopifyQueries().products, /media\(first: 12\)/);
});