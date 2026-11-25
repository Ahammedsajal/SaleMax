'use strict';

const crypto = require('node:crypto');
const connector = require('./retail-connected-stores');
const directory = require('./retail-customer-directory');
const nativeImports = require('./retail-native-imports');

const MAX_BATCH_SIZE = 100;
const SOURCE_ID_HASH_SQL = "SHA2(CONCAT(c.connection_id,CHAR(0),c.external_customer_id),256)";

function validLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
    throw Object.assign(Error('INVALID_BACKFILL_LIMIT'), { code: 'INVALID_BACKFILL_LIMIT' });
  }
  return limit;
}

function safeCode(error) {
  return /^[A-Z0-9_]{1,64}$/.test(String(error?.code || '')) ? error.code : 'RETAIL_BACKFILL_ROW_FAILED';
}

function prepareOrderSnapshot(order, customerStatus) {
  if (customerStatus !== 'redacted') return order;
  const safe = { ...order, customer: null, customerId: null, contactConsent: 'unknown', contactConsentAt: null,
    shippingAddress: null, billingAddress: null };
  delete safe.billing;
  delete safe.shipping;
  return safe;
}

async function inBatch(pool, connection, { kind, sql, params, apply, limit, result }) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [rows] = await db.query(sql, [...params, limit]);
    for (const row of rows) {
      await db.query('SAVEPOINT retail_native_backfill_row');
      try {
        await apply(db, row);
        await db.query('RELEASE SAVEPOINT retail_native_backfill_row');
        result[kind]++;
      } catch (error) {
        await db.query('ROLLBACK TO SAVEPOINT retail_native_backfill_row');
        await db.query('RELEASE SAVEPOINT retail_native_backfill_row');
        result.failed++;
        if (result.failures.length < 20) result.failures.push({ source: kind, code: safeCode(error) });
      }
    }
    await db.commit();
    return rows.length;
  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

async function pendingCounts(db, connection) {
  const [[products]] = await db.query(`SELECT COUNT(*) AS n FROM sx_retail_external_products p
    LEFT JOIN sx_retail_catalogue_imports i ON i.tenant_id=p.tenant_id AND i.connection_id=p.connection_id
      AND i.external_product_id=p.external_product_id AND i.external_variant_id=''
    WHERE p.tenant_id=? AND p.connection_id=? AND p.product_status<>'deleted' AND p.product_ciphertext IS NOT NULL AND i.product_id IS NULL`,
  [connection.tenant_id, connection.id]);
  const [[variants]] = await db.query(`SELECT COUNT(*) AS n FROM sx_retail_external_product_variants v
    JOIN sx_retail_catalogue_imports parent ON parent.tenant_id=v.tenant_id AND parent.connection_id=v.connection_id
      AND parent.external_product_id=v.external_product_id AND parent.external_variant_id=''
    LEFT JOIN sx_retail_catalogue_imports i ON i.tenant_id=v.tenant_id AND i.connection_id=v.connection_id
      AND i.external_product_id=v.external_product_id AND i.external_variant_id=v.external_variant_id
    WHERE v.tenant_id=? AND v.connection_id=? AND v.variant_status<>'deleted' AND v.variant_ciphertext IS NOT NULL AND i.product_id IS NULL`,
  [connection.tenant_id, connection.id]);
  const [[customers]] = await db.query(`SELECT COUNT(*) AS n FROM sx_retail_external_customers c
    WHERE c.tenant_id=? AND c.connection_id=? AND c.customer_status='active' AND c.customer_ciphertext IS NOT NULL
      AND (c.customer_directory_key IS NULL OR NOT EXISTS (
        SELECT 1 FROM sx_retail_customer_search_tokens t WHERE t.tenant_id=c.tenant_id AND t.connection_id=c.connection_id
          AND t.source_kind='customer' AND t.source_id=${SOURCE_ID_HASH_SQL}))`, [connection.tenant_id, connection.id]);
  const [[orders]] = await db.query(`SELECT COUNT(*) AS n FROM sx_retail_external_orders e
    LEFT JOIN sx_retail_orders o ON o.tenant_id=e.tenant_id AND o.external_source_connection_id=e.connection_id
      AND o.external_source_order_id=e.external_order_id
    WHERE e.tenant_id=? AND e.connection_id=? AND e.order_ciphertext IS NOT NULL AND o.id IS NULL`, [connection.tenant_id, connection.id]);
  return { products: Number(products?.n || 0), variants: Number(variants?.n || 0), customers: Number(customers?.n || 0), orders: Number(orders?.n || 0) };
}

async function backfillConnection(pool, connection, { limit = 25, dependencies = {} } = {}) {
  validLimit(limit);
  const cryptoConnector = dependencies.connector || connector;
  const customerDirectory = dependencies.directory || directory;
  const imports = dependencies.nativeImports || nativeImports;
  const result = { connectionId: connection.id, products: 0, variants: 0, customers: 0, orders: 0,
    skippedRedacted: 0, failed: 0, failures: [], pending: null, hasMore: false };

  await inBatch(pool, connection, {
    kind: 'products', limit, result, params: [connection.tenant_id, connection.id],
    sql: `SELECT p.external_product_id AS id,p.product_ciphertext AS ciphertext,p.product_iv AS iv,p.product_auth_tag AS authTag
      FROM sx_retail_external_products p LEFT JOIN sx_retail_catalogue_imports i
        ON i.tenant_id=p.tenant_id AND i.connection_id=p.connection_id AND i.external_product_id=p.external_product_id AND i.external_variant_id=''
      WHERE p.tenant_id=? AND p.connection_id=? AND p.product_status<>'deleted' AND p.product_ciphertext IS NOT NULL AND i.product_id IS NULL
      ORDER BY p.external_product_id LIMIT ? FOR UPDATE`,
    apply: async (db, row) => {
      const product = cryptoConnector.openJson(row, connection.tenant_id, connection.id, `product:${row.id}`);
      await imports.upsertProduct(db, connection, product);
    },
  });

  let pending = await pendingCounts(pool, connection);
  if (!pending.products) {
    await inBatch(pool, connection, {
      kind: 'variants', limit, result, params: [connection.tenant_id, connection.id],
      sql: `SELECT v.external_product_id AS productId,v.external_variant_id AS id,
          v.variant_ciphertext AS ciphertext,v.variant_iv AS iv,v.variant_auth_tag AS authTag
        FROM sx_retail_external_product_variants v
        JOIN sx_retail_catalogue_imports parent ON parent.tenant_id=v.tenant_id AND parent.connection_id=v.connection_id
          AND parent.external_product_id=v.external_product_id AND parent.external_variant_id=''
        LEFT JOIN sx_retail_catalogue_imports i ON i.tenant_id=v.tenant_id AND i.connection_id=v.connection_id
          AND i.external_product_id=v.external_product_id AND i.external_variant_id=v.external_variant_id
        WHERE v.tenant_id=? AND v.connection_id=? AND v.variant_status<>'deleted' AND v.variant_ciphertext IS NOT NULL AND i.product_id IS NULL
        ORDER BY v.external_product_id,v.external_variant_id LIMIT ? FOR UPDATE`,
      apply: async (db, row) => {
        const variation = cryptoConnector.openJson(row, connection.tenant_id, connection.id, `product-variant:${row.id}`);
        await imports.upsertVariation(db, connection, variation);
      },
    });
  }

  await inBatch(pool, connection, {
    kind: 'customers', limit, result, params: [connection.tenant_id, connection.id],
    sql: `SELECT c.external_customer_id AS id,c.customer_ciphertext AS ciphertext,c.customer_iv AS iv,c.customer_auth_tag AS authTag
      FROM sx_retail_external_customers c WHERE c.tenant_id=? AND c.connection_id=? AND c.customer_status='active'
        AND c.customer_ciphertext IS NOT NULL AND (c.customer_directory_key IS NULL OR NOT EXISTS (
          SELECT 1 FROM sx_retail_customer_search_tokens t WHERE t.tenant_id=c.tenant_id AND t.connection_id=c.connection_id
            AND t.source_kind='customer' AND t.source_id=${SOURCE_ID_HASH_SQL}))
      ORDER BY c.external_customer_id LIMIT ? FOR UPDATE`,
    apply: async (db, row) => {
      const customer = cryptoConnector.openJson(row, connection.tenant_id, connection.id, `customer:${row.id}`);
      const key = customerDirectory.customerDirectoryKey(connection.tenant_id, connection.id, row.id, customer);
      const emailHash = customerDirectory.emailLookupHash(connection.tenant_id, customer.email);
      await db.query(`UPDATE sx_retail_external_customers SET customer_directory_key=?,email_lookup_hash=?
        WHERE tenant_id=? AND connection_id=? AND external_customer_id=? AND customer_status='active'`,
      [key, emailHash, connection.tenant_id, connection.id, row.id]);
      await customerDirectory.indexSource(db, { tenantId: connection.tenant_id, connectionId: connection.id,
        sourceKind: 'customer', sourceId: row.id, directoryKey: key, customer });
      await imports.refreshCustomerOrders(db, connection, row.id, key, customer);
    },
  });

  pending = await pendingCounts(pool, connection);
  if (!pending.products && !pending.variants) {
    await inBatch(pool, connection, {
      kind: 'orders', limit, result, params: [connection.tenant_id, connection.id],
      sql: `SELECT e.external_order_id AS id,e.customer_external_id AS customerExternalId,
          c.customer_status AS customerStatus,e.order_ciphertext AS ciphertext,e.order_iv AS iv,e.order_auth_tag AS authTag
        FROM sx_retail_external_orders e LEFT JOIN sx_retail_external_customers c
          ON c.tenant_id=e.tenant_id AND c.connection_id=e.connection_id AND c.external_customer_id=e.customer_external_id
        LEFT JOIN sx_retail_orders o ON o.tenant_id=e.tenant_id AND o.external_source_connection_id=e.connection_id
          AND o.external_source_order_id=e.external_order_id
        WHERE e.tenant_id=? AND e.connection_id=? AND e.order_ciphertext IS NOT NULL AND o.id IS NULL
        ORDER BY e.source_created_at,e.external_order_id LIMIT ? FOR UPDATE`,
      apply: async (db, row) => {
        let order = cryptoConnector.openJson(row, connection.tenant_id, connection.id, `order:${row.id}`);
        order = prepareOrderSnapshot(order, row.customerStatus);
        let key = null, emailHash = null;
        if (order.customer) {
          key = customerDirectory.customerDirectoryKey(connection.tenant_id, connection.id, order.customerId, order.customer, row.id);
          emailHash = customerDirectory.emailLookupHash(connection.tenant_id, order.customer.email);
        } else if (row.customerStatus === 'redacted') {
          const encrypted = cryptoConnector.seal(order, connection.tenant_id, connection.id, `order:${row.id}`);
          await db.query(`UPDATE sx_retail_external_orders SET customer_external_id=NULL,customer_directory_key=NULL,email_lookup_hash=NULL,
            contact_consent='unknown',consent_at=NULL,customer_ciphertext=NULL,customer_iv=NULL,customer_auth_tag=NULL,
            order_ciphertext=?,order_iv=?,order_auth_tag=? WHERE tenant_id=? AND connection_id=? AND external_order_id=?`,
          [encrypted.ciphertext, encrypted.iv, encrypted.authTag, connection.tenant_id, connection.id, row.id]);
          result.skippedRedacted++;
        } else {
          key = customerDirectory.customerDirectoryKey(connection.tenant_id, connection.id, null, null, row.id);
        }
        if (row.customerStatus !== 'redacted') {
          await db.query(`UPDATE sx_retail_external_orders SET customer_directory_key=?,email_lookup_hash=?
            WHERE tenant_id=? AND connection_id=? AND external_order_id=?`,
          [key, emailHash, connection.tenant_id, connection.id, row.id]);
        }
        await imports.upsertOrder(db, connection, order, key);
      },
    });
  }

  result.pending = await pendingCounts(pool, connection);
  result.hasMore = Object.values(result.pending).some(value => value > 0);
  return result;
}

async function backfillActiveConnections(pool, { limit = 25, maxRounds = 20, logger = console, plansModule,
  backfill = backfillConnection } = {}) {
  validLimit(limit);
  if (!Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > 100) {
    throw Object.assign(Error('INVALID_BACKFILL_ROUNDS'), { code: 'INVALID_BACKFILL_ROUNDS' });
  }
  const entitlementService = plansModule || require('./plans');
  const entitlements = new Map(), results = [];
  let cursorTenantId = '', cursorConnectionId = '', checked = 0;
  while (true) {
    const [connections] = await pool.query(`SELECT id,tenant_id,provider,default_currency,created_by_identity_id,status,
        credentials_verified_at,last_sync_at FROM sx_retail_store_connections
      WHERE status='active' AND (tenant_id>? OR (tenant_id=? AND id>?)) ORDER BY tenant_id,id LIMIT ?`,
    [cursorTenantId, cursorTenantId, cursorConnectionId, 25]);
    if (!connections.length) break;
    const last = connections[connections.length - 1];
    cursorTenantId = last.tenant_id;
    cursorConnectionId = last.id;
    checked += connections.length;
    for (const connection of connections) {
      let entitlement = entitlements.get(connection.tenant_id);
      if (!entitlements.has(connection.tenant_id)) {
        entitlement = await entitlementService.loadEntitlements(pool, connection.tenant_id);
        entitlements.set(connection.tenant_id, entitlement || null);
      }
      if (!entitlement || !['active', 'trial', 'grace'].includes(entitlement.status) ||
          !entitlement.capabilities?.includes('retail.commerce')) {
        results.push({ connectionId: connection.id, status: 'skipped', reason: 'FEATURE_UNAVAILABLE' });
        continue;
      }
      const total = { products: 0, variants: 0, customers: 0, orders: 0, skippedRedacted: 0, failed: 0, failures: [], pending: null };
      for (let round = 0; round < maxRounds; round++) {
        const current = await backfill(pool, connection, { limit });
        for (const key of ['products', 'variants', 'customers', 'orders', 'skippedRedacted', 'failed']) total[key] += current[key] || 0;
        total.failures.push(...current.failures.slice(0, Math.max(0, 20 - total.failures.length)));
        total.pending = current.pending;
        if (current.failed || !current.hasMore) break;
      }
      const status = !connection.credentials_verified_at ? 'credentials_required' : total.failed ? 'partial' : 'backfilled';
      results.push({ connectionId: connection.id, status, ...total, hasMore: Object.values(total.pending || {}).some(value => value > 0) });
      if (total.failed) logger.error('Retail local snapshot backfill needs review.', {
        connectionId: connection.id, failures: total.failed, codes: total.failures.map(item => item.code),
      });
    }
    if (connections.length < 25) break;
  }
  return { checked, results };
}

module.exports = { backfillConnection, backfillActiveConnections, prepareOrderSnapshot, pendingCounts };
