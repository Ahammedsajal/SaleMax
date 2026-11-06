'use strict';

const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const connector = require('./retail-connected-stores');
const { decision } = require('./policy');
const originCheck = require('./request-origin');

const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const reply = (res, data) => res.json({ success: true, data });
const noStore = (req, res, next) => { res.set('Cache-Control', 'private, no-store, max-age=0'); res.set('Pragma', 'no-cache'); next(); };
const fail = connector.fail;
const validVersion = value => /^20\d{2}-(01|04|07|10)$/.test(value || '');
const safeConnection = row => ({ id: row.id, provider: row.provider, storeDomain: row.store_domain, displayName: row.display_name,
  currency: row.default_currency, status: row.status, scopes: parseJson(row.scopes, []), lastSyncAt: row.last_sync_at,
  lastErrorCode: row.last_error_code, counts: row.counts || { orders: 0, customers: 0, products: 0, checkouts: 0 } });
function parseJson(value, fallback) { try { return typeof value === 'string' ? JSON.parse(value) : value || fallback; } catch { return fallback; } }
function jsonFromEncrypted(row, tenantId, connectionId, kind) { return connector.openJson(row, tenantId, connectionId, kind); }
function auditSql() { return `INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
  VALUES (?, ?, ?, 'identity', ?, 'retail-store-connection', ?, ?, ?)`; }
async function audit(db, context, action, connectionId, changes = {}) {
  await db.query(auditSql(), [crypto.randomUUID(), context.tenant.id, context.identity.id, action, connectionId, JSON.stringify(changes), crypto.randomUUID()]);
}
function originGuard(origin) { return (req, res, next) => originCheck.matches(req, origin) ? next() : res.sendStatus(403); }
function cleanError(error) {
  const code = String(error?.code || '').match(/^[A-Z0-9_]{1,64}$/)?.[0] || 'RETAIL_CONNECTOR_FAILED';
  const status = Number(error?.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 502;
  return { code, status };
}
async function loadConnection(pool, tenantId, id) {
  if (!connector.validateId(id)) fail('STORE_CONNECTION_NOT_FOUND', 404);
  const [[row]] = await pool.query('SELECT * FROM sx_retail_store_connections WHERE tenant_id=? AND id=?', [tenantId, id]);
  if (!row) fail('STORE_CONNECTION_NOT_FOUND', 404);
  return row;
}
async function privacyRows(pool, query, params) {
  const pageSize = 500, maxRows = 5000, rows = [];
  while (rows.length < maxRows) {
    const [page] = await pool.query(`${query} LIMIT ? OFFSET ?`, [...params, pageSize, rows.length]);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
  const [extra] = await pool.query(`${query} LIMIT 1 OFFSET ?`, [...params, rows.length]);
  if (extra.length) fail('PRIVACY_EXPORT_TOO_LARGE', 413);
  return rows;
}
function credentials(row) {
  if (!row.credentials_ciphertext || !row.credentials_iv || !row.credentials_auth_tag) fail('STORE_CONNECTION_NOT_READY', 409);
  return connector.openJson({ ciphertext: row.credentials_ciphertext, iv: row.credentials_iv, authTag: row.credentials_auth_tag }, row.tenant_id, row.id, 'credentials');
}
function shopifyConfig(env = process.env) {
  const clientId = env.SALEMAX_SHOPIFY_CLIENT_ID, clientSecret = env.SALEMAX_SHOPIFY_CLIENT_SECRET;
  const version = env.SALEMAX_SHOPIFY_API_VERSION || '2026-10';
  if (!clientId || !clientSecret || !validVersion(version)) fail('SHOPIFY_APP_NOT_CONFIGURED', 503);
  return { clientId, clientSecret, version, readAllOrders: env.SALEMAX_SHOPIFY_READ_ALL_ORDERS === 'true' };
}
function publicOrigin(value) {
  if (typeof value !== 'string') fail('SHOPIFY_APP_NOT_CONFIGURED', 503);
  let parsed; try { parsed = new URL(value); } catch { fail('SHOPIFY_APP_NOT_CONFIGURED', 503); }
  if (parsed.protocol !== 'https:' && !(process.env.LOCAL_ONLY_MODE === 'true' && parsed.protocol === 'http:' && ['127.0.0.1','localhost'].includes(parsed.hostname))) fail('SHOPIFY_APP_NOT_CONFIGURED', 503);
  return parsed.origin;
}
function webhookUrl(origin, provider, id) { return `${origin}/api/retail-connectors/${provider}/${encodeURIComponent(id)}`; }
function compactShopifyQueries() {
  const after = '$after: String';
  const pageInfo = 'pageInfo { hasNextPage endCursor }';
  return {
    products: `query Products(${after}) { products(first: 25, after: $after, sortKey: UPDATED_AT) { edges { cursor node { id title handle status updatedAt featuredImage { url altText } priceRangeV2 { minVariantPrice { amount currencyCode } } variants(first: 5) { nodes { id title sku price } pageInfo { hasNextPage } } } } ${pageInfo} } }`,
    orders: `query Orders(${after}) { orders(first: 10, after: $after, sortKey: UPDATED_AT) { edges { cursor node { id name displayFinancialStatus displayFulfillmentStatus cancelledAt closed currency totalPriceSet { shopMoney { amount currencyCode } } createdAt updatedAt customer { id firstName lastName email phone emailMarketingConsent { marketingState marketingOptInLevel consentUpdatedAt } defaultAddress { address1 address2 city province zip countryCodeV2 } } lineItems(first: 20) { nodes { id title quantity sku originalUnitPriceSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage } } transactions(first: 20) { nodes { id kind status gateway createdAt amountSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage } } refunds { id createdAt totalRefundedSet { shopMoney { amount currencyCode } } transactions(first: 20) { nodes { id kind status gateway createdAt amountSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage } } } } } ${pageInfo} } }`,
    customers: `query Customers(${after}) { customers(first: 50, after: $after, sortKey: UPDATED_AT) { edges { cursor node { id firstName lastName email phone emailMarketingConsent { marketingState marketingOptInLevel consentUpdatedAt } updatedAt defaultAddress { address1 address2 city province zip countryCodeV2 } } } ${pageInfo} } }`,
    checkouts: `query Checkouts(${after}) { abandonedCheckouts(first: 20, after: $after, sortKey: ID) { edges { cursor node { id createdAt updatedAt completedAt abandonedCheckoutUrl totalPriceSet { shopMoney { amount currencyCode } } customer { id firstName lastName email phone emailMarketingConsent { marketingState marketingOptInLevel consentUpdatedAt } } lineItems(first: 20) { nodes { id title sku quantity originalUnitPriceSet { shopMoney { amount currencyCode } } } pageInfo { hasNextPage } } } } ${pageInfo} } }`,
  };
}
async function shopifyApi(connection, query, variables = {}) {
  const token = credentials(connection).accessToken;
  if (!token) fail('STORE_CONNECTION_NOT_READY', 409);
  const config = shopifyConfig();
  const response = await connector.requestHttps(`https://${connection.store_domain}/admin/api/${config.version}/graphql.json`, {
    method: 'POST', shopify: true, headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  if (response.status < 200 || response.status >= 300 || response.data?.errors?.length) {
    const denied = response.data?.errors?.some(error => /access denied|permission|scope|protected customer/i.test(error.message || ''));
    fail(denied ? 'SHOPIFY_PERMISSION_REQUIRED' : 'SHOPIFY_REQUEST_FAILED', response.status === 401 ? 409 : 502);
  }
  return response.data?.data;
}
async function registerShopifyWebhooks(connection, origin) {
  const topics = ['ORDERS_CREATE','ORDERS_UPDATED','ORDERS_PAID','ORDER_TRANSACTIONS_CREATE','REFUNDS_CREATE',
    'CUSTOMERS_CREATE','CUSTOMERS_UPDATE','CUSTOMERS_DELETE','PRODUCTS_CREATE','PRODUCTS_UPDATE','PRODUCTS_DELETE','APP_UNINSTALLED'];
  const url = webhookUrl(origin, 'shopify', connection.id);
  const mutation = `mutation Create($topic: WebhookSubscriptionTopic!, $subscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $subscription) { userErrors { field message } webhookSubscription { id topic } }
  }`;
  let installed = 0;
  for (const topic of topics) {
    try {
      const data = await shopifyApi(connection, mutation, { topic, subscription: { uri: url, format: 'JSON' } });
      const result = data?.webhookSubscriptionCreate;
      if (result?.webhookSubscription || result?.userErrors?.some(item => /already|taken/i.test(item.message))) installed++;
    } catch { /* Sync remains available; the owner sees the incomplete hook setup state. */ }
  }
  return { installed, required: topics.length };
}
async function tokenExchange(shop, code, config) {
  const body = JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code });
  const response = await connector.requestHttps(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST', shopify: true, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, body,
  });
  if (response.status !== 200 || !response.data?.access_token) fail('SHOPIFY_TOKEN_EXCHANGE_FAILED', 502);
  return { accessToken: response.data.access_token, scopes: String(response.data.scope || '').split(',').map(scope => scope.trim()).filter(Boolean) };
}
function cursorState(connection) { return parseJson(connection.sync_cursor, {}); }
async function saveCursor(db, connection, cursors, errorCode = null) {
  await db.query(`UPDATE sx_retail_store_connections SET sync_cursor=?,last_sync_at=UTC_TIMESTAMP(3),last_error_code=?
    WHERE tenant_id=? AND id=?`, [JSON.stringify(cursors), errorCode, connection.tenant_id, connection.id]);
}
async function syncShopify(pool, connection) {
  const db = await pool.getConnection();
  const lock = crypto.randomUUID();
  try {
    const [result] = await db.query(`UPDATE sx_retail_store_connections SET sync_lock_token=?,sync_lock_until=UTC_TIMESTAMP(3)+INTERVAL 5 MINUTE
      WHERE tenant_id=? AND id=? AND status='active' AND (sync_lock_until IS NULL OR sync_lock_until<UTC_TIMESTAMP(3))`, [lock, connection.tenant_id, connection.id]);
    if (!result.affectedRows) fail('STORE_SYNC_ALREADY_RUNNING', 409);
  } finally { db.release(); }
  const local = cursorState(connection), next = local.shopify || {}, queries = compactShopifyQueries(), result = {};
  const mapping = { products: 'products', orders: 'orders', customers: 'customers', checkouts: 'abandonedCheckouts' };
  try {
    for (const resource of Object.keys(mapping)) {
      const previous = next[resource] || {};
      if (previous.complete) { previous.after = null; previous.complete = false; }
      const after = previous.after || null;
      try {
        const data = await shopifyApi(connection, queries[resource], { after });
        const connectionData = data?.[mapping[resource]];
        if (!connectionData) throw Object.assign(Error('SHOPIFY_SYNC_FAILED'), { code: 'SHOPIFY_SYNC_FAILED', status: 502 });
        const rows = (connectionData.edges || []).map(edge => edge.node);
        const writer = await pool.getConnection();
        try {
          await writer.beginTransaction();
          for (const row of rows) {
            if (resource === 'products') await connector.upsertProduct(writer, connection, row);
            if (resource === 'customers') await connector.upsertCustomer(writer, connection, row);
            if (resource === 'orders') {
              const customer = row.customer;
              if (customer?.id) await connector.upsertCustomer(writer, connection, customer);
              await connector.upsertOrder(writer, connection, row);
            }
            if (resource === 'checkouts') {
              if (row.customer?.id) await connector.upsertCustomer(writer, connection, row.customer);
              await upsertSafeCheckout(writer, connection, row);
            }
          }
          await writer.commit();
        } catch (error) { await writer.rollback(); throw error; } finally { writer.release(); }
        const page = connectionData.pageInfo || {};
        next[resource] = { after: page.hasNextPage ? page.endCursor : null, complete: !page.hasNextPage };
        result[resource] = { imported: rows.length, hasMore: Boolean(page.hasNextPage) };
      } catch (error) {
        const clean = cleanError(error); next[resource] = { ...previous, errorCode: clean.code };
        result[resource] = { imported: 0, hasMore: false, errorCode: clean.code };
      }
    }
    const firstError = Object.values(result).find(value => value.errorCode)?.errorCode || null;
    await pool.query(`UPDATE sx_retail_store_connections SET sync_cursor=?,last_sync_at=UTC_TIMESTAMP(3),last_error_code=?,
      sync_lock_token=NULL,sync_lock_until=NULL WHERE tenant_id=? AND id=? AND sync_lock_token=?`,
    [JSON.stringify({ ...local, shopify: next }), firstError, connection.tenant_id, connection.id, lock]);
    return { provider: 'shopify', resources: result, lastErrorCode: firstError, automaticUpdates: 'webhooks' };
  } catch (error) {
    await pool.query(`UPDATE sx_retail_store_connections SET sync_lock_token=NULL,sync_lock_until=NULL,last_error_code=?
      WHERE tenant_id=? AND id=? AND sync_lock_token=?`, [cleanError(error).code, connection.tenant_id, connection.id, lock]);
    throw error;
  }
}
function wooCredentials(connection) { const value = credentials(connection); return { key: value.consumerKey, secret: value.consumerSecret }; }
async function wooApi(connection, resource, query = {}) {
  if (!['orders','customers','products'].includes(resource)) fail('INVALID_STORE_RESOURCE', 400);
  const { key, secret } = wooCredentials(connection);
  const base = new URL(connection.store_domain);
  const apiUrl = new URL(`${base.pathname.replace(/\/$/, '')}/wp-json/wc/v3/${resource}`, base.origin);
  for (const [name, value] of Object.entries(query)) apiUrl.searchParams.set(name, String(value));
  const response = await connector.requestHttps(apiUrl.toString(), {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`, Accept: 'application/json' },
  });
  if (response.status < 200 || response.status >= 300 || !Array.isArray(response.data)) {
    fail(response.status === 401 || response.status === 403 ? 'WOOCOMMERCE_KEY_OR_PERMISSION_INVALID' : 'WOOCOMMERCE_REQUEST_FAILED', 502);
  }
  return { rows: response.data, totalPages: Math.max(1, Number(response.headers['x-wp-totalpages']) || 1) };
}
async function verifyWooConnection(base, key, secret) {
  const url = new URL(`${new URL(base).pathname.replace(/\/$/, '')}/wp-json/wc/v3/orders?per_page=1&orderby=id&order=desc`, new URL(base).origin);
  const response = await connector.requestHttps(url.toString(), { headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`, Accept: 'application/json' } });
  if (response.status !== 200 || !Array.isArray(response.data)) fail(response.status === 401 || response.status === 403 ? 'WOOCOMMERCE_KEY_OR_PERMISSION_INVALID' : 'WOOCOMMERCE_CONNECTION_FAILED', 502);
  return connection;
}
async function syncWoo(pool, connection) {
  const lock = crypto.randomUUID();
  const [locked] = await pool.query(`UPDATE sx_retail_store_connections SET sync_lock_token=?,sync_lock_until=UTC_TIMESTAMP(3)+INTERVAL 5 MINUTE
    WHERE tenant_id=? AND id=? AND status='active' AND (sync_lock_until IS NULL OR sync_lock_until<UTC_TIMESTAMP(3))`, [lock, connection.tenant_id, connection.id]);
  if (!locked.affectedRows) fail('STORE_SYNC_ALREADY_RUNNING', 409);
  const local = cursorState(connection), next = local.woocommerce || {}, result = {};
  try {
    for (const resource of ['products','orders','customers']) {
      const previous = next[resource] || {}, page = previous.complete ? 1 : Math.max(1, Number(previous.page) || 1);
      const data = await wooApi(connection, resource, { per_page: 50, page, orderby: 'id', order: 'asc' });
      const writer = await pool.getConnection();
      try {
        await writer.beginTransaction();
        for (const row of data.rows) {
          if (resource === 'products') await connector.upsertProduct(writer, connection, row);
          if (resource === 'customers') await connector.upsertCustomer(writer, connection, row);
          if (resource === 'orders') {
            if (Number(row.customer_id) > 0) await connector.upsertCustomer(writer, connection, { ...row.billing, id: row.customer_id, billing: row.billing, updated_at: row.date_modified_gmt });
            await connector.upsertOrder(writer, connection, row);
          }
        }
        await writer.commit();
      } catch (error) { await writer.rollback(); throw error; } finally { writer.release(); }
      const hasMore = page < data.totalPages;
      next[resource] = { page: hasMore ? page + 1 : 1, complete: !hasMore };
      result[resource] = { imported: data.rows.length, hasMore };
    }
    await pool.query(`UPDATE sx_retail_store_connections SET sync_cursor=?,last_sync_at=UTC_TIMESTAMP(3),last_error_code=NULL,
      sync_lock_token=NULL,sync_lock_until=NULL WHERE tenant_id=? AND id=? AND sync_lock_token=?`,
    [JSON.stringify({ ...local, woocommerce: next }), connection.tenant_id, connection.id, lock]);
    return { provider: 'woocommerce', resources: result, automaticUpdates: 'webhooks', abandonedCheckouts: 'connector_plugin_required' };
  } catch (error) {
    await pool.query(`UPDATE sx_retail_store_connections SET sync_lock_token=NULL,sync_lock_until=NULL,last_error_code=?
      WHERE tenant_id=? AND id=? AND sync_lock_token=?`, [cleanError(error).code, connection.tenant_id, connection.id, lock]);
    throw error;
  }
}

async function listConnections(pool, tenantId) {
  const [rows] = await pool.query(`SELECT c.*, (SELECT COUNT(*) FROM sx_retail_external_orders o WHERE o.tenant_id=c.tenant_id AND o.connection_id=c.id) AS orderCount,
    (SELECT COUNT(*) FROM sx_retail_external_customers u WHERE u.tenant_id=c.tenant_id AND u.connection_id=c.id AND u.customer_status='active') AS customerCount,
    (SELECT COUNT(*) FROM sx_retail_external_products p WHERE p.tenant_id=c.tenant_id AND p.connection_id=c.id AND p.product_status<>'deleted') AS productCount,
    (SELECT COUNT(*) FROM sx_retail_external_checkouts x WHERE x.tenant_id=c.tenant_id AND x.connection_id=c.id) AS checkoutCount
    FROM sx_retail_store_connections c WHERE c.tenant_id=? ORDER BY c.created_at DESC,c.id LIMIT 100`, [tenantId]);
  return rows.map(row => safeConnection({ ...row, counts: { orders: Number(row.orderCount), customers: Number(row.customerCount), products: Number(row.productCount), checkouts: Number(row.checkoutCount) } }));
}

function normalizeRecoveryUrl(connection, value) {
  if (!value) return null;
  let url; try { url = new URL(value); } catch { fail('INVALID_RECOVERY_LINK', 422); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) fail('INVALID_RECOVERY_LINK', 422);
  if (connection.provider === 'woocommerce' && url.hostname.toLowerCase() !== new URL(connection.store_domain).hostname.toLowerCase()) fail('INVALID_RECOVERY_LINK', 422);
  if (connection.provider === 'shopify') {
    // Shopify can return the store's verified public storefront domain, which
    // may be a custom domain instead of *.myshopify.com. We never fetch this
    // URL server-side; validate it as a public HTTPS link before owner reveal.
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const labels = host.split('.');
    if (net.isIP(host) || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
        ['localhost','local','internal','test','invalid','example','home','lan','onion'].some(suffix => host === suffix || host.endsWith(`.${suffix}`))) {
      fail('INVALID_RECOVERY_LINK', 422);
    }
  }
  return url.toString();
}
async function upsertSafeCheckout(db, connection, row) {
  const recoveryUrl = normalizeRecoveryUrl(connection, row.recoveryUrl || row.abandonedCheckoutUrl || row.abandoned_checkout_url);
  return connector.upsertCheckout(db, connection, { ...row, recoveryUrl });
}
async function connectionData(pool, connection, kind, pageValue) {
  if (!['orders','customers','products','checkouts'].includes(kind)) fail('INVALID_STORE_RESOURCE', 400);
  const page = Number(pageValue || 1); if (!Number.isSafeInteger(page) || page < 1 || page > 200) fail('INVALID_PAGE', 400);
  const limit = 50, offset = (page - 1) * limit, { tenant_id: tenantId, id } = connection;
  if (kind === 'orders') {
    const [rows] = await pool.query(`SELECT external_order_id AS id,order_number AS orderNumber,order_status AS orderStatus,
      financial_status AS financialStatus,currency,total_amount AS totalAmount,customer_external_id AS customerId,
      contact_consent AS contactConsent,customer_ciphertext AS customerCiphertext,customer_iv AS customerIv,
      customer_auth_tag AS customerAuthTag,order_ciphertext AS ciphertext,order_iv AS iv,order_auth_tag AS authTag,
      source_updated_at AS sourceUpdatedAt FROM sx_retail_external_orders WHERE tenant_id=? AND connection_id=?
      ORDER BY source_updated_at DESC,external_order_id DESC LIMIT ? OFFSET ?`, [tenantId, id, limit + 1, offset]);
    const [transactions] = rows.length ? await pool.query(`SELECT external_order_id AS orderId,transaction_kind AS kind,transaction_status AS status,
      currency,amount,gateway,processed_at AS processedAt FROM sx_retail_external_transactions
      WHERE tenant_id=? AND connection_id=? AND external_order_id IN (${rows.map(() => '?').join(',')}) ORDER BY processed_at DESC`,
    [tenantId, id, ...rows.map(row => row.id)]) : [[]];
    const byOrder = new Map(); for (const tx of transactions) { if (!byOrder.has(tx.orderId)) byOrder.set(tx.orderId, []); byOrder.get(tx.orderId).push(tx); }
    return rows.map(row => {
      const snapshot = jsonFromEncrypted(row, tenantId, id, `order:${row.id}`), customer = row.customerCiphertext ?
        jsonFromEncrypted({ ciphertext: row.customerCiphertext, iv: row.customerIv, authTag: row.customerAuthTag }, tenantId, id, `order-customer:${row.id}`) : null;
      return { id: row.id, number: row.orderNumber, status: row.orderStatus, financialStatus: row.financialStatus,
        currency: row.currency, total: String(row.totalAmount), customer: customer && { name: [customer.firstName, customer.lastName].filter(Boolean).join(' '), email: customer.email, phone: customer.phone },
        contactConsent: row.contactConsent, lineItems: (snapshot.lineItems || []).slice(0, 100).map(line => ({
          name: String(line.title || line.name || line.product_title || '').slice(0, 200), sku: String(line.sku || '').slice(0, 100), quantity: Number(line.quantity) || 0,
        })), lineItemsTruncated: Boolean(snapshot.lineItemsTruncated), transactionsTruncated: Boolean(snapshot.transactionsTruncated),
        transactions: (byOrder.get(row.id) || []).map(tx => ({ kind: tx.kind, status: tx.status, currency: tx.currency,
          amount: String(tx.amount), gateway: tx.gateway, processedAt: tx.processedAt })), updatedAt: row.sourceUpdatedAt };
    });
  }
  if (kind === 'customers') {
    const [rows] = await pool.query(`SELECT external_customer_id AS id,customer_ciphertext AS ciphertext,customer_iv AS iv,customer_auth_tag AS authTag,
      source_updated_at AS updatedAt FROM sx_retail_external_customers WHERE tenant_id=? AND connection_id=? AND customer_status='active'
      ORDER BY source_updated_at DESC,external_customer_id DESC LIMIT ? OFFSET ?`, [tenantId, id, limit + 1, offset]);
    return rows.map(row => { const customer = jsonFromEncrypted(row, tenantId, id, `customer:${row.id}`); return { id: row.id,
      name: [customer.firstName, customer.lastName].filter(Boolean).join(' '), email: customer.email, phone: customer.phone,
      marketingConsent: customer.marketingConsent, updatedAt: row.updatedAt }; });
  }
  if (kind === 'products') {
    const [rows] = await pool.query(`SELECT external_product_id AS id,product_status AS status,currency,price,product_ciphertext AS ciphertext,
      product_iv AS iv,product_auth_tag AS authTag,source_updated_at AS updatedAt FROM sx_retail_external_products
      WHERE tenant_id=? AND connection_id=? AND product_status<>'deleted' ORDER BY source_updated_at DESC,external_product_id DESC LIMIT ? OFFSET ?`,
    [tenantId, id, limit + 1, offset]);
    return rows.map(row => { const product = jsonFromEncrypted(row, tenantId, id, `product:${row.id}`); return {
      id: row.id, title: product.title, sku: product.sku, status: row.status, currency: row.currency, price: String(row.price), imageUrl: product.imageUrl || null,
      variants: (product.variants || []).slice(0, 20).map(variant => ({ title: String(variant.title || variant.name || 'Default').slice(0, 100),
        sku: String(variant.sku || '').slice(0, 100), price: String(variant.price ?? '') })),
      variantsTruncated: Boolean(product.variantsTruncated), updatedAt: row.updatedAt,
    }; });
  }
  const [rows] = await pool.query(`SELECT external_checkout_id AS id,checkout_status AS status,currency,total_amount AS totalAmount,
    contact_consent AS contactConsent,customer_ciphertext AS customerCiphertext,customer_iv AS customerIv,customer_auth_tag AS customerAuthTag,
    checkout_ciphertext AS ciphertext,checkout_iv AS iv,checkout_auth_tag AS authTag,source_updated_at AS updatedAt
    FROM sx_retail_external_checkouts WHERE tenant_id=? AND connection_id=? ORDER BY source_updated_at DESC,external_checkout_id DESC LIMIT ? OFFSET ?`,
  [tenantId, id, limit + 1, offset]);
  return rows.map(row => {
    const checkout = jsonFromEncrypted(row, tenantId, id, `checkout:${row.id}`), customer = row.customerCiphertext ?
      jsonFromEncrypted({ ciphertext: row.customerCiphertext, iv: row.customerIv, authTag: row.customerAuthTag }, tenantId, id, `checkout-customer:${row.id}`) : null;
    return { id: row.id, status: row.status, currency: row.currency, total: String(row.totalAmount),
      customer: customer && { name: [customer.firstName, customer.lastName].filter(Boolean).join(' '), email: customer.email, phone: customer.phone },
      contactConsent: row.contactConsent, lineItems: (checkout.lineItems || []).slice(0, 50).map(line => ({ name: String(line.title || line.name || '').slice(0, 200), quantity: Number(line.quantity) || 0 })),
      lineItemsTruncated: Boolean(checkout.lineItemsTruncated), canRevealRecoveryLink: Boolean(row.status === 'abandoned'), updatedAt: row.updatedAt };
  });
}
async function processWebhook(pool, connection, event) {
  const sourceEventId = event.eventId ? String(event.eventId).slice(0, 300) : crypto.createHash('sha256').update(event.raw).digest('hex');
  const providerEventId = crypto.createHash('sha256').update(event.topic).update('\0').update(sourceEventId).digest('hex');
  const parsed = JSON.parse(event.raw.toString('utf8'));
  const resourceType = String(event.resource || event.topic.split(/[/.]/)[0] || 'unknown').toLowerCase().slice(0, 32);
  const externalId = String(parsed?.id ?? parsed?.customer?.id ?? parsed?.shop_id ?? 'unknown').slice(0, 191);
  const encrypted = connector.seal(event.raw, connection.tenant_id, connection.id, `event:${providerEventId}`);
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [insert] = await db.query(`INSERT IGNORE INTO sx_retail_external_events
      (tenant_id,connection_id,provider_event_id,topic,resource_type,external_id,payload_ciphertext,payload_iv,payload_auth_tag,status,attempt_count)
      VALUES (?,?,?,?,?,?,?,?,?,'received',0)`, [connection.tenant_id, connection.id, providerEventId, event.topic.slice(0, 100), resourceType,
      externalId, encrypted.ciphertext, encrypted.iv, encrypted.authTag]);
    const [[record]] = await db.query(`SELECT id,status FROM sx_retail_external_events
      WHERE connection_id=? AND provider_event_id=? FOR UPDATE`, [connection.id, providerEventId]);
    if (record.status === 'processed') { await db.commit(); return { duplicate: true }; }
    await db.query(`UPDATE sx_retail_external_events SET status='received',payload_ciphertext=?,payload_iv=?,payload_auth_tag=?,
      error_code=NULL,attempt_count=attempt_count+1 WHERE id=?`, [encrypted.ciphertext, encrypted.iv, encrypted.authTag, record.id]);
    const topic = event.topic.toLowerCase();
    if (topic.includes('app/uninstalled')) {
      await db.query(`UPDATE sx_retail_store_connections SET status='revoked',credentials_ciphertext=NULL,credentials_iv=NULL,
        credentials_auth_tag=NULL,last_error_code='SHOPIFY_APP_UNINSTALLED' WHERE tenant_id=? AND id=?`, [connection.tenant_id, connection.id]);
    } else if (topic.includes('shop/redact')) {
      await connector.eraseConnectionData(db, connection);
      await db.query(`UPDATE sx_retail_store_connections SET status='revoked',credentials_ciphertext=NULL,credentials_iv=NULL,
        credentials_auth_tag=NULL,last_error_code='SHOPIFY_SHOP_REDACTED' WHERE tenant_id=? AND id=?`, [connection.tenant_id, connection.id]);
    } else if (topic.includes('customers/data_request')) {
      const requestPayload = connector.seal(event.raw, connection.tenant_id, connection.id, `privacy:${providerEventId}`);
      await db.query(`INSERT IGNORE INTO sx_retail_store_privacy_requests(id,tenant_id,connection_id,provider_request_id,request_kind,
        request_payload_ciphertext,request_payload_iv,request_payload_auth_tag,status)
        VALUES (?,?,?,?,'customer_data',?,?,?,'received')`, [crypto.randomUUID(), connection.tenant_id, connection.id, providerEventId,
        requestPayload.ciphertext, requestPayload.iv, requestPayload.authTag]);
    } else if (topic.includes('customers/redact') || /customer\.deleted|customers\/delete/.test(topic)) {
      const rawCustomerId = parsed?.customer?.id ?? parsed?.id ?? '';
      const customerId = connection.provider === 'shopify' ? connector.canonicalShopifyId('Customer', rawCustomerId) : String(rawCustomerId);
      if (customerId) await connector.redactCustomer(db, connection, customerId);
    } else if (resourceType === 'order_transactions' || topic.includes('order_transactions')) {
      const orderId = parsed?.order_id || parsed?.orderId;
      if (!orderId) fail('INVALID_PROVIDER_TRANSACTION', 422);
      await connector.upsertTransaction(db, connection, orderId, parsed);
    } else if (topic.includes('refunds/create')) {
      const orderId = parsed?.order_id || parsed?.orderId;
      const transactions = parsed?.transactions || [];
      if (transactions.length) {
        if (!orderId) fail('INVALID_PROVIDER_TRANSACTION', 422);
        for (const transaction of transactions) await connector.upsertTransaction(db, connection, orderId, { ...transaction, kind: 'refund' });
      } else if (orderId && parsed?.id && parsed?.totalRefundedSet?.shopMoney?.amount != null) {
        await connector.upsertTransaction(db, connection, orderId, { id: `refund:${parsed.id}`, kind: 'refund', status: 'recorded_by_store',
          amount: parsed.totalRefundedSet.shopMoney.amount, currency: parsed.totalRefundedSet.shopMoney.currencyCode,
          processed_at: parsed.createdAt, gateway: 'unknown' });
      }
    } else if (/^orders?[/.](create|created|updated|update|paid|cancelled)$/.test(topic) || resourceType === 'order' || resourceType === 'orders') {
      const customer = parsed?.customer;
      if (customer?.id) await connector.upsertCustomer(db, connection, customer);
      if (connection.provider === 'woocommerce' && Number(parsed?.customer_id) > 0) {
        await connector.upsertCustomer(db, connection, { ...parsed.billing, id: parsed.customer_id, billing: parsed.billing, updated_at: parsed.date_modified_gmt });
      }
      await connector.upsertOrder(db, connection, parsed);
    } else if (topic.includes('customer') || resourceType === 'customer' || resourceType === 'customers') {
      if (/delete|redact/.test(topic)) await connector.redactCustomer(db, connection, String(parsed?.id || ''));
      else await connector.upsertCustomer(db, connection, parsed);
    } else if (topic.includes('product') || resourceType === 'product' || resourceType === 'products') {
      if (/delete/.test(topic)) await db.query(`UPDATE sx_retail_external_products SET product_status='deleted'
        WHERE tenant_id=? AND connection_id=? AND external_product_id=?`, [connection.tenant_id, connection.id,
          connection.provider === 'shopify' ? connector.canonicalShopifyId('Product', externalId) : externalId]);
      else await connector.upsertProduct(db, connection, parsed);
    } else if (topic.includes('checkout') || resourceType === 'checkout' || parsed?.type?.startsWith('checkout.')) {
      const checkout = parsed?.data || parsed?.checkout || parsed;
      if (parsed?.type === 'checkout.started') checkout.status = 'started';
      if (parsed?.type === 'checkout.abandoned') checkout.status = 'abandoned';
      if (parsed?.type === 'checkout.recovered') checkout.status = 'recovered';
      await upsertSafeCheckout(db, connection, checkout);
    } else {
      fail('UNSUPPORTED_WEBHOOK_RESOURCE', 400);
    }
    await db.query(`UPDATE sx_retail_external_events SET status='processed',payload_ciphertext=NULL,payload_iv=NULL,payload_auth_tag=NULL,
      processed_at=UTC_TIMESTAMP(3) WHERE id=?`, [record.id]);
    await db.commit();
    return { duplicate: !insert.affectedRows };
  } catch (error) {
    await db.rollback();
    const errorCode = cleanError(error).code;
    // Keep only delivery metadata for failures. Providers retry signed events;
    // retaining raw customer payloads after a failed attempt is unnecessary.
    await pool.query(`INSERT INTO sx_retail_external_events
      (tenant_id,connection_id,provider_event_id,topic,resource_type,external_id,status,attempt_count,error_code)
      VALUES (?,?,?,?,?,?,'failed',1,?) ON DUPLICATE KEY UPDATE
      status=IF(status='processed',status,'failed'),
      attempt_count=IF(status='processed',attempt_count,attempt_count+1),
      error_code=IF(status='processed',error_code,VALUES(error_code)),
      payload_ciphertext=NULL,payload_iv=NULL,payload_auth_tag=NULL`,
    [connection.tenant_id, connection.id, providerEventId, event.topic.slice(0, 100), resourceType, externalId, errorCode]).catch(() => {});
    throw error;
  } finally { db.release(); }
}
async function webhookConnection(pool, provider, id) {
  if (!connector.validateId(id)) fail('WEBHOOK_NOT_FOUND', 404);
  const [[connection]] = await pool.query(`SELECT * FROM sx_retail_store_connections WHERE id=? AND provider=?`, [id, provider]);
  return connection || null;
}

function workspaceRouter({ pool, authenticate, origin }) {
  const router = express.Router();
  const owner = fn => handle(async (req, res) => {
    const context = req.businessContext;
    if (!decision(context, { capability: 'retail.commerce', permission: 'retail.connect' }).allowed) return res.sendStatus(403);
    return fn(req, res, context);
  });
  router.use(noStore, authenticate, express.json({ limit: '16kb' }));
  router.use((req, res, next) => ['POST','PUT','DELETE'].includes(req.method) ? originGuard(origin)(req, res, next) : next());

  router.get('/', owner(async (req, res, context) => reply(res, { connections: await listConnections(pool, context.tenant.id) })));
  router.post('/shopify/start', owner(async (req, res, context) => {
    const config = shopifyConfig();
    const shop = connector.normalizeShop(req.body?.shop);
    if (Object.keys(req.body || {}).some(key => !['shop','currency'].includes(key))) fail('INVALID_STORE_CONNECTION', 400);
    const defaultCurrency = connector.currency(req.body.currency || context.tenant.currency || 'QAR');
    const apiOrigin = publicOrigin(origin), callback = `${apiOrigin}/api/retail-connectors/shopify/callback`;
    const [[storeOwner]] = await pool.query(`SELECT tenant_id FROM sx_retail_store_connections
      WHERE provider='shopify' AND store_domain=? LIMIT 1`, [shop]);
    if (storeOwner && storeOwner.tenant_id !== context.tenant.id) fail('STORE_CONNECTION_EXISTS', 409);
    const [existingRows] = await pool.query(`SELECT id,status FROM sx_retail_store_connections
      WHERE tenant_id=? AND provider='shopify' AND store_domain=? LIMIT 1`, [context.tenant.id, shop]);
    let id;
    if (existingRows[0]) {
      id = existingRows[0].id;
      if (['active','paused'].includes(existingRows[0].status)) fail('STORE_CONNECTION_EXISTS', 409);
      await pool.query(`UPDATE sx_retail_store_connections SET status='pending',default_currency=?,credentials_ciphertext=NULL,credentials_iv=NULL,
        credentials_auth_tag=NULL,last_error_code=NULL,created_by_identity_id=? WHERE tenant_id=? AND id=?`, [defaultCurrency, context.identity.id, context.tenant.id, id]);
    } else {
      id = crypto.randomUUID();
      await pool.query(`INSERT INTO sx_retail_store_connections(id,tenant_id,provider,store_domain,display_name,default_currency,status,scopes,
        created_by_identity_id) VALUES (?,?,'shopify',?,?,?,'pending',JSON_ARRAY(),?)`,
      [id, context.tenant.id, shop, shop.split('.')[0], defaultCurrency, context.identity.id]);
    }
    const state = connector.randomSecret(), stateHash = crypto.createHash('sha256').update(state).digest();
    await pool.query(`INSERT INTO sx_retail_store_oauth_states(state_hash,tenant_id,connection_id,identity_id,provider,expires_at)
      VALUES (?,?,?,?,'shopify',UTC_TIMESTAMP(3)+INTERVAL 10 MINUTE)`, [stateHash, context.tenant.id, id, context.identity.id]);
    const authorize = new URL(`https://${shop}/admin/oauth/authorize`);
    authorize.searchParams.set('client_id', config.clientId);
    authorize.searchParams.set('scope', ['read_products','read_orders','read_customers',...(config.readAllOrders ? ['read_all_orders'] : [])].join(','));
    authorize.searchParams.set('redirect_uri', callback);
    authorize.searchParams.set('state', state);
    await pool.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?, ?, ?, 'identity', 'retail.store-connect-started', 'retail-store-connection', ?, ?, ?)`,
    [crypto.randomUUID(), context.tenant.id, context.identity.id, id, JSON.stringify({ provider: 'shopify' }), crypto.randomUUID()]);
    reply(res, { authorizationUrl: authorize.toString() });
  }));

  router.post('/woocommerce', owner(async (req, res, context) => {
    const body = req.body || {};
    if (Object.keys(body).some(key => !['storeUrl','displayName','currency','consumerKey','consumerSecret'].includes(key))) fail('INVALID_STORE_CONNECTION', 400);
    const storeUrl = connector.normalizeWooUrl(body.storeUrl), consumerKey = body.consumerKey, consumerSecret = body.consumerSecret;
    if (typeof consumerKey !== 'string' || !/^ck_[A-Za-z0-9]{32,64}$/.test(consumerKey) || typeof consumerSecret !== 'string' || !/^cs_[A-Za-z0-9]{32,64}$/.test(consumerSecret)) fail('INVALID_WOOCOMMERCE_CREDENTIALS', 400);
    const currency = connector.currency(body.currency || context.tenant.currency || 'QAR');
    const displayName = String(body.displayName || new URL(storeUrl).hostname).trim().slice(0, 160);
    if (!displayName) fail('INVALID_STORE_NAME', 400);
    await verifyWooConnection(storeUrl, consumerKey, consumerSecret);
    const db = await pool.getConnection(), webhookSecret = connector.randomSecret();
    let id, reconnected = false;
    try {
      await db.beginTransaction();
      const [[existing]] = await db.query(`SELECT id,tenant_id,status FROM sx_retail_store_connections
        WHERE provider='woocommerce' AND store_domain=? FOR UPDATE`, [storeUrl]);
      if (existing && existing.tenant_id !== context.tenant.id || existing && ['active','paused','pending'].includes(existing.status)) fail('STORE_CONNECTION_EXISTS', 409);
      id = existing?.id || crypto.randomUUID();
      reconnected = Boolean(existing);
      const encryptedCredentials = connector.seal({ consumerKey, consumerSecret }, context.tenant.id, id, 'credentials');
      const encryptedWebhook = connector.seal(Buffer.from(webhookSecret), context.tenant.id, id, 'webhook-secret');
      if (existing) {
        await db.query(`UPDATE sx_retail_store_connections SET display_name=?,default_currency=?,status='active',scopes=JSON_ARRAY('read_products','read_orders','read_customers'),
          credentials_ciphertext=?,credentials_iv=?,credentials_auth_tag=?,webhook_secret_ciphertext=?,webhook_secret_iv=?,webhook_secret_auth_tag=?,
          sync_cursor=NULL,sync_lock_token=NULL,sync_lock_until=NULL,last_error_code=NULL,created_by_identity_id=? WHERE tenant_id=? AND id=?`,
        [displayName, currency, encryptedCredentials.ciphertext, encryptedCredentials.iv, encryptedCredentials.authTag,
          encryptedWebhook.ciphertext, encryptedWebhook.iv, encryptedWebhook.authTag, context.identity.id, context.tenant.id, id]);
      } else {
        await db.query(`INSERT INTO sx_retail_store_connections(id,tenant_id,provider,store_domain,display_name,default_currency,status,scopes,
          credentials_ciphertext,credentials_iv,credentials_auth_tag,webhook_secret_ciphertext,webhook_secret_iv,webhook_secret_auth_tag,created_by_identity_id)
          VALUES (?,?,'woocommerce',?,?,?,'active',JSON_ARRAY('read_products','read_orders','read_customers'),?,?,?,?,?,?,?)`,
        [id, context.tenant.id, storeUrl, displayName, currency, encryptedCredentials.ciphertext, encryptedCredentials.iv, encryptedCredentials.authTag,
          encryptedWebhook.ciphertext, encryptedWebhook.iv, encryptedWebhook.authTag, context.identity.id]);
      }
      await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
        VALUES (?, ?, ?, 'identity', ?, 'retail-store-connection', ?, ?, ?)`,
      [crypto.randomUUID(), context.tenant.id, context.identity.id, reconnected ? 'retail.store-reconnected' : 'retail.store-connected', id,
        JSON.stringify({ provider: 'woocommerce' }), crypto.randomUUID()]);
      await db.commit();
    } catch (error) { try { await db.rollback(); } catch {} throw error; } finally { db.release(); }
    reply(res, { connection: { id, provider: 'woocommerce', storeDomain: storeUrl, displayName, currency, status: 'active' },
      webhookSecret, webhookUrl: webhookUrl(publicOrigin(origin), 'woocommerce', id) });
  }));

  router.get('/:id/webhook-setup', owner(async (req, res, context) => {
    const connection = await loadConnection(pool, context.tenant.id, req.params.id);
    if (connection.status === 'pending') fail('STORE_CONNECTION_NOT_READY', 409);
    const setup = { provider: connection.provider, webhookUrl: webhookUrl(publicOrigin(origin), connection.provider, connection.id),
      topics: connection.provider === 'woocommerce' ? ['order.created','order.updated','customer.created','customer.updated','product.created','product.updated','product.deleted'] :
        ['orders/create','orders/updated','orders/paid','order_transactions/create','refunds/create','customers/create','customers/update','customers/delete','products/create','products/update','products/delete','app/uninstalled'] };
    if (connection.provider === 'shopify') setup.complianceWebhookUrl = `${publicOrigin(origin)}/api/retail-connectors/shopify`;
    if (connection.provider === 'woocommerce' && connection.webhook_secret_ciphertext) {
      setup.webhookSecret = connector.open({ ciphertext: connection.webhook_secret_ciphertext, iv: connection.webhook_secret_iv,
        authTag: connection.webhook_secret_auth_tag }, connection.tenant_id, connection.id, 'webhook-secret').toString('utf8');
      setup.abandonedCheckoutPlugin = `${publicOrigin(origin)}/api/retail-connectors/woocommerce-plugin`;
    }
    reply(res, setup);
  }));

  router.post('/:id/sync', owner(async (req, res, context) => {
    if (Object.keys(req.body || {}).length) fail('INVALID_STORE_SYNC', 400);
    const connection = await loadConnection(pool, context.tenant.id, req.params.id);
    if (connection.status !== 'active') fail('STORE_CONNECTION_NOT_ACTIVE', 409);
    const result = connection.provider === 'shopify' ? await syncShopify(pool, connection) : await syncWoo(pool, connection);
    await pool.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?, ?, ?, 'identity', 'retail.store-sync-requested', 'retail-store-connection', ?, ?, ?)`,
    [crypto.randomUUID(), context.tenant.id, context.identity.id, connection.id, JSON.stringify({ provider: connection.provider,
      resources: Object.fromEntries(Object.entries(result.resources || {}).map(([key, value]) => [key, value.imported || 0])) }), crypto.randomUUID()]);
    reply(res, result);
  }));

  router.get('/:id/data/:kind', owner(async (req, res, context) => {
    const connection = await loadConnection(pool, context.tenant.id, req.params.id);
    if (connection.status === 'pending') fail('STORE_CONNECTION_NOT_READY', 409);
    const page = Number(req.query.page || 1), rows = await connectionData(pool, connection, req.params.kind, page);
    reply(res, { items: rows.slice(0, 50), page, hasMore: rows.length > 50 });
  }));

  router.get('/:id/recovery-link', owner(async (req, res, context) => {
    const connection = await loadConnection(pool, context.tenant.id, req.params.id), checkoutId = String(req.query.checkoutId || '');
    if (!checkoutId || checkoutId.length > 191) fail('CHECKOUT_NOT_FOUND', 404);
    const [[row]] = await pool.query(`SELECT recovery_ciphertext AS ciphertext,recovery_iv AS iv,recovery_auth_tag AS authTag
      FROM sx_retail_external_checkouts WHERE tenant_id=? AND connection_id=? AND external_checkout_id=? AND checkout_status='abandoned'`,
    [connection.tenant_id, connection.id, checkoutId]);
    if (!row?.ciphertext) fail('RECOVERY_LINK_UNAVAILABLE', 404);
    const url = connector.open(row, connection.tenant_id, connection.id, `recovery:${checkoutId}`).toString('utf8');
    res.set('Referrer-Policy', 'no-referrer');
    reply(res, { url });
  }));

  router.get('/:id/privacy-requests', owner(async (req, res, context) => {
    const connection = await loadConnection(pool, context.tenant.id, req.params.id);
    const [rows] = await pool.query(`SELECT id,request_kind AS kind,status,received_at AS receivedAt,prepared_at AS preparedAt,completed_at AS completedAt
      FROM sx_retail_store_privacy_requests WHERE tenant_id=? AND connection_id=? ORDER BY received_at DESC,id LIMIT 100`, [context.tenant.id, connection.id]);
    reply(res, rows);
  }));

  router.get('/:id/privacy-requests/:requestId/export', owner(async (req, res, context) => {
    const connection = await loadConnection(pool, context.tenant.id, req.params.id);
    if (!connector.validateId(req.params.requestId)) fail('PRIVACY_REQUEST_NOT_FOUND', 404);
    const [[request]] = await pool.query(`SELECT provider_request_id AS providerRequestId,request_payload_ciphertext AS ciphertext,
      request_payload_iv AS iv,request_payload_auth_tag AS authTag,status FROM sx_retail_store_privacy_requests
      WHERE tenant_id=? AND connection_id=? AND id=? AND request_kind='customer_data'`, [context.tenant.id, connection.id, req.params.requestId]);
    if (!request?.ciphertext || request.status === 'cancelled') fail('PRIVACY_REQUEST_NOT_FOUND', 404);
    const payload = JSON.parse(connector.open(request, context.tenant.id, connection.id, `privacy:${request.providerRequestId}`).toString('utf8'));
    const rawCustomerId = payload.customer?.id || payload.id;
    const customerId = connection.provider === 'shopify' ? connector.canonicalShopifyId('Customer', rawCustomerId) : String(rawCustomerId || '');
    if (!customerId) fail('PRIVACY_REQUEST_NOT_FOUND', 404);
    const [customerRows] = await pool.query(`SELECT customer_ciphertext AS ciphertext,customer_iv AS iv,customer_auth_tag AS authTag
      FROM sx_retail_external_customers WHERE tenant_id=? AND connection_id=? AND external_customer_id=? AND customer_status='active'`,
    [context.tenant.id, connection.id, customerId]);
    const customer = customerRows[0] ? connector.openJson(customerRows[0], context.tenant.id, connection.id, `customer:${customerId}`) : null;
    const orderRows = await privacyRows(pool, `SELECT external_order_id AS id,order_ciphertext AS ciphertext,order_iv AS iv,order_auth_tag AS authTag,
      order_status AS status,financial_status AS financialStatus,currency,total_amount AS total FROM sx_retail_external_orders
      WHERE tenant_id=? AND connection_id=? AND customer_external_id=? ORDER BY source_updated_at DESC`, [context.tenant.id, connection.id, customerId]);
    const orders = orderRows.map(row => {
      const snapshot = connector.openJson(row, context.tenant.id, connection.id, `order:${row.id}`);
      delete snapshot.customer; delete snapshot.billing; delete snapshot.shipping;
      return { id: row.id, status: row.status, financialStatus: row.financialStatus, currency: row.currency, total: String(row.total), details: snapshot };
    });
    const checkoutRows = await privacyRows(pool, `SELECT external_checkout_id AS id,checkout_ciphertext AS ciphertext,checkout_iv AS iv,checkout_auth_tag AS authTag,
      checkout_status AS status,currency,total_amount AS total FROM sx_retail_external_checkouts
      WHERE tenant_id=? AND connection_id=? AND customer_external_id=? ORDER BY source_updated_at DESC`, [context.tenant.id, connection.id, customerId]);
    const checkouts = checkoutRows.map(row => { const snapshot = connector.openJson(row, context.tenant.id, connection.id, `checkout:${row.id}`);
      delete snapshot.customer; delete snapshot.recoveryUrl; return { id: row.id, status: row.status, currency: row.currency, total: String(row.total), details: snapshot }; });
    const packageData = { provider: connection.provider, store: connection.storeDomain, exportedAt: new Date().toISOString(), customer, orders, checkouts,
      note: 'This package contains only data imported and currently held by 7Network for this connected store.' };
    await pool.query(`UPDATE sx_retail_store_privacy_requests SET status='prepared',prepared_at=COALESCE(prepared_at,UTC_TIMESTAMP(3))
      WHERE tenant_id=? AND connection_id=? AND id=? AND status='received'`, [context.tenant.id, connection.id, req.params.requestId]);
    await pool.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?, ?, ?, 'identity', 'retail.store-privacy-exported', 'retail-store-privacy-request', ?, ?, ?)`,
    [crypto.randomUUID(), context.tenant.id, context.identity.id, req.params.requestId,
      JSON.stringify({ provider: connection.provider, records: { orders: orders.length, checkouts: checkouts.length } }), crypto.randomUUID()]);
    res.set('Content-Type','application/json; charset=utf-8').set('Content-Disposition',`attachment; filename="7network-privacy-request-${req.params.requestId}.json"`);
    res.send(JSON.stringify(packageData));
  }));

  router.post('/:id/privacy-requests/:requestId/complete', owner(async (req, res, context) => {
    const connection = await loadConnection(pool, context.tenant.id, req.params.id);
    if (req.body?.confirmed !== true || Object.keys(req.body || {}).some(key => key !== 'confirmed')) fail('PRIVACY_RESPONSE_CONFIRMATION_REQUIRED', 400);
    const [updated] = await pool.query(`UPDATE sx_retail_store_privacy_requests SET status='completed',completed_at=UTC_TIMESTAMP(3),
      request_payload_ciphertext=NULL,request_payload_iv=NULL,request_payload_auth_tag=NULL
      WHERE tenant_id=? AND connection_id=? AND id=? AND status='prepared'`, [context.tenant.id, connection.id, req.params.requestId]);
    if (!updated.affectedRows) fail('PRIVACY_REQUEST_NOT_READY', 409);
    reply(res, { id: req.params.requestId, status: 'completed' });
  }));

  router.put('/:id/status', owner(async (req, res, context) => {
    const status = req.body?.status;
    if (!['active','paused'].includes(status) || Object.keys(req.body || {}).some(key => key !== 'status')) fail('INVALID_STORE_STATUS', 400);
    const connection = await loadConnection(pool, context.tenant.id, req.params.id);
    if (connection.status === 'revoked' || connection.status === 'pending' || !connection.credentials_ciphertext) fail('STORE_CONNECTION_NOT_READY', 409);
    await pool.query(`UPDATE sx_retail_store_connections SET status=?,last_error_code=NULL WHERE tenant_id=? AND id=?`, [status, context.tenant.id, connection.id]);
    await pool.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?, ?, ?, 'identity', 'retail.store-status-changed', 'retail-store-connection', ?, ?, ?)`,
    [crypto.randomUUID(), context.tenant.id, context.identity.id, connection.id, JSON.stringify({ provider: connection.provider, status }), crypto.randomUUID()]);
    reply(res, { id: connection.id, status });
  }));

  router.delete('/:id', owner(async (req, res, context) => {
    if (Object.keys(req.body || {}).length) fail('INVALID_STORE_DISCONNECT', 400);
    const connection = await loadConnection(pool, context.tenant.id, req.params.id);
    await pool.query(`UPDATE sx_retail_store_connections SET status='revoked',credentials_ciphertext=NULL,credentials_iv=NULL,
      credentials_auth_tag=NULL,webhook_secret_ciphertext=NULL,webhook_secret_iv=NULL,webhook_secret_auth_tag=NULL,
      sync_lock_token=NULL,sync_lock_until=NULL,last_error_code='DISCONNECTED_BY_OWNER' WHERE tenant_id=? AND id=?`,
    [context.tenant.id, connection.id]);
    await pool.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?, ?, ?, 'identity', 'retail.store-disconnected', 'retail-store-connection', ?, ?, ?)`,
    [crypto.randomUUID(), context.tenant.id, context.identity.id, connection.id, JSON.stringify({ provider: connection.provider }), crypto.randomUUID()]);
    reply(res, { id: connection.id, status: 'revoked', importedDataRetained: true });
  }));

  router.post('/:id/erase-imported-data', owner(async (req, res, context) => {
    const connection = await loadConnection(pool, context.tenant.id, req.params.id);
    if (connection.status !== 'revoked' || req.body?.confirmStoreDomain !== connection.store_domain ||
        Object.keys(req.body || {}).some(key => key !== 'confirmStoreDomain')) fail('STORE_DATA_ERASURE_CONFIRMATION_REQUIRED', 409);
    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      for (const table of ['sx_retail_external_transactions','sx_retail_external_orders','sx_retail_external_checkouts',
        'sx_retail_external_customers','sx_retail_external_products','sx_retail_external_events','sx_retail_store_privacy_requests']) {
        await db.query(`DELETE FROM ${table} WHERE tenant_id=? AND connection_id=?`, [context.tenant.id, connection.id]);
      }
      await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
        VALUES (?, ?, ?, 'identity', 'retail.store-imported-data-erased', 'retail-store-connection', ?, ?, ?)`,
      [crypto.randomUUID(), context.tenant.id, context.identity.id, connection.id,
        JSON.stringify({ provider: connection.provider, storeDomain: connection.store_domain }), crypto.randomUUID()]);
      await db.commit();
    } catch (error) { try { await db.rollback(); } catch {} throw error; } finally { db.release(); }
    reply(res, { id: connection.id, importedDataRetained: false, connectionMetadataRetained: true });
  }));

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, code: 'STORE_CONNECTION_EXISTS' });
    const clean = cleanError(error);
    if (clean.status >= 400 && clean.status < 500) return res.status(clean.status).json({ success: false, code: clean.code });
    if (error.code && /^[A-Z0-9_]{1,64}$/.test(error.code)) return res.status(clean.status).json({ success: false, code: clean.code });
    return next(error);
  });
  return router;
}

async function callbackShopify(pool, req, res, origin) {
  let connectionId = null;
  try {
    const config = shopifyConfig(), context = req.businessContext;
    if (!decision(context, { capability: 'retail.commerce', permission: 'retail.connect' }).allowed) return res.sendStatus(403);
    if (req.query.error) return res.redirect(303, '/user?page=retail-connected-stores&connectionError=SHOPIFY_INSTALL_CANCELLED');
    const shop = connector.normalizeShop(req.query.shop), state = req.query.state, timestamp = Number(req.query.timestamp);
    if (typeof state !== 'string' || state.length < 32 || state.length > 128 || !connector.shopifyQuerySignature(req.query, config.clientSecret) ||
        !Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) fail('SHOPIFY_CALLBACK_INVALID', 400);
    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      const hash = crypto.createHash('sha256').update(state).digest();
      const [[record]] = await db.query(`SELECT tenant_id AS tenantId,connection_id AS connectionId,identity_id AS identityId
        FROM sx_retail_store_oauth_states WHERE state_hash=? AND provider='shopify' AND consumed_at IS NULL AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE`, [hash]);
      if (!record || record.tenantId !== context.tenant.id || record.identityId !== context.identity.id) fail('SHOPIFY_STATE_INVALID', 400);
      const [[connection]] = await db.query(`SELECT id,store_domain AS storeDomain,status FROM sx_retail_store_connections
        WHERE tenant_id=? AND id=? AND provider='shopify' FOR UPDATE`, [record.tenantId, record.connectionId]);
      if (!connection || connection.storeDomain !== shop || connection.status !== 'pending') fail('SHOPIFY_STATE_INVALID', 400);
      connectionId = connection.id;
      await db.query('UPDATE sx_retail_store_oauth_states SET consumed_at=UTC_TIMESTAMP(3) WHERE state_hash=?', [hash]);
      await db.commit();
    } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
    const exchanged = await tokenExchange(shop, String(req.query.code || ''), config);
    const missingScopes = ['read_products','read_orders','read_customers'].filter(scope => !exchanged.scopes.includes(scope));
    if (missingScopes.length) fail('SHOPIFY_REQUIRED_SCOPE_MISSING', 403);
    const encrypted = connector.seal(exchanged, context.tenant.id, connectionId, 'credentials');
    await pool.query(`UPDATE sx_retail_store_connections SET status='active',scopes=?,credentials_ciphertext=?,credentials_iv=?,
      credentials_auth_tag=?,last_error_code=NULL,sync_cursor=NULL WHERE tenant_id=? AND id=?`,
    [JSON.stringify(exchanged.scopes), encrypted.ciphertext, encrypted.iv, encrypted.authTag, context.tenant.id, connectionId]);
    const connection = await loadConnection(pool, context.tenant.id, connectionId);
    const subscriptions = await registerShopifyWebhooks(connection, publicOrigin(origin));
    const setupError = subscriptions.installed < subscriptions.required ? 'SHOPIFY_WEBHOOK_SETUP_PARTIAL' : null;
    await pool.query('UPDATE sx_retail_store_connections SET last_error_code=? WHERE tenant_id=? AND id=?', [setupError, context.tenant.id, connectionId]);
    await pool.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?, ?, ?, 'identity', 'retail.store-connected', 'retail-store-connection', ?, ?, ?)`,
    [crypto.randomUUID(), context.tenant.id, context.identity.id, connectionId,
      JSON.stringify({ provider: 'shopify', scopes: exchanged.scopes, webhookSubscriptions: subscriptions.installed }), crypto.randomUUID()]);
    return res.redirect(303, '/user?page=retail-connected-stores&connected=shopify');
  } catch (error) {
    const clean = cleanError(error);
    if (connectionId && req.businessContext?.tenant?.id) await pool.query(`UPDATE sx_retail_store_connections SET status='error',last_error_code=?
      WHERE tenant_id=? AND id=? AND status<>'revoked'`, [clean.code, req.businessContext.tenant.id, connectionId]).catch(() => {});
    return res.redirect(303, `/user?page=retail-connected-stores&connectionError=${encodeURIComponent(clean.code)}`);
  }
}

async function handleWebhook(pool, provider, connection, req, res) {
  if (!connection || !Buffer.isBuffer(req.body)) return res.sendStatus(404);
  const raw = req.body;
  if (raw.length > 2 * 1024 * 1024) return res.sendStatus(413);
  const topic = String(provider === 'shopify' ? req.get('X-Shopify-Topic') || '' : req.get('X-WC-Webhook-Topic') || req.get('X-7Network-Event') || '');
  const resource = String(provider === 'shopify' ? topic.split('/')[0] : req.get('X-WC-Webhook-Resource') || (topic.startsWith('checkout.') ? 'checkout' : ''));
  const valid = provider === 'shopify' ? connector.shopifySignature(raw, req.get('X-Shopify-Hmac-Sha256'), process.env.SALEMAX_SHOPIFY_CLIENT_SECRET) :
    connector.wooSignature(raw, req.get('X-WC-Webhook-Signature') || req.get('X-7Network-Signature'), connection.webhook_secret_ciphertext ?
      connector.open({ ciphertext: connection.webhook_secret_ciphertext, iv: connection.webhook_secret_iv, authTag: connection.webhook_secret_auth_tag },
        connection.tenant_id, connection.id, 'webhook-secret').toString('utf8') : '');
  if (!valid) return res.sendStatus(401);
  const shopHeader = provider === 'shopify' ? String(req.get('X-Shopify-Shop-Domain') || '').toLowerCase() : null;
  if (provider === 'shopify' && shopHeader !== connection.store_domain) return res.sendStatus(401);
  if (!['active','paused','revoked'].includes(connection.status)) return res.sendStatus(410);
  if (connection.status !== 'active' && !/app\/uninstalled|shop\/redact|customers\/(redact|data_request)/i.test(topic)) return res.sendStatus(200);
  try {
    const eventId = provider === 'shopify' ? req.get('X-Shopify-Event-Id') : req.get('X-WC-Webhook-Delivery-ID');
    const result = await processWebhook(pool, connection, { raw, topic, resource, eventId });
    return res.status(200).json({ success: true, duplicate: result.duplicate });
  } catch (error) {
    const clean = cleanError(error);
    if (clean.status < 500) return res.status(400).json({ success: false, code: clean.code });
    return res.status(503).json({ success: false, code: 'WEBHOOK_PROCESSING_FAILED' });
  }
}

function publicRouter({ pool, authenticate, origin }) {
  const router = express.Router();
  const oauthCallback = (req, res, next) => authenticate(req, res, () => callbackShopify(pool, req, res, origin).catch(next));
  router.get('/shopify/callback', noStore, oauthCallback);
  router.post('/shopify', noStore, express.raw({ type: 'application/json', limit: '2mb' }), handle(async (req, res) => {
    let shop;
    try { shop = connector.normalizeShop(req.get('X-Shopify-Shop-Domain')); } catch { return res.sendStatus(401); }
    const [[connection]] = await pool.query(`SELECT * FROM sx_retail_store_connections WHERE provider='shopify' AND store_domain=? LIMIT 1`, [shop]);
    return handleWebhook(pool, 'shopify', connection, req, res);
  }));
  router.post('/shopify/:id', noStore, express.raw({ type: 'application/json', limit: '2mb' }), handle(async (req, res) => {
    const connection = await webhookConnection(pool, 'shopify', req.params.id);
    return handleWebhook(pool, 'shopify', connection, req, res);
  }));
  router.post('/woocommerce/:id', noStore, express.raw({ type: 'application/json', limit: '2mb' }), handle(async (req, res) => {
    const connection = await webhookConnection(pool, 'woocommerce', req.params.id);
    return handleWebhook(pool, 'woocommerce', connection, req, res);
  }));
  router.get('/woocommerce-plugin', noStore, (req, res) => {
    const filename = path.resolve(__dirname, '../../integrations/woocommerce/7network-retail-connector.zip');
    if (!fs.existsSync(filename)) return res.sendStatus(404);
    res.set('X-Content-Type-Options', 'nosniff').set('Content-Disposition', 'attachment; filename="7network-retail-connector.zip"');
    return res.type('application/zip').sendFile(filename);
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const clean = cleanError(error);
    return res.status(clean.status >= 400 && clean.status < 600 ? clean.status : 502).json({ success: false, code: clean.code });
  });
  return router;
}

module.exports = { workspaceRouter, publicRouter, syncShopify, syncWoo, connectionData, processWebhook, listConnections };
