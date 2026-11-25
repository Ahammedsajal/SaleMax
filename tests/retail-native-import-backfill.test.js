'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const backfill = require('../modules/platform/retail-native-import-backfill');
const worker = require('../modules/platform/retail-connected-stores-worker');

const tenantId = 'd55a3ee4-1111-4111-8111-111111111111';
const connectionId = 'd55a3ee4-2222-4222-8222-222222222222';

function fakePool({ orderRow = null } = {}) {
  let orderPending = orderRow ? 1 : 0;
  const writes = [];
  const db = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, params = []) {
      writes.push({ sql, params });
      if (sql.startsWith('SELECT p.external_product_id')) return [[], []];
      if (sql.startsWith('SELECT c.external_customer_id')) return [[], []];
      if (sql.startsWith('SELECT e.external_order_id')) {
        if (orderPending) { orderPending = 0; return [[orderRow], []]; }
        return [[], []];
      }
      if (sql.startsWith('SELECT COUNT(*) AS n FROM sx_retail_external_products')) return [[{ n: 0 }], []];
      if (sql.startsWith('SELECT COUNT(*) AS n FROM sx_retail_external_product_variants')) return [[{ n: 0 }], []];
      if (sql.startsWith('SELECT COUNT(*) AS n FROM sx_retail_external_customers')) return [[{ n: 0 }], []];
      if (sql.startsWith('SELECT COUNT(*) AS n FROM sx_retail_external_orders')) return [[{ n: orderPending }], []];
      return [[], []];
    },
  };
  return { writes, pool: { getConnection: async () => db, async query(...args) { return db.query(...args); } } };
}

test('redacted local order snapshots stay scrubbed during native backfill', async () => {
  const row = { id: 'order-1', customerExternalId: 'customer-1', customerStatus: 'redacted',
    ciphertext: Buffer.from('sealed'), iv: Buffer.from('iv'), authTag: Buffer.from('tag') };
  const { pool, writes } = fakePool({ orderRow: row });
  let imported;
  const result = await backfill.backfillConnection(pool, { id: connectionId, tenant_id: tenantId, provider: 'woocommerce', default_currency: 'QAR' }, {
    dependencies: {
      connector: {
        openJson: () => ({ id: row.id, customerId: row.customerExternalId,
          customer: { firstName: 'Should', lastName: 'Disappear', email: 'private@example.test', phone: '+97400000000' },
          contactConsent: 'granted', contactConsentAt: '2026-01-01', shippingAddress: { address: 'private' },
          billing: { address: 'private' }, lineItems: [], total: '1.00', currency: 'QAR',
          breakdown: { refunds: '0' }, status: 'processing', financialStatus: 'paid', createdAt: null }),
        seal: value => ({ ciphertext: Buffer.from(JSON.stringify(value)), iv: Buffer.from('iv'), authTag: Buffer.from('tag') }),
      },
      directory: {
        customerDirectoryKey: () => { throw new Error('redacted order must not receive a customer key'); },
        emailLookupHash: () => { throw new Error('redacted order must not receive an email hash'); },
      },
      nativeImports: {
        async upsertOrder(_db, _connection, order, key) { imported = { order, key }; },
        async refreshCustomerOrders() { throw new Error('not called'); },
        async upsertProduct() { throw new Error('not called'); },
        async upsertVariation() { throw new Error('not called'); },
      },
    },
  });

  assert.equal(result.orders, 1);
  assert.equal(result.skippedRedacted, 1);
  assert.equal(result.failed, 0);
  assert.equal(imported.key, null);
  assert.equal(imported.order.customer, null);
  assert.equal(imported.order.customerId, null);
  assert.equal(imported.order.contactConsent, 'unknown');
  assert.equal(imported.order.shippingAddress, null);
  assert.equal('billing' in imported.order, false);
  assert.ok(writes.some(item => item.sql.includes('UPDATE sx_retail_external_orders SET customer_external_id=NULL')));
});

test('orders without embedded customer details use their active imported customer snapshot', async () => {
  const row = { id: 'order-2', customerExternalId: 'customer-2', customerStatus: 'active', customerDirectoryKey: 'directory-key',
    customerCiphertext: Buffer.from('customer'), customerIv: Buffer.from('iv'), customerAuthTag: Buffer.from('tag'),
    ciphertext: Buffer.from('order'), iv: Buffer.from('iv'), authTag: Buffer.from('tag') };
  const { pool } = fakePool({ orderRow: row });
  let imported;
  const result = await backfill.backfillConnection(pool, { id: connectionId, tenant_id: tenantId, provider: 'woocommerce', default_currency: 'QAR' }, {
    dependencies: {
      connector: {
        openJson: (_row, _tenant, _connection, kind) => kind === 'order:order-2'
          ? { id: row.id, customer: null, customerId: null, lineItems: [], total: '1.00', currency: 'QAR',
            breakdown: { refunds: '0' }, status: 'processing', financialStatus: 'paid', createdAt: null }
          : { id: row.customerExternalId, firstName: 'Retail', lastName: 'Buyer', email: 'buyer@example.test', phone: '+97400000000' },
        seal: () => ({ ciphertext: Buffer.from('safe'), iv: Buffer.from('iv'), authTag: Buffer.from('tag') }),
      },
      directory: {
        customerDirectoryKey: () => 'computed-key', emailLookupHash: () => 'email-hash',
      },
      nativeImports: {
        async upsertOrder(_db, _connection, order, key) { imported = { order, key }; },
        async refreshCustomerOrders() {}, async upsertProduct() {}, async upsertVariation() {},
      },
    },
  });

  assert.equal(result.orders, 1);
  assert.equal(result.failed, 0);
  assert.equal(imported.key, 'directory-key');
  assert.equal(imported.order.customerId, 'customer-2');
  assert.equal(imported.order.customer.firstName, 'Retail');
});

test('unverified stores backfill local snapshots without contacting the provider', async () => {
  const connection = { id: connectionId, tenant_id: tenantId, provider: 'woocommerce', credentials_verified_at: null };
  const calls = [];
  const pool = { async query(sql) {
    if (sql.includes('FROM sx_retail_store_connections')) return [[connection], []];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const result = await worker.run(pool, {
    plansModule: { async loadEntitlements() { return { status: 'active', capabilities: ['retail.commerce'] }; } },
    backfillConnection: async (_pool, row) => { calls.push(['backfill', row.id]); return { products: 1, pending: {}, hasMore: false }; },
    syncWoo: async () => { calls.push(['woo']); throw new Error('Provider sync must remain paused'); },
    syncShopify: async () => { calls.push(['shopify']); throw new Error('Provider sync must remain paused'); },
  });

  assert.equal(result.results[0].status, 'credentials_required');
  assert.deepEqual(calls, [['backfill', connectionId]]);
});

test('redaction is enforced at the snapshot boundary', () => {
  const original = { customerId: 'customer-1', customer: { email: 'private@example.test' },
    contactConsent: 'granted', shippingAddress: { city: 'Doha' } };
  const safe = backfill.prepareOrderSnapshot(original, 'redacted');
  assert.deepEqual({ customerId: safe.customerId, customer: safe.customer, contactConsent: safe.contactConsent,
    shippingAddress: safe.shippingAddress }, { customerId: null, customer: null, contactConsent: 'unknown', shippingAddress: null });
  assert.equal(original.customer.email, 'private@example.test');
});

test('customer backfill compares source identity hashes using the database ASCII collation', async () => {
  const statements = [];
  const pool = { async query(sql) { statements.push(sql); return [[{ n: 0 }], []]; } };

  await backfill.pendingCounts(pool, { id: connectionId, tenant_id: tenantId });

  assert.equal(statements.length, 4);
  assert.match(statements[2], /CONVERT\(SHA2\(CONCAT\(c\.connection_id,CHAR\(0\),c\.external_customer_id\),256\) USING ascii\) COLLATE ascii_bin/);
});
