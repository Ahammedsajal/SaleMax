'use strict';

const express = require('express');
const crypto = require('node:crypto');
const {buildConnectorArchive} = require('./woocommerce-connector-package');
const connector = require('./retail-connected-stores');
const connectorPilot=require('./retail-connector-pilot');
const { decision } = require('./policy');
const originCheck = require('./request-origin');
const quantity = require('./retail-quantity');

const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const reply = (res, data) => res.json({ success: true, data });
const noStore = (req, res, next) => { res.set('Cache-Control', 'private, no-store, max-age=0'); res.set('Pragma', 'no-cache'); next(); };
const fail = connector.fail;
const stockManagementModes = new Set(['unknown','managed','unmanaged','parent']);
const validVersion = value => /^20\d{2}-(01|04|07|10)$/.test(value || '');
const safeConnection = row => {
  const woo = row.provider === 'woocommerce' ? parseJson(row.sync_cursor, {}).woocommerce || {} : null;
  return { id: row.id, provider: row.provider, storeDomain: row.store_domain, displayName: row.display_name,
    currency: row.default_currency, status: row.status, scopes: parseJson(row.scopes, []), lastSyncAt: row.last_sync_at,
    lastErrorCode: row.last_error_code, counts: row.counts || { orders: 0, customers: 0, products: 0, variations: 0, checkouts: 0, mappings: 0 },
    syncProgress: woo ? { scanStartedAt: woo.scanStartedAt || null, lastCompleteScanAt: woo.lastCompleteScan?.completedAt || null,
      resources: Object.fromEntries(['products','orders','customers'].map(resource => [resource, {
        complete: Boolean(woo[resource]?.complete), page: Number(woo[resource]?.page) || 1,
        sourceTotal: woo[resource]?.sourceTotal ?? null, scanned: Number(woo[resource]?.scanned) || 0,
      }])), pendingVariationParents: (woo.variationQueue || []).length } : null };
};
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
const RETRYABLE_WOO_STATUSES=new Set([408,425,429,500,502,503,504]);
const RETRYABLE_WOO_ERROR_CODES=new Set(['ECONNRESET','ETIMEDOUT','EAI_AGAIN','ECONNREFUSED','EHOSTUNREACH','ENETUNREACH','EPIPE','PROVIDER_TIMEOUT','PROVIDER_DNS_FAILED']);
function wooRetryDelayMs(headers,attempt){
  const retryAfter=headers?.['retry-after'];
  if(typeof retryAfter==='string'&&retryAfter.trim()){
    const value=retryAfter.trim(),seconds=Number(value);
    const delay=Number.isFinite(seconds)&&seconds>=0?seconds*1000:Date.parse(value)-Date.now();
    if(Number.isFinite(delay)&&delay>=0)return delay<=3000?delay:null;
  }
  return Math.min(1000,250*(2**attempt));
}
async function wooApi(connection, resource, query = {}) {
  let resourcePath = resource;
  const params = { ...query };
  if (resource === 'variations') {
    const parentId = String(params.productId || '');
    if (!/^\d{1,191}$/.test(parentId)) fail('INVALID_STORE_RESOURCE', 400);
    resourcePath = `products/${encodeURIComponent(parentId)}/variations`;
    delete params.productId;
  } else if (!['orders','customers','products'].includes(resource)) fail('INVALID_STORE_RESOURCE', 400);
  const { key, secret } = wooCredentials(connection);
  const base = new URL(connection.store_domain);
  const apiUrl = new URL(`${base.pathname.replace(/\/$/, '')}/wp-json/wc/v3/${resourcePath}`, base.origin);
  for (const [name, value] of Object.entries(params)) apiUrl.searchParams.set(name, String(value));
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try{
      response = await connector.requestHttps(apiUrl.toString(), {
        headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`, Accept: 'application/json' },
      });
    }catch(error){
      if(attempt===2||!RETRYABLE_WOO_ERROR_CODES.has(String(error?.code||'')))throw error;
      await new Promise(resolve=>setTimeout(resolve,wooRetryDelayMs(null,attempt)));
      continue;
    }
    if(!RETRYABLE_WOO_STATUSES.has(response.status)||attempt===2)break;
    const delay=wooRetryDelayMs(response.headers,attempt);
    if(delay===null)break;
    await new Promise(resolve=>setTimeout(resolve,delay));
  }
  if (response.status < 200 || response.status >= 300 || !Array.isArray(response.data)) {
    fail(response.status === 401 || response.status === 403 ? 'WOOCOMMERCE_KEY_OR_PERMISSION_INVALID' : 'WOOCOMMERCE_REQUEST_FAILED', 502);
  }
  const rawTotalPages = response.headers?.['x-wp-totalpages'], rawTotal = response.headers?.['x-wp-total'];
  const totalPages = typeof rawTotalPages === 'string' && /^\d{1,10}$/.test(rawTotalPages) ? Number(rawTotalPages) : NaN;
  const total = typeof rawTotal === 'string' && /^\d{1,12}$/.test(rawTotal) ? Number(rawTotal) : NaN;
  if (!Number.isSafeInteger(totalPages) || totalPages < 0 || !Number.isSafeInteger(total) || total < 0 || (total > 0 && totalPages < 1)) {
    fail('WOOCOMMERCE_PAGINATION_METADATA_MISSING', 502);
  }
  // WooCommerce may report zero pages for an empty collection. Page one is
  // still queried once, while both source totals remain available for audit.
  return { rows: response.data, totalPages: Math.max(1, totalPages), total };
}
async function verifyWooConnection(base, key, secret) {
  const url = new URL(`${new URL(base).pathname.replace(/\/$/, '')}/wp-json/wc/v3/orders?per_page=1&orderby=id&order=desc`, new URL(base).origin);
  const response = await connector.requestHttps(url.toString(), { headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`, Accept: 'application/json' } });
  if (response.status !== 200 || !Array.isArray(response.data)) fail(response.status === 401 || response.status === 403 ? 'WOOCOMMERCE_KEY_OR_PERMISSION_INVALID' : 'WOOCOMMERCE_CONNECTION_FAILED', 502);
  return true;
}
async function checkpointWooCursor(db, connection, lock, local, next) {
  const [saved] = await db.query(`UPDATE sx_retail_store_connections SET sync_cursor=? WHERE tenant_id=? AND id=? AND sync_lock_token=?`,
    [JSON.stringify({ ...local, woocommerce: next }), connection.tenant_id, connection.id, lock]);
  if (!saved.affectedRows) fail('STORE_SYNC_LEASE_LOST', 409);
}
async function syncWoo(pool, connection) {
  const lock = crypto.randomUUID();
  const [locked] = await pool.query(`UPDATE sx_retail_store_connections SET sync_lock_token=?,sync_lock_until=UTC_TIMESTAMP(3)+INTERVAL 5 MINUTE
    WHERE tenant_id=? AND id=? AND status='active' AND (sync_lock_until IS NULL OR sync_lock_until<UTC_TIMESTAMP(3))`, [lock, connection.tenant_id, connection.id]);
  if (!locked.affectedRows) fail('STORE_SYNC_ALREADY_RUNNING', 409);
  const local = cursorState(connection), next = structuredClone(local.woocommerce || {}), result = {};
  try {
    const resources = ['products','orders','customers'];
    if (resources.every(resource => next[resource]?.complete) && !(next.variationQueue || []).length) {
      const lastCompleteScan = next.lastCompleteScan || null;
      for (const resource of resources) next[resource] = { page: 1, complete: false, sourceTotal: null, scanned: 0 };
      next.variationQueue = [];
      next.scanStartedAt = new Date().toISOString();
      next.lastCompleteScan = lastCompleteScan;
    }
    if (!next.scanStartedAt) next.scanStartedAt = new Date().toISOString();
    for (const resource of resources) next[resource] ||= { page: 1, complete: false, sourceTotal: null, scanned: 0 };
    next.variationQueue ||= [];
    for (const resource of ['products','orders','customers']) {
      const state = next[resource];
      if (state.complete) {
        result[resource] = { imported: 0, hasMore: false, complete: true, sourceTotal: state.sourceTotal };
        continue;
      }
      if (resource === 'products' && next.variationQueue.length) {
        result[resource] = { imported: 0, hasMore: true, complete: false, waitingForVariations: true,
          page: Math.max(1, Number(state.page) || 1), sourceTotal: state.sourceTotal, scanned: state.scanned };
        continue;
      }
      const page = Math.max(1, Number(state.page) || 1);
      if (page > 10000) fail('WOOCOMMERCE_PAGE_LIMIT_REACHED', 413);
      const data = await wooApi(connection, resource, { per_page: 50, page, orderby: 'id', order: 'asc',
        ...(resource === 'products' || resource === 'orders' ? { status: 'any' } : {}) });
      const hasMore = page < data.totalPages;
      const sourceChanged = state.sourceTotal != null && data.total != null && Number(state.sourceTotal) !== data.total;
      state.page = hasMore ? page + 1 : page;
      state.complete = !hasMore;
      state.sourceTotal = data.total ?? state.sourceTotal;
      state.scanned = Number(state.scanned || 0) + data.rows.length;
      state.sourceChangedDuringScan = Boolean(state.sourceChangedDuringScan || sourceChanged);
      if (resource === 'products') {
        state.variationSourceTotal = Number(state.variationSourceTotal || 0) + data.rows.reduce((sum, row) => sum + (Array.isArray(row.variations) ? row.variations.length : 0), 0);
      }
      if (resource === 'orders') {
        state.amounts ||= {};
        for (const row of data.rows) {
          const order = connector.normalizeOrder('woocommerce', row), key = `${order.currency}|${order.status}|${order.financialStatus}`;
          const bucket = state.amounts[key] ||= { currency: order.currency, status: order.status, financialStatus: order.financialStatus, count: 0, total: '0.000000' };
          bucket.count++;
          bucket.total = connector.decimalAdd([bucket.total, order.total]);
          for (const field of ['subtotal','discount','shipping','tax','fees','refunds']) {
            const target = field === 'fees' ? 'fee' : field === 'refunds' ? 'refund' : field;
            const value = order.breakdown[field];
            if (value == null) bucket[`${target}Complete`] = false;
            else if (bucket[`${target}Complete`] !== false) bucket[target] = connector.decimalAdd([bucket[target] || '0.000000', value]);
          }
        }
      }
      const writer = await pool.getConnection();
      try {
        await writer.beginTransaction();
        for (const row of data.rows) {
          if (resource === 'products') {
            await connector.upsertProduct(writer, connection, row);
            const variationIds = Array.isArray(row.variations) ? row.variations : [];
            if (variationIds.length && !next.variationQueue.some(item => item.productId === String(row.id))) {
              next.variationQueue.push({ productId: String(row.id), page: 1 });
            }
          }
          if (resource === 'customers') await connector.upsertCustomer(writer, connection, row);
          if (resource === 'orders') {
            if (Number(row.customer_id) > 0) await connector.upsertCustomer(writer, connection, { ...row.billing, id: row.customer_id, billing: row.billing, updated_at: row.date_modified_gmt });
            await connector.upsertOrder(writer, connection, row);
          }
        }
        await checkpointWooCursor(writer, connection, lock, local, next);
        await writer.commit();
      } catch (error) { await writer.rollback(); throw error; } finally { writer.release(); }
      result[resource] = { imported: data.rows.length, hasMore, complete: !hasMore, page,
        sourceTotal: state.sourceTotal, scanned: state.scanned };
    }
    let variationsImported = 0, variationRequests = 0;
    while (next.variationQueue.length && variationRequests < 2) {
      const pending = next.variationQueue[0];
      const data = await wooApi(connection, 'variations', { productId: pending.productId, per_page: 100, page: pending.page, orderby: 'id', order: 'asc', status: 'any' });
      const writer = await pool.getConnection();
      try {
        await writer.beginTransaction();
        for (const row of data.rows) await connector.upsertProductVariation(writer, connection, pending.productId, row);
        pending.totalPages = data.totalPages;
        if (pending.page >= data.totalPages) next.variationQueue.shift();
        else pending.page++;
        await checkpointWooCursor(writer, connection, lock, local, next);
        await writer.commit();
      } catch (error) { await writer.rollback(); throw error; } finally { writer.release(); }
      variationsImported += data.rows.length;
      variationRequests++;
    }
    result.variations = { imported: variationsImported, hasMore: next.variationQueue.length > 0, pendingParents: next.variationQueue.length };
    const complete = resources.every(resource => next[resource].complete) && next.variationQueue.length === 0;
    if (complete) next.lastCompleteScan = { startedAt: next.scanStartedAt, completedAt: new Date().toISOString(),
      queryScope: { products: { status: 'any' }, variations: { status: 'any' }, orders: { status: 'any' }, customers: 'all API-visible customers' },
      sourceCounts: Object.fromEntries(resources.map(resource => [resource, { total: next[resource].sourceTotal, scanned: next[resource].scanned,
        sourceChangedDuringScan: Boolean(next[resource].sourceChangedDuringScan) }])),
      sourceVariationCount: next.products.variationSourceTotal || 0, orderAmounts: next.orders.amounts || {} };
    const [completed] = await pool.query(`UPDATE sx_retail_store_connections SET sync_cursor=?,last_sync_at=UTC_TIMESTAMP(3),last_error_code=NULL,
      sync_lock_token=NULL,sync_lock_until=NULL WHERE tenant_id=? AND id=? AND sync_lock_token=?`,
    [JSON.stringify({ ...local, woocommerce: next }), connection.tenant_id, connection.id, lock]);
    if (!completed.affectedRows) fail('STORE_SYNC_LEASE_LOST', 409);
    return { provider: 'woocommerce', complete, lastCompleteScanAt: next.lastCompleteScan?.completedAt || null,
      resources: result, automaticUpdates: 'webhooks', abandonedCheckouts: 'connector_plugin_required' };
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
    (SELECT COUNT(*) FROM sx_retail_external_product_variants v WHERE v.tenant_id=c.tenant_id AND v.connection_id=c.id AND v.variant_status<>'deleted') AS variationCount,
    (SELECT COUNT(*) FROM sx_retail_external_checkouts x WHERE x.tenant_id=c.tenant_id AND x.connection_id=c.id) AS checkoutCount,
    (SELECT COUNT(*) FROM sx_retail_external_product_mappings m WHERE m.tenant_id=c.tenant_id AND m.connection_id=c.id AND m.mapping_status='mapped') AS mappingCount
    FROM sx_retail_store_connections c WHERE c.tenant_id=? ORDER BY c.created_at DESC,c.id LIMIT 100`, [tenantId]);
  return rows.map(row => safeConnection({ ...row, counts: { orders: Number(row.orderCount), customers: Number(row.customerCount),
    products: Number(row.productCount), variations: Number(row.variationCount), checkouts: Number(row.checkoutCount), mappings: Number(row.mappingCount) } }));
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
async function connectionData(pool, connection, kind, pageValue, parentProductId = null) {
  if (!['orders','customers','products','checkouts','variations'].includes(kind)) fail('INVALID_STORE_RESOURCE', 400);
  const page = Number(pageValue || 1); if (!Number.isSafeInteger(page) || page < 1 || page > 200) fail('INVALID_PAGE', 400);
  const limit = 50, offset = (page - 1) * limit, { tenant_id: tenantId, id } = connection;
  if (kind === 'variations') {
    const parentId = String(parentProductId || '');
    if (connection.provider !== 'woocommerce' || !/^\d{1,191}$/.test(parentId)) fail('INVALID_STORE_RESOURCE', 400);
    const [rows] = await pool.query(`SELECT external_variant_id AS id,external_product_id AS productId,sku,variant_status AS status,
      currency,price,variant_ciphertext AS ciphertext,variant_iv AS iv,variant_auth_tag AS authTag,
      source_stock_management AS sourceStockManagement,
      CAST(source_stock_quantity AS CHAR) AS sourceStockQuantity,source_stock_status AS sourceStockStatus
      FROM sx_retail_external_product_variants WHERE tenant_id=? AND connection_id=? AND external_product_id=? AND variant_status<>'deleted'
      ORDER BY external_variant_id LIMIT ? OFFSET ?`, [tenantId,id,parentId,limit+1,offset]);
    return rows.map(row => { const variation = jsonFromEncrypted(row, tenantId, id, `product-variant:${row.id}`); return {
      id: row.id, productId: row.productId, title: variation.title, sku: row.sku, status: row.status,
      purchasable: variation.purchasable, currency: row.currency, price: String(row.price), attributes: variation.attributes || [],
      sourceStock: sourceStockFromRow(row,variation.sourceStock),
      updatedAt: variation.updatedAt || null,
    }; });
  }
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
          id: line.id, productId: line.productId, variationId: line.variantId,
          name: String(line.title || line.name || line.product_title || '').slice(0, 200), sku: String(line.sku || '').slice(0, 100),
          quantity: String(line.quantity ?? '0.000000'), subtotal: line.subtotal, discount: line.discount, total: line.total, tax: line.tax,
        })), lineItemsTruncated: Boolean(snapshot.lineItemsTruncated), transactionsTruncated: Boolean(snapshot.transactionsTruncated),
        breakdown: snapshot.breakdown || null,
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
    const productIds = rows.map(row => row.id);
    const [variationCounts] = productIds.length ? await pool.query(`SELECT external_product_id AS productId,COUNT(*) AS count
      FROM sx_retail_external_product_variants WHERE tenant_id=? AND connection_id=? AND external_product_id IN (${productIds.map(() => '?').join(',')})
        AND variant_status<>'deleted' GROUP BY external_product_id`, [tenantId, id, ...productIds]) : [[]];
    const counts = new Map(variationCounts.map(row => [row.productId, Number(row.count)]));
    return rows.map(row => { const product = jsonFromEncrypted(row, tenantId, id, `product:${row.id}`), importedVariants = counts.get(row.id) || 0; return {
      id: row.id, title: product.title, sku: product.sku, status: row.status, productType: product.productType || 'unknown', currency: row.currency, price: String(row.price),
      priceUnavailable: Boolean(product.priceUnavailable), imageUrl: product.imageUrl || null,
      variants: connection.provider === 'woocommerce' ? [] : (product.variants || []).slice(0,20).map(variant => ({
        title: String(variant.title || variant.name || 'Default').slice(0,100), sku: String(variant.sku || '').slice(0,100),
        price: String(variant.price ?? '') })),
      variationCount: importedVariants, sourceVariationCount: Number(product.variationCount) || null,
      variantsTruncated: Boolean(product.variantsTruncated || Number(product.variationCount) > importedVariants), updatedAt: row.updatedAt,
      sourceStock: product.sourceStock || null,
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
      contactConsent: row.contactConsent, lineItems: (checkout.lineItems || []).slice(0, 50).map(line => ({ name: String(line.title || line.name || '').slice(0, 200), quantity: String(line.quantity ?? '0.000000') })),
      lineItemsTruncated: Boolean(checkout.lineItemsTruncated), canRevealRecoveryLink: Boolean(row.status === 'abandoned'), updatedAt: row.updatedAt };
  });
}
function validWooProductId(value) { return typeof value === 'string' && /^\d{1,191}$/.test(value); }
function normalizeMappingWrite(body) {
  const allowed = ['externalProductId','externalVariationId','targetProductId','action','expectedRevision','expectedSku',
    'stockScope','targetLocationId','sourceUnitConfirmed','expectedUnitRevision'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) fail('INVALID_PRODUCT_MAPPING', 400);
  const externalProductId = String(body.externalProductId || '');
  const externalVariationId = body.externalVariationId == null ? '' : String(body.externalVariationId);
  const action = body.action;
  const expectedRevision = body.expectedRevision;
  const expectedSku = body.expectedSku == null ? null : String(body.expectedSku);
  const stockScope = body.stockScope == null ? 'unverified' : body.stockScope;
  const targetLocationId = body.targetLocationId == null ? null : String(body.targetLocationId).toLowerCase();
  const sourceUnitConfirmed = body.sourceUnitConfirmed === true;
  const expectedUnitRevision = body.expectedUnitRevision == null ? null : body.expectedUnitRevision;
  if (!validWooProductId(externalProductId) || externalVariationId && !validWooProductId(externalVariationId) ||
      !['map','ignore','clear'].includes(action) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      expectedSku != null && expectedSku.length > 100 || !['unverified','single_location','aggregate'].includes(stockScope) ||
      targetLocationId != null && !connector.validateId(targetLocationId) ||
      expectedUnitRevision != null && (!Number.isSafeInteger(expectedUnitRevision) || expectedUnitRevision < 0) ||
      stockScope === 'single_location' && (!targetLocationId || !sourceUnitConfirmed || expectedUnitRevision == null) ||
      stockScope === 'aggregate' && (targetLocationId || !sourceUnitConfirmed || expectedUnitRevision == null) ||
      stockScope === 'unverified' && (targetLocationId || sourceUnitConfirmed || expectedUnitRevision != null)) fail('INVALID_PRODUCT_MAPPING', 400);
  const targetProductId = body.targetProductId == null ? null : String(body.targetProductId).toLowerCase();
  if (action === 'map' && !connector.validateId(targetProductId) || action !== 'map' && targetProductId != null) fail('INVALID_PRODUCT_MAPPING', 400);
  if (action !== 'map' && stockScope !== 'unverified') fail('INVALID_PRODUCT_MAPPING', 400);
  return { externalProductId, externalVariationId, targetProductId, action, expectedRevision, expectedSku,
    stockScope, targetLocationId, sourceUnitConfirmed, expectedUnitRevision };
}
function sourceStockFromRow(row, fallback = null) {
  const storedMode = row?.sourceStockManagement;
  const fallbackMode = fallback?.managementMode;
  const managementMode = stockManagementModes.has(storedMode) ? storedMode :
    storedMode == null && stockManagementModes.has(fallbackMode) ? fallbackMode : 'unknown';
  return { managed: managementMode === 'managed', managementMode,
    quantity: managementMode !== 'managed' || row?.sourceStockQuantity == null ? null : String(row.sourceStockQuantity),
    status: String(row.sourceStockStatus || 'unknown').toLowerCase().slice(0,32) };
}
function stockQuantityFitsUnit(value, unit) {
  const amount = quantity.signed(value == null ? '' : String(value));
  const increment = quantity.scaled(String(unit?.quantityIncrement ?? '1'));
  return amount !== null && increment !== null && quantity.atPrecision(amount, Number(unit?.quantityPrecision ?? 0)) &&
    quantity.isMultiple(amount, increment);
}
function stockMappingState(sourceStock, parentStock, mapping) {
  if (sourceStock?.managementMode === 'parent') return 'parent_shared';
  if (sourceStock?.managementMode === 'unknown' || !sourceStock?.managementMode) return 'source_unknown';
  if (sourceStock.managementMode === 'unmanaged') return 'not_managed';
  if (sourceStock.managementMode !== 'managed') return 'source_unknown';
  if (sourceStock.quantity == null) return 'quantity_unavailable';
  if (!mapping?.targetProductId || mapping.mappingStatus !== 'mapped') return 'unmapped';
  if (!['single_location','aggregate'].includes(mapping.stockScope) || !Number(mapping.sourceUnitConfirmed)) return 'needs_review';
  if (Number(mapping.targetUnitRevision) !== Number(mapping.currentUnitRevision)) return 'unit_profile_changed';
  if (!stockQuantityFitsUnit(sourceStock.quantity, mapping.unitProfile)) return 'unit_incompatible';
  if (mapping.stockScope === 'single_location' && (!mapping.targetLocationId || mapping.targetLocationStatus !== 'active')) return 'location_unavailable';
  return 'ready_read_only_comparison';
}
function mappingTarget(row, sourceSku, sourceStock = null, parentStock = null) {
  if (!row?.targetProductId) return null;
  const targetSku = row.targetSku == null ? null : String(row.targetSku);
  const unitProfile = { baseUnitCode: row.baseUnitCode || 'unit', baseUnitLabel: row.baseUnitLabel || '',
    baseUnitLabelAr: row.baseUnitLabelAr || '', quantityPrecision: Number(row.quantityPrecision || 0),
    quantityIncrement: String(row.quantityIncrement || '1.000000') };
  const stockMapping = { mappingStatus: row.mappingStatus, stockScope: row.stockScope || 'unverified',
    targetLocationId: row.targetLocationId || null, targetLocationStatus: row.targetLocationStatus || null,
    targetLocationNameEn: row.targetLocationNameEn || null, targetLocationNameAr: row.targetLocationNameAr || null,
    sourceUnitConfirmed: Boolean(Number(row.sourceUnitConfirmed)), targetUnitRevision: row.targetUnitRevision == null ? null : Number(row.targetUnitRevision),
    currentUnitRevision: Number(row.currentUnitRevision || 0), unitProfile };
  stockMapping.state = stockMappingState(sourceStock, parentStock, stockMapping);
  unitProfile.revision = Number(row.currentUnitRevision || 0);
  return { id: row.targetProductId, sku: targetSku, nameEn: row.targetNameEn, nameAr: row.targetNameAr,
    status: row.targetStatus, isVariant: Boolean(row.targetVariantGroupId), variantGroupTitleEn: row.targetVariantGroupTitleEn || null,
    variantValueEn: row.targetVariantValueEn || null,
    unitProfile, stockMapping,
    skuMatches: sourceSku && targetSku ? sourceSku.trim().toUpperCase() === targetSku.trim().toUpperCase() : null };
}
async function productMappingDetails(pool, connection, externalProductId, pageValue) {
  if (connection.provider !== 'woocommerce' || !validWooProductId(externalProductId)) fail('INVALID_PRODUCT_MAPPING_SOURCE', 400);
  const page = Number(pageValue || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 200) fail('INVALID_PAGE', 400);
  const tenantId = connection.tenant_id, connectionId = connection.id;
  const [[row]] = await pool.query(`SELECT product_status AS status,sku,currency,price,product_ciphertext AS ciphertext,
    product_iv AS iv,product_auth_tag AS authTag,source_stock_management AS sourceStockManagement,
    CAST(source_stock_quantity AS CHAR) AS sourceStockQuantity,source_stock_status AS sourceStockStatus,source_updated_at AS updatedAt
    FROM sx_retail_external_products
    WHERE tenant_id=? AND connection_id=? AND external_product_id=? AND product_status<>'deleted'`, [tenantId,connectionId,externalProductId]);
  if (!row) fail('STORE_PRODUCT_NOT_FOUND', 404);
  const product = jsonFromEncrypted(row,tenantId,connectionId,`product:${externalProductId}`);
  const parentStock = sourceStockFromRow(row,product.sourceStock || null);
  const productType = String(product.productType || 'unknown');
  let sourceItems = [], hasMore = false;
  if (productType === 'simple') {
    if (page !== 1) fail('INVALID_PAGE', 400);
    sourceItems = [{ productId: externalProductId, variationId: null, sourceType: 'product', title: product.title,
      sku: row.sku, status: row.status, currency: row.currency, price: String(row.price), sourceStock: parentStock,
      updatedAt: row.updatedAt, mappable: row.status === 'publish' }];
  } else if (productType === 'variable') {
    const variants = await connectionData(pool,connection,'variations',page,externalProductId);
    hasMore = variants.length > 50;
    sourceItems = variants.slice(0,50).map(variant => ({ productId: externalProductId, variationId: variant.id, sourceType: 'variation',
      title: variant.title, sku: variant.sku, status: variant.status, purchasable: variant.purchasable, currency: variant.currency,
      price: variant.price, sourceStock: variant.sourceStock,
      parentStock: variant.sourceStock?.managementMode === 'parent' ? parentStock : null, updatedAt: variant.updatedAt,
      mappable: row.status === 'publish' && variant.status === 'publish' && variant.purchasable !== false }));
  }
  const variantIds = sourceItems.map(item => item.variationId || '');
  const [mappingRows] = variantIds.length ? await pool.query(`SELECT m.id,m.external_variant_id AS externalVariationId,
      m.mapping_status AS mappingStatus,m.target_product_id AS targetProductId,m.revision,m.stock_scope AS stockScope,
      m.target_location_id AS targetLocationId,m.source_unit_confirmed AS sourceUnitConfirmed,m.target_unit_revision AS targetUnitRevision,
      p.code AS targetSku,p.name_en AS targetNameEn,p.name_ar AS targetNameAr,p.status AS targetStatus,
      vp.group_id AS targetVariantGroupId,vg.title_en AS targetVariantGroupTitleEn,vp.value_en AS targetVariantValueEn,
      COALESCE(iu.base_unit_code,'unit') AS baseUnitCode,COALESCE(iu.base_unit_label,'') AS baseUnitLabel,
      COALESCE(iu.base_unit_label_ar,'') AS baseUnitLabelAr,COALESCE(iu.quantity_precision,0) AS quantityPrecision,
      CAST(COALESCE(iu.quantity_increment,1.000000) AS CHAR) AS quantityIncrement,COALESCE(iu.revision,0) AS currentUnitRevision,
      loc.status AS targetLocationStatus,loc.name_en AS targetLocationNameEn,loc.name_ar AS targetLocationNameAr
    FROM sx_retail_external_product_mappings m
    LEFT JOIN sx_product_catalog p ON p.tenant_id=m.tenant_id AND p.id=m.target_product_id
    LEFT JOIN sx_retail_variant_products vp ON vp.tenant_id=p.tenant_id AND vp.product_id=p.id
    LEFT JOIN sx_retail_variant_groups vg ON vg.tenant_id=vp.tenant_id AND vg.id=vp.group_id
    LEFT JOIN sx_retail_product_inventory_units iu ON iu.tenant_id=p.tenant_id AND iu.product_id=p.id
    LEFT JOIN sx_retail_locations loc ON loc.tenant_id=m.tenant_id AND loc.id=m.target_location_id
    WHERE m.tenant_id=? AND m.connection_id=? AND m.external_product_id=? AND m.external_variant_id IN (${variantIds.map(() => '?').join(',')})`,
    [tenantId,connectionId,externalProductId,...variantIds]) : [[]];
  const byVariation = new Map(mappingRows.map(mapping => [mapping.externalVariationId,mapping]));
  const items = sourceItems.map(item => {
    const mapping = byVariation.get(item.variationId || '');
    return { ...item, mappingStatus: mapping?.mappingStatus || 'unmapped', mappingId: mapping?.id || null,
      mappingRevision: Number(mapping?.revision || 0), targetProduct: mappingTarget(mapping,item.sku,item.sourceStock,item.parentStock) };
  });
  return { product: { id: externalProductId, title: product.title, sku: row.sku, type: productType, status: row.status,
      variationCount: Number(product.variationCount) || 0 }, page, hasMore, items };
}
async function mappingTargets(pool, tenantId, queryValue) {
  const search = typeof queryValue === 'string' ? queryValue.trim().replace(/\s+/g,' ') : '';
  if (search.length < 2 || search.length > 100 || /[\u0000-\u001f\u007f]/.test(search)) fail('INVALID_MAPPING_SEARCH', 400);
  const normalized = search.toLowerCase();
  const [rows] = await pool.query(`SELECT p.id,p.code AS sku,p.name_en AS nameEn,p.name_ar AS nameAr,p.status,
      vp.group_id AS variantGroupId,vg.title_en AS variantGroupTitleEn,vp.value_en AS variantValueEn,
      COALESCE(iu.base_unit_code,'unit') AS baseUnitCode,COALESCE(iu.base_unit_label,'') AS baseUnitLabel,
      COALESCE(iu.base_unit_label_ar,'') AS baseUnitLabelAr,COALESCE(iu.quantity_precision,0) AS quantityPrecision,
      CAST(COALESCE(iu.quantity_increment,1.000000) AS CHAR) AS quantityIncrement,COALESCE(iu.revision,0) AS unitRevision
    FROM sx_product_catalog p
    LEFT JOIN sx_retail_variant_products vp ON vp.tenant_id=p.tenant_id AND vp.product_id=p.id
    LEFT JOIN sx_retail_variant_groups vg ON vg.tenant_id=vp.tenant_id AND vg.id=vp.group_id
    LEFT JOIN sx_retail_product_inventory_units iu ON iu.tenant_id=p.tenant_id AND iu.product_id=p.id
    WHERE p.tenant_id=? AND p.status='active' AND p.deleted_at IS NULL
      AND (LOCATE(?,LOWER(p.code))>0 OR LOCATE(?,LOWER(p.name_en))>0 OR LOCATE(?,LOWER(p.name_ar))>0)
    ORDER BY (LOWER(p.code)=?) DESC,p.code,p.id LIMIT 50`,[tenantId,normalized,normalized,normalized,normalized]);
  const [locations] = await pool.query(`SELECT id,code,name_en AS nameEn,name_ar AS nameAr FROM sx_retail_locations
    WHERE tenant_id=? AND status='active' ORDER BY is_default DESC,name_en,id`,[tenantId]);
  return { items: rows.map(row => ({ id: row.id, sku: row.sku, nameEn: row.nameEn, nameAr: row.nameAr,
    isVariant: Boolean(row.variantGroupId), variantGroupTitleEn: row.variantGroupTitleEn || null, variantValueEn: row.variantValueEn || null,
    unitProfile: { baseUnitCode: row.baseUnitCode || 'unit', baseUnitLabel: row.baseUnitLabel || '', baseUnitLabelAr: row.baseUnitLabelAr || '',
      quantityPrecision: Number(row.quantityPrecision || 0), quantityIncrement: String(row.quantityIncrement || '1.000000'), revision: Number(row.unitRevision || 0) } })),
    locations: locations.map(row => ({id:row.id,code:row.code,nameEn:row.nameEn,nameAr:row.nameAr})) };
}
async function connectionReconciliation(pool, connection) {
  const tenantId = connection.tenant_id, id = connection.id;
  const [[counts]] = await pool.query(`SELECT
    (SELECT COUNT(*) FROM sx_retail_external_products WHERE tenant_id=? AND connection_id=? AND product_status<>'deleted') AS products,
    (SELECT COUNT(*) FROM sx_retail_external_product_variants WHERE tenant_id=? AND connection_id=? AND variant_status<>'deleted') AS variations,
    (SELECT COUNT(*) FROM sx_retail_external_orders WHERE tenant_id=? AND connection_id=?) AS orders,
    (SELECT COUNT(*) FROM sx_retail_external_customers WHERE tenant_id=? AND connection_id=? AND customer_status='active') AS customers,
    (SELECT COUNT(*) FROM sx_retail_external_checkouts WHERE tenant_id=? AND connection_id=?) AS checkouts`,
  [tenantId,id,tenantId,id,tenantId,id,tenantId,id,tenantId,id]);
  const [localOrderAmounts] = await pool.query(`SELECT currency,order_status AS status,financial_status AS financialStatus,COUNT(*) AS count,
    CAST(SUM(total_amount) AS CHAR) AS total,CAST(SUM(subtotal_amount) AS CHAR) AS subtotal,
    CAST(SUM(discount_amount) AS CHAR) AS discount,CAST(SUM(shipping_amount) AS CHAR) AS shipping,
    CAST(SUM(tax_amount) AS CHAR) AS tax,CAST(SUM(fee_amount) AS CHAR) AS fees,CAST(SUM(refund_amount) AS CHAR) AS refunds
    FROM sx_retail_external_orders WHERE tenant_id=? AND connection_id=? GROUP BY currency,order_status,financial_status
    ORDER BY currency,order_status,financial_status`, [tenantId,id]);
  const [[skuMissing]] = await pool.query(`SELECT
    (SELECT COUNT(*) FROM sx_retail_external_products WHERE tenant_id=? AND connection_id=? AND product_status<>'deleted' AND NULLIF(TRIM(sku),'') IS NULL) AS products,
    (SELECT COUNT(*) FROM sx_retail_external_product_variants WHERE tenant_id=? AND connection_id=? AND variant_status<>'deleted' AND NULLIF(TRIM(sku),'') IS NULL) AS variations`,
  [tenantId,id,tenantId,id]);
  const [[mappingCounts]] = await pool.query(`SELECT
    SUM(mapping_status='mapped') AS mapped,SUM(mapping_status='ignored') AS ignored,
    SUM(m.mapping_status='mapped' AND (p.id IS NULL OR p.status<>'active' OR p.deleted_at IS NOT NULL)) AS invalidTargets
    FROM sx_retail_external_product_mappings m
    LEFT JOIN sx_product_catalog p ON p.tenant_id=m.tenant_id AND p.id=m.target_product_id
    WHERE m.tenant_id=? AND m.connection_id=?`,[tenantId,id]);
  const [[stockMappings]] = await pool.query(`SELECT
    COUNT(*) AS mapped,
    SUM(sourceStockManagement='managed' AND sourceStockQuantity IS NOT NULL) AS quantityManaged,
    SUM(sourceStockManagement='managed' AND sourceStockQuantity IS NULL) AS managedQuantityUnavailable,
    SUM(sourceStockManagement='unknown') AS sourceStockSnapshotUnknown,
    SUM(externalVariantId<>'' AND sourceStockManagement='parent') AS parentShared,
    SUM(sourceStockManagement='managed' AND sourceStockQuantity IS NOT NULL AND
      sourceUnitConfirmed=1 AND stockScope IN ('single_location','aggregate') AND
      targetUnitRevision=currentUnitRevision AND ROUND(sourceStockQuantity,quantityPrecision)=sourceStockQuantity AND
      MOD(ABS(sourceStockQuantity),quantityIncrement)=0 AND
      (stockScope<>'single_location' OR targetLocationStatus='active')) AS readyForReadOnlyComparison
    FROM (
      SELECT m.external_variant_id AS externalVariantId,m.stock_scope AS stockScope,
        m.source_unit_confirmed AS sourceUnitConfirmed,m.target_unit_revision AS targetUnitRevision,
        COALESCE(iu.revision,0) AS currentUnitRevision,COALESCE(iu.quantity_precision,0) AS quantityPrecision,
        COALESCE(iu.quantity_increment,1.000000) AS quantityIncrement,loc.status AS targetLocationStatus,
        CASE WHEN m.external_variant_id='' THEN p.source_stock_management ELSE v.source_stock_management END AS sourceStockManagement,
        CASE WHEN m.external_variant_id='' THEN p.source_stock_quantity ELSE v.source_stock_quantity END AS sourceStockQuantity
      FROM sx_retail_external_product_mappings m
      LEFT JOIN sx_retail_external_products p ON p.tenant_id=m.tenant_id AND p.connection_id=m.connection_id AND p.external_product_id=m.external_product_id
      LEFT JOIN sx_retail_external_product_variants v ON v.tenant_id=m.tenant_id AND v.connection_id=m.connection_id AND
        v.external_product_id=m.external_product_id AND v.external_variant_id=m.external_variant_id
      LEFT JOIN sx_product_catalog target ON target.tenant_id=m.tenant_id AND target.id=m.target_product_id
      LEFT JOIN sx_retail_product_inventory_units iu ON iu.tenant_id=target.tenant_id AND iu.product_id=target.id
      LEFT JOIN sx_retail_locations loc ON loc.tenant_id=m.tenant_id AND loc.id=m.target_location_id
      WHERE m.tenant_id=? AND m.connection_id=? AND m.mapping_status='mapped'
    ) source_mappings`,[tenantId,id]);
  const skuSourceSql = `SELECT UPPER(TRIM(sku)) AS normalizedSku FROM sx_retail_external_products
    WHERE tenant_id=? AND connection_id=? AND product_status<>'deleted' AND NULLIF(TRIM(sku),'') IS NOT NULL
    UNION ALL SELECT UPPER(TRIM(sku)) AS normalizedSku FROM sx_retail_external_product_variants
    WHERE tenant_id=? AND connection_id=? AND variant_status<>'deleted' AND NULLIF(TRIM(sku),'') IS NOT NULL`;
  const [duplicateSkus] = await pool.query(`SELECT normalizedSku AS sku,COUNT(*) AS count FROM (${skuSourceSql}) sku_rows
    GROUP BY normalizedSku HAVING COUNT(*)>1 ORDER BY normalizedSku LIMIT 100`, [tenantId,id,tenantId,id]);
  const [[duplicateSkuSummary]] = await pool.query(`SELECT COUNT(*) AS count FROM (SELECT normalizedSku FROM (${skuSourceSql}) sku_rows
    GROUP BY normalizedSku HAVING COUNT(*)>1) duplicates`, [tenantId,id,tenantId,id]);
  const woo = connection.provider === 'woocommerce' ? parseJson(connection.sync_cursor, {}).woocommerce || {} : null;
  const scan = woo?.lastCompleteScan || null;
  const scanResources = ['products','orders','customers'];
  const sourceCountMetadataAvailable = Boolean(scan && scanResources.every(resource => {
    const item = scan.sourceCounts?.[resource];
    return item && item.total != null && item.total !== '' && item.scanned != null && item.scanned !== '' &&
      Number.isSafeInteger(Number(item.total)) && Number.isSafeInteger(Number(item.scanned)) &&
      typeof item.sourceChangedDuringScan === 'boolean';
  }));
  const stableSourceCounts = Boolean(sourceCountMetadataAvailable && scanResources.every(resource => scan.sourceCounts[resource].sourceChangedDuringScan === false));
  const countsFullyScanned = Boolean(sourceCountMetadataAvailable && scanResources.every(resource =>
    Number(scan.sourceCounts[resource].total) === Number(scan.sourceCounts[resource].scanned)));
  const sourceOrderAmounts = scan?.orderAmounts && typeof scan.orderAmounts === 'object' && !Array.isArray(scan.orderAmounts)
    ? Object.values(scan.orderAmounts) : null;
  const sourceOrderAmountCount = sourceOrderAmounts && sourceOrderAmounts.every(row => row && Number.isSafeInteger(Number(row.count)) && Number(row.count) >= 0)
    ? sourceOrderAmounts.reduce((sum, row) => sum + Number(row.count), 0) : null;
  const orderAmountMetadataAvailable = Boolean(sourceOrderAmounts && Number.isSafeInteger(sourceOrderAmountCount) &&
    sourceOrderAmountCount === Number(scan?.sourceCounts?.orders?.scanned));
  const scanComparable = Boolean(sourceCountMetadataAvailable && countsFullyScanned && orderAmountMetadataAvailable);
  const orderReconciliation = compareOrderAmountGroups(scan?.orderAmounts ? Object.values(scan.orderAmounts) : [], localOrderAmounts,
    scanComparable, stableSourceCounts);
  const sourceRecordCounts = {
    products: scan?.sourceCounts?.products?.total,
    variations: scan?.sourceVariationCount,
    orders: scan?.sourceCounts?.orders?.total,
    customers: scan?.sourceCounts?.customers?.total,
  };
  const recordRows = Object.entries(sourceRecordCounts).map(([resource,sourceCount]) => {
    const source = sourceCount === null || sourceCount === undefined || sourceCount === '' ? null : Number(sourceCount);
    const imported = Number(counts?.[resource]);
    const valid = source !== null && Number.isSafeInteger(source) && Number.isSafeInteger(imported);
    return { resource, sourceCount: valid ? source : null, importedCount: Number.isSafeInteger(imported) ? imported : 0,
      delta: valid ? imported - source : null, state: !valid ? 'unavailable' : imported === source ? 'matched' : 'mismatch' };
  });
  const recordReconciliationState = !scan || !sourceCountMetadataAvailable || !countsFullyScanned ? 'scan_incomplete' :
    !stableSourceCounts ? 'source_changed' : recordRows.some(item => item.state === 'unavailable') ? 'needs_review' :
      recordRows.some(item => item.state === 'mismatch') ? 'mismatch' : 'matched';
  return { provider: connection.provider, importedCounts: Object.fromEntries(Object.entries(counts).map(([key,value]) => [key, Number(value)])),
    recordReconciliation: { state: recordReconciliationState, records: recordRows },
    productMappings: { mapped: Number(mappingCounts?.mapped||0), ignored: Number(mappingCounts?.ignored||0), invalidTargets: Number(mappingCounts?.invalidTargets||0),
      stock: { mapped: Number(stockMappings?.mapped||0), quantityManaged: Number(stockMappings?.quantityManaged||0),
        managedQuantityUnavailable: Number(stockMappings?.managedQuantityUnavailable||0),
        sourceStockSnapshotUnknown: Number(stockMappings?.sourceStockSnapshotUnknown||0),parentShared: Number(stockMappings?.parentShared||0),
        readyForReadOnlyComparison: Number(stockMappings?.readyForReadOnlyComparison||0),
        needsReview: Math.max(0,Number(stockMappings?.quantityManaged||0)-Number(stockMappings?.readyForReadOnlyComparison||0)) } },
    lastSyncAt: connection.last_sync_at, lastErrorCode: connection.last_error_code,
    scan: scan ? { startedAt: scan.startedAt, completedAt: scan.completedAt, queryScope: scan.queryScope || null, sourceCounts: scan.sourceCounts || {},
      sourceVariationCount: scan.sourceVariationCount ?? null, sourceOrderAmounts: Object.values(scan.orderAmounts || {}),
      sourceCountMetadataAvailable, countsFullyScanned, orderAmountMetadataAvailable, stableSourceCounts } : null,
    orderReconciliation,
    currentProgress: woo ? { scanStartedAt: woo.scanStartedAt || null, pendingVariationParents: (woo.variationQueue || []).length,
      resources: Object.fromEntries(['products','orders','customers'].map(resource => [resource, {
        complete: Boolean(woo[resource]?.complete), page: Number(woo[resource]?.page) || 1,
        sourceTotal: woo[resource]?.sourceTotal ?? null, scanned: Number(woo[resource]?.scanned) || 0,
      }])) } : null,
    skuAudit: { missingProductSku: Number(skuMissing.products), missingVariationSku: Number(skuMissing.variations),
      duplicateSkuCount: Number(duplicateSkuSummary.count), duplicateSkus: duplicateSkus.map(row => ({ sku: row.sku, count: Number(row.count) })) },
    localOrderAmounts: localOrderAmounts.map(row => Object.fromEntries(Object.entries(row).map(([key,value]) =>
      [key, value == null ? null : ['total','subtotal','discount','shipping','tax','fees','refunds'].includes(key) ? String(value) : key === 'count' ? Number(value) : value]))),
  };
}
function compareOrderAmountGroups(sourceRows, localRows, hasCompleteScan, stableSourceCounts) {
  if (!hasCompleteScan) return { state: 'scan_incomplete', groups: [] };
  const keyFor = row => `${row.currency || ''}|${row.status || 'unknown'}|${row.financialStatus || 'unknown'}`;
  const source = new Map((Array.isArray(sourceRows) ? sourceRows : []).map(row => [keyFor(row), row]));
  const local = new Map((Array.isArray(localRows) ? localRows : []).map(row => [keyFor(row), row]));
  const amountFields = [['total','total'],['subtotal','subtotal'],['discount','discount'],['shipping','shipping'],['tax','tax'],['fees','fee'],['refunds','refund']];
  const groups = [...new Set([...source.keys(), ...local.keys()])].sort().map(key => {
    const sourceRow = source.get(key) || null, localRow = local.get(key) || null;
    const sourceCount = Number(sourceRow?.count || 0), localCount = Number(localRow?.count || 0);
    let state = sourceCount === localCount ? 'matched' : 'mismatch';
    const amounts = {};
    for (const [name, sourceField] of amountFields) {
      const sourceComplete = sourceCount === 0 || sourceRow?.[`${sourceField}Complete`] !== false && sourceRow?.[sourceField] != null;
      const sourceValue = sourceCount === 0 ? '0.000000' : sourceComplete ? String(sourceRow[sourceField]) : null;
      const localValue = localRow?.[name] == null ? '0.000000' : String(localRow[name]);
      if (!sourceComplete) {
        amounts[name] = { source: null, local: localValue, delta: null, state: 'unavailable' };
        if (state === 'matched') state = 'needs_review';
        continue;
      }
      let normalizedSource, normalizedLocal;
      try {
        normalizedSource = connector.safeAmount(sourceValue);
        normalizedLocal = connector.safeAmount(localValue);
      } catch {
        amounts[name] = { source: sourceValue, local: localValue, delta: null, state: 'unavailable' };
        if (state === 'matched') state = 'needs_review';
        continue;
      }
      const delta = connector.decimalAdd([normalizedLocal, connector.decimalNegate(normalizedSource)]);
      const amountState = delta === '0.000000' ? 'matched' : 'mismatch';
      amounts[name] = { source: normalizedSource, local: normalizedLocal, delta, state: amountState };
      if (amountState === 'mismatch') state = 'mismatch';
    }
    return { currency: sourceRow?.currency || localRow?.currency || '', status: sourceRow?.status || localRow?.status || 'unknown',
      financialStatus: sourceRow?.financialStatus || localRow?.financialStatus || 'unknown', sourceCount, localCount,
      countDelta: localCount - sourceCount, amounts, state };
  });
  const state = !stableSourceCounts ? 'source_changed' : groups.some(group => group.state === 'mismatch') ? 'mismatch' :
    groups.some(group => group.state === 'needs_review') ? 'needs_review' : 'matched';
  return { state, groups };
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
      if (connection.provider === 'woocommerce' && Number(parsed?.parent_id) > 0) {
        if (/delete/.test(topic)) {
          await connector.upsertProductVariation(db, connection, parsed.parent_id, parsed);
          await connector.markProductVariationDeleted(db, connection, parsed.parent_id, parsed.id, parsed.date_modified_gmt || parsed.date_modified);
        } else await connector.upsertProductVariation(db, connection, parsed.parent_id, parsed);
      } else if (/delete/.test(topic)) {
        const productId = connection.provider === 'shopify' ? connector.canonicalShopifyId('Product', externalId) : externalId;
        await db.query(`UPDATE sx_retail_external_products SET product_status='deleted',source_updated_at=COALESCE(?,source_updated_at)
          WHERE tenant_id=? AND connection_id=? AND external_product_id=? AND (? IS NULL OR source_updated_at IS NULL OR source_updated_at<=?)`,
        [connector.dateOrNull(parsed?.date_modified_gmt || parsed?.updated_at), connection.tenant_id, connection.id, productId,
          connector.dateOrNull(parsed?.date_modified_gmt || parsed?.updated_at), connector.dateOrNull(parsed?.date_modified_gmt || parsed?.updated_at)]);
        if (connection.provider === 'woocommerce') await connector.markProductVariationsDeleted(db, connection, productId, parsed?.date_modified_gmt || parsed?.updated_at);
      } else await connector.upsertProduct(db, connection, parsed);
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
async function webhookConnectionDetails(pool,provider,id,tenantId){
  const [[connection]]=await pool.query(`SELECT id,tenant_id,provider,store_domain,status,webhook_secret_ciphertext,webhook_secret_iv,webhook_secret_auth_tag
    FROM sx_retail_store_connections WHERE id=? AND tenant_id=? AND provider=?`,[id,tenantId,provider]);
  return connection||null;
}
async function webhookConnection(pool, provider, id, env=process.env) {
  if (!connector.validateId(id)) fail('WEBHOOK_NOT_FOUND', 404);
  const [[identity]]=await pool.query(`SELECT tenant_id FROM sx_retail_store_connections WHERE id=? AND provider=?`,[id,provider]);
  if(!identity||!connectorPilot.isPilotTenant(identity.tenant_id,env))return null;
  return webhookConnectionDetails(pool,provider,id,identity.tenant_id);
}

function workspaceRouter({ pool, authenticate, origin, env=process.env }) {
  const router = express.Router();
  const owner = fn => handle(async (req, res) => {
    const context = req.businessContext;
    if (!decision(context, { capability: 'retail.commerce', permission: 'retail.connect' }).allowed) return res.sendStatus(403);
    return fn(req, res, context);
  });
  router.use(noStore, authenticate, express.json({ limit: '16kb' }), (req,res,next)=>{
    if(!connectorPilot.isPilotTenant(req.businessContext?.tenant?.id,env))return res.status(403).json({success:false,code:'RETAIL_CONNECTOR_PILOT_DISABLED'});
    next();
  });
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
    reply(res, { connection: { id, provider: 'woocommerce', storeDomain: storeUrl, displayName, currency, status: 'active' } });
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
    const page = Number(req.query.page || 1), rows = await connectionData(pool, connection, req.params.kind, page, req.query.productId);
    reply(res, { items: rows.slice(0, 50), page, hasMore: rows.length > 50 });
  }));

  router.get('/:id/mappings', owner(async (req,res,context) => {
    const connection=await loadConnection(pool,context.tenant.id,req.params.id);
    if(connection.status==='pending')fail('STORE_CONNECTION_NOT_READY',409);
    reply(res,await productMappingDetails(pool,connection,String(req.query.productId||''),req.query.page));
  }));

  router.get('/:id/mapping-options', owner(async (req,res,context) => {
    const connection=await loadConnection(pool,context.tenant.id,req.params.id);
    if(connection.status==='pending')fail('STORE_CONNECTION_NOT_READY',409);
    if(connection.provider!=='woocommerce')fail('INVALID_PRODUCT_MAPPING_SOURCE',400);
    reply(res,await mappingTargets(pool,context.tenant.id,req.query.search));
  }));

  router.put('/:id/mappings', owner(async (req,res,context) => {
    const connection=await loadConnection(pool,context.tenant.id,req.params.id),input=normalizeMappingWrite(req.body);
    if(connection.provider!=='woocommerce')fail('INVALID_PRODUCT_MAPPING_SOURCE',400);
    const db=await pool.getConnection();
    try{
      await db.beginTransaction();
      const [[lockedConnection]]=await db.query(`SELECT id,status,provider FROM sx_retail_store_connections
        WHERE tenant_id=? AND id=? FOR UPDATE`,[context.tenant.id,connection.id]);
      if(!lockedConnection||lockedConnection.provider!=='woocommerce')fail('STORE_CONNECTION_NOT_FOUND',404);
      if(!['active','paused'].includes(lockedConnection.status))fail('STORE_CONNECTION_NOT_ACTIVE',409);
      const [[productRow]]=await db.query(`SELECT product_status AS status,sku,product_ciphertext AS ciphertext,product_iv AS iv,product_auth_tag AS authTag,
        source_stock_management AS sourceStockManagement,
        CAST(source_stock_quantity AS CHAR) AS sourceStockQuantity,source_stock_status AS sourceStockStatus
        FROM sx_retail_external_products WHERE tenant_id=? AND connection_id=? AND external_product_id=? AND product_status<>'deleted' FOR UPDATE`,
      [context.tenant.id,connection.id,input.externalProductId]);
      if(!productRow)fail('STORE_PRODUCT_NOT_FOUND',404);
      const product=jsonFromEncrypted(productRow,context.tenant.id,connection.id,`product:${input.externalProductId}`);
      let sourceStock=sourceStockFromRow(productRow,product.sourceStock||null),parentStock=null;
      let sourceStatus=productRow.status,sourceSku=productRow.sku,purchasable=true,sourceType=product.productType;
      if(input.externalVariationId){
        if(sourceType!=='variable'||productRow.status!=='publish')fail('INVALID_PRODUCT_MAPPING_SOURCE',409);
        const [[variantRow]]=await db.query(`SELECT variant_status AS status,sku,variant_ciphertext AS ciphertext,variant_iv AS iv,variant_auth_tag AS authTag,
          source_stock_management AS sourceStockManagement,
          CAST(source_stock_quantity AS CHAR) AS sourceStockQuantity,source_stock_status AS sourceStockStatus
          FROM sx_retail_external_product_variants WHERE tenant_id=? AND connection_id=? AND external_product_id=? AND external_variant_id=?
            AND variant_status<>'deleted' FOR UPDATE`,[context.tenant.id,connection.id,input.externalProductId,input.externalVariationId]);
        if(!variantRow)fail('STORE_VARIATION_NOT_FOUND',404);
        const variant=jsonFromEncrypted(variantRow,context.tenant.id,connection.id,`product-variant:${input.externalVariationId}`);
        sourceStock=sourceStockFromRow(variantRow,variant.sourceStock||null);
        parentStock=sourceStock?.managementMode==='parent'?sourceStockFromRow(productRow,product.sourceStock||null):null;
        sourceStatus=variantRow.status;sourceSku=variantRow.sku;purchasable=variant.purchasable!==false;
      }else if(sourceType!=='simple')fail('INVALID_PRODUCT_MAPPING_SOURCE',409);
      if(sourceStatus!=='publish'||!purchasable)fail('STORE_PRODUCT_NOT_MAPPABLE',409);
      if(input.expectedSku!==sourceSku)fail('STORE_PRODUCT_SOURCE_CHANGED',409);

      const [[existing]]=await db.query(`SELECT id,mapping_status AS mappingStatus,target_product_id AS targetProductId,stock_scope AS stockScope,
        target_location_id AS targetLocationId,source_unit_confirmed AS sourceUnitConfirmed,target_unit_revision AS targetUnitRevision,revision
        FROM sx_retail_external_product_mappings WHERE tenant_id=? AND connection_id=? AND external_product_id=? AND external_variant_id=? FOR UPDATE`,
      [context.tenant.id,connection.id,input.externalProductId,input.externalVariationId]);
      const nextStatus=input.action==='map'?'mapped':input.action==='ignore'?'ignored':'unmapped';
      const same= input.action==='clear' ? !existing : Boolean(existing&&existing.mappingStatus===nextStatus&&existing.targetProductId===input.targetProductId&&
        (existing.stockScope||'unverified')===input.stockScope&&(existing.targetLocationId||null)===input.targetLocationId&&
        Boolean(Number(existing.sourceUnitConfirmed))===input.sourceUnitConfirmed&&
        (existing.targetUnitRevision==null?null:Number(existing.targetUnitRevision))===input.expectedUnitRevision);
      if(same){await db.commit();return reply(res,{id:existing?.id||null,status:nextStatus,revision:Number(existing?.revision||0),replayed:true});}
      if(Number(existing?.revision||0)!==input.expectedRevision)fail('STORE_PRODUCT_MAPPING_CONFLICT',409);

      let targetSku=null;
      let targetUnitRevision=null;
      if(input.action==='map'){
        const [[target]]=await db.query(`SELECT id,code FROM sx_product_catalog WHERE tenant_id=? AND id=? AND status='active' AND deleted_at IS NULL FOR UPDATE`,
        [context.tenant.id,input.targetProductId]);
        if(!target)fail('MAPPING_TARGET_NOT_FOUND',404);
        targetSku=target.code;
        const hasIndependentStock=Boolean(sourceStock?.managed&&sourceStock.quantity!=null&&!parentStock?.managed);
        if(input.stockScope!=='unverified'&&!hasIndependentStock)fail('PRODUCT_STOCK_SCOPE_UNAVAILABLE',409);
        if(input.stockScope!=='unverified'){
          const [[unit]]=await db.query(`SELECT base_unit_code AS baseUnitCode,base_unit_label AS baseUnitLabel,base_unit_label_ar AS baseUnitLabelAr,
            quantity_precision AS quantityPrecision,CAST(quantity_increment AS CHAR) AS quantityIncrement,revision
            FROM sx_retail_product_inventory_units WHERE tenant_id=? AND product_id=? FOR UPDATE`,[context.tenant.id,target.id]);
          targetUnitRevision=Number(unit?.revision||0);
          if(targetUnitRevision!==input.expectedUnitRevision)fail('PRODUCT_INVENTORY_UNIT_CHANGED',409);
          if(!stockQuantityFitsUnit(sourceStock.quantity,unit))fail('WOOCOMMERCE_STOCK_UNIT_MISMATCH',409);
          if(input.stockScope==='single_location'){
            const [[location]]=await db.query(`SELECT id FROM sx_retail_locations WHERE tenant_id=? AND id=? AND status='active' FOR UPDATE`,
              [context.tenant.id,input.targetLocationId]);
            if(!location)fail('RETAIL_LOCATION_NOT_ACTIVE',409);
          }
        }
      }
      const mappingId=existing?.id||crypto.randomUUID(),revision=Number(existing?.revision||0)+1;
      const savedStockScope=input.action==='map'?input.stockScope:'unverified';
      const savedLocationId=input.action==='map'?input.targetLocationId:null;
      const savedUnitConfirmed=input.action==='map'&&input.sourceUnitConfirmed?1:0;
      const savedUnitRevision=input.action==='map'?targetUnitRevision:null;
      if(input.action==='clear'){
        await db.query(`DELETE FROM sx_retail_external_product_mappings WHERE tenant_id=? AND connection_id=? AND id=?`,
        [context.tenant.id,connection.id,mappingId]);
      }else if(existing){
        const [updated]=await db.query(`UPDATE sx_retail_external_product_mappings SET mapping_status=?,target_product_id=?,stock_scope=?,target_location_id=?,
          source_unit_confirmed=?,target_unit_revision=?,revision=revision+1,
          updated_by_identity_id=? WHERE tenant_id=? AND connection_id=? AND id=? AND revision=?`,
        [nextStatus,input.targetProductId,savedStockScope,savedLocationId,savedUnitConfirmed,savedUnitRevision,
          context.identity.id,context.tenant.id,connection.id,mappingId,input.expectedRevision]);
        if(!updated.affectedRows)fail('STORE_PRODUCT_MAPPING_CONFLICT',409);
      }else{
        await db.query(`INSERT INTO sx_retail_external_product_mappings(id,tenant_id,connection_id,external_product_id,external_variant_id,
          mapping_status,target_product_id,stock_scope,target_location_id,source_unit_confirmed,target_unit_revision,revision,created_by_identity_id,updated_by_identity_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[mappingId,context.tenant.id,connection.id,input.externalProductId,input.externalVariationId,
          nextStatus,input.targetProductId,savedStockScope,savedLocationId,savedUnitConfirmed,savedUnitRevision,revision,context.identity.id,context.identity.id]);
      }
      await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
        VALUES (?, ?, ?, 'identity', ?, 'retail-store-product-mapping', ?, ?, ?)`,
      [crypto.randomUUID(),context.tenant.id,context.identity.id,
        input.action==='map'?'retail.store-product-mapped':input.action==='ignore'?'retail.store-product-ignored':'retail.store-product-mapping-cleared',
        mappingId,JSON.stringify({connectionId:connection.id,externalProductId:input.externalProductId,
          externalVariationId:input.externalVariationId||null,mappingStatus:nextStatus,targetProductId:input.targetProductId,
          sourceSku,targetSku,stockScope:savedStockScope,targetLocationId:savedLocationId,sourceUnitConfirmed:Boolean(savedUnitConfirmed),
          targetUnitRevision:savedUnitRevision,revision}),crypto.randomUUID()]);
      await db.commit();
      reply(res,{id:mappingId,status:nextStatus,revision,replayed:false,stockScope:savedStockScope,
        targetLocationId:savedLocationId,targetUnitRevision:savedUnitRevision});
    }catch(error){
      try{await db.rollback();}catch{}
      if(error.code==='ER_DUP_ENTRY')fail('STORE_PRODUCT_MAPPING_CONFLICT',409);
      throw error;
    }finally{db.release();}
  }));

  router.get('/:id/reconciliation', owner(async (req, res, context) => {
    const connection = await loadConnection(pool, context.tenant.id, req.params.id);
    if (connection.status === 'pending') fail('STORE_CONNECTION_NOT_READY', 409);
    reply(res, await connectionReconciliation(pool, connection));
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
      for (const table of ['sx_retail_external_product_mappings','sx_retail_external_transactions','sx_retail_external_orders','sx_retail_external_checkouts',
        'sx_retail_external_customers','sx_retail_external_product_variants','sx_retail_external_products','sx_retail_external_events','sx_retail_store_privacy_requests']) {
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

async function callbackShopify(pool, req, res, origin, env=process.env) {
  let connectionId = null;
  try {
    const context = req.businessContext;
    if(!connectorPilot.isPilotTenant(context?.tenant?.id,env))fail('RETAIL_CONNECTOR_PILOT_DISABLED',403);
    const config = shopifyConfig();
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

async function handleWebhook(pool, provider, connection, req, res, env=process.env) {
  if (!connection || !Buffer.isBuffer(req.body)) return res.sendStatus(404);
  if(!connectorPilot.isPilotTenant(connection.tenant_id,env))return res.sendStatus(404);
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

function publicRouter({ pool, authenticate, origin, env=process.env }) {
  const router = express.Router();
  const oauthCallback = (req, res, next) => authenticate(req, res, () => callbackShopify(pool, req, res, origin,env).catch(next));
  router.get('/shopify/callback', noStore, oauthCallback);
  router.post('/shopify', noStore, express.raw({ type: 'application/json', limit: '2mb' }), handle(async (req, res) => {
    let shop;
    try { shop = connector.normalizeShop(req.get('X-Shopify-Shop-Domain')); } catch { return res.sendStatus(401); }
    const [[identity]]=await pool.query(`SELECT id,tenant_id FROM sx_retail_store_connections WHERE provider='shopify' AND store_domain=? LIMIT 1`,[shop]);
    if(!identity||!connectorPilot.isPilotTenant(identity.tenant_id,env))return res.sendStatus(404);
    const connection=await webhookConnectionDetails(pool,'shopify',identity.id,identity.tenant_id);
    return handleWebhook(pool, 'shopify', connection, req, res,env);
  }));
  router.post('/shopify/:id', noStore, express.raw({ type: 'application/json', limit: '2mb' }), handle(async (req, res) => {
    const connection = await webhookConnection(pool, 'shopify', req.params.id,env);
    return handleWebhook(pool, 'shopify', connection, req, res,env);
  }));
  router.post('/woocommerce/:id', noStore, express.raw({ type: 'application/json', limit: '2mb' }), handle(async (req, res) => {
    const connection = await webhookConnection(pool, 'woocommerce', req.params.id,env);
    return handleWebhook(pool, 'woocommerce', connection, req, res,env);
  }));
  router.get('/woocommerce-plugin', noStore, (req, res) => {
    const archive = buildConnectorArchive();
    res.set('X-Content-Type-Options', 'nosniff').set('Content-Disposition', 'attachment; filename="7network-retail-connector.zip"');
    return res.type('application/zip').set('Content-Length', String(archive.length)).send(archive);
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const clean = cleanError(error);
    return res.status(clean.status >= 400 && clean.status < 600 ? clean.status : 502).json({ success: false, code: clean.code });
  });
  return router;
}

module.exports = { workspaceRouter, publicRouter, syncShopify, syncWoo, connectionData, connectionReconciliation, compareOrderAmountGroups, processWebhook, listConnections };
