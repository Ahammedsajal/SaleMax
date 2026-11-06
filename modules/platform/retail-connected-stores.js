'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
const { URL } = require('node:url');

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHOP = /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/i;
const CURRENCY = /^[A-Z]{3}$/;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const fail = (code, status = 422) => { throw Object.assign(Error(code), { code, status }); };

function encryptionKey(env = process.env) {
  const value = env.SALEMAX_PLATFORM_KEY_BASE64;
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) fail('RETAIL_CONNECTOR_KEY_UNAVAILABLE', 503);
  const result = Buffer.from(value, 'base64');
  if (result.length !== 32 || result.toString('base64') !== value) fail('RETAIL_CONNECTOR_KEY_UNAVAILABLE', 503);
  return result;
}
function aad(tenantId, connectionId, kind) { return Buffer.from(`7network/retail-connector/v1\0${tenantId}\0${connectionId}\0${kind}`); }
function seal(value, tenantId, connectionId, kind, env = process.env) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(env), iv);
  cipher.setAAD(aad(tenantId, connectionId, kind));
  const data = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value), 'utf8');
  return { ciphertext: Buffer.concat([cipher.update(data), cipher.final()]), iv, authTag: cipher.getAuthTag() };
}
function open(row, tenantId, connectionId, kind, env = process.env) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(env), Buffer.from(row.iv));
  decipher.setAAD(aad(tenantId, connectionId, kind));
  decipher.setAuthTag(Buffer.from(row.authTag));
  return Buffer.concat([decipher.update(Buffer.from(row.ciphertext)), decipher.final()]);
}
function openJson(row, tenantId, connectionId, kind, env = process.env) {
  try { return JSON.parse(open(row, tenantId, connectionId, kind, env).toString('utf8')); }
  catch { fail('RETAIL_CONNECTOR_DATA_INVALID', 500); }
}
function normalizeShop(value) {
  if (typeof value !== 'string' || value.length > 255) fail('INVALID_STORE_DOMAIN', 400);
  const host = value.trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/$/, '');
  if (!SHOP.test(host)) fail('INVALID_STORE_DOMAIN', 400);
  return host;
}
function normalizeWooUrl(value) {
  if (typeof value !== 'string' || value.length > 255) fail('INVALID_STORE_DOMAIN', 400);
  let url; try { url = new URL(value); } catch { fail('INVALID_STORE_DOMAIN', 400); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
      url.pathname.includes('..') || net.isIP(host) || host === 'localhost' || host.endsWith('.local') ||
      host.endsWith('.internal') || host.endsWith('.test')) fail('INVALID_STORE_DOMAIN', 400);
  const path = url.pathname.replace(/\/+$/, '');
  return url.origin + path;
}
function safeAmount(value) {
  if (value === null || value === undefined || String(value).trim() === '') fail('INVALID_PROVIDER_AMOUNT', 422);
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > 1e14) fail('INVALID_PROVIDER_AMOUNT', 422);
  return n.toFixed(6);
}
function currency(value) {
  const c = String(value || '').toUpperCase();
  if (!CURRENCY.test(c)) fail('INVALID_PROVIDER_CURRENCY', 422);
  return c;
}
function canonicalShopifyId(type, value) {
  if (value === null || value === undefined || value === '') return null;
  const id = String(value);
  return /^\d+$/.test(id) ? `gid://shopify/${type}/${id}` : id;
}
function moneyAmount(row) {
  return row?.total_price ?? row?.total ?? row?.totalPriceSet?.shopMoney?.amount ?? row?.total_price_set?.shop_money?.amount ??
    row?.totalPrice ?? row?.price ?? row?.prices?.price ?? '0';
}
function moneyCurrency(row) {
  return row?.currency ?? row?.currencyCode ?? row?.totalPriceSet?.shopMoney?.currencyCode ??
    row?.total_price_set?.shop_money?.currency_code ?? row?.currency_code;
}
function customerOf(row, provider) {
  const c = row?.customer || {}, billing = row?.billing || {}, address = c.defaultAddress || c.default_address || billing;
  const rawId = c.id ?? row?.customer_id;
  const emailMarketingState = String(c.emailMarketingConsent?.marketingState || c.email_marketing_consent?.state || '').toUpperCase();
  const providerMarketingConsent = emailMarketingState === 'SUBSCRIBED' ? true : ['UNSUBSCRIBED','NOT_SUBSCRIBED','REDACTED'].includes(emailMarketingState) ? false :
    c.acceptsMarketing === true || c.accepts_marketing === true || row?.marketing_consent === true ? true :
      c.acceptsMarketing === false || c.accepts_marketing === false || row?.marketing_consent === false ? false : null;
  return {
    id: rawId == null || rawId === 0 ? null : provider === 'shopify' ? canonicalShopifyId('Customer', rawId) : String(rawId),
    email: c.email || billing.email || row?.email || null,
    phone: c.phone || billing.phone || row?.phone || null,
    firstName: c.first_name || c.firstName || billing.first_name || row?.first_name || null,
    lastName: c.last_name || c.lastName || billing.last_name || row?.last_name || null,
    marketingConsent: providerMarketingConsent === true ? 'granted' : providerMarketingConsent === false ? 'denied' : 'unknown',
    address: address && Object.keys(address).length ? {
      address1: address.address1 || address.address_1 || null, address2: address.address2 || address.address_2 || null,
      city: address.city || null, region: address.province || address.state || null,
      postalCode: address.zip || address.postcode || null, country: address.countryCodeV2 || address.country_code || address.country || null,
    } : null,
  };
}
function nodes(value) { return Array.isArray(value) ? value : Array.isArray(value?.nodes) ? value.nodes : Array.isArray(value?.edges) ? value.edges.map(edge => edge.node) : []; }
function normalizeTransactions(rows, orderCurrency) {
  return rows.map(tx => {
    const id = String(tx.id || tx.transaction_id || '');
    const amount = tx.amount ?? tx.amountSet?.shopMoney?.amount ?? tx.amountSet?.presentmentMoney?.amount ??
      tx.total ?? tx.totalRefundedSet?.shopMoney?.amount;
    if (!id || id.length > 191 || amount == null) return null;
    return { id, kind: String(tx.kind || tx.type || 'unknown').slice(0, 48),
      status: String(tx.status || 'unknown').toLowerCase().slice(0, 48),
      currency: currency(tx.currency || tx.amountSet?.shopMoney?.currencyCode || tx.amountSet?.presentmentMoney?.currencyCode ||
        tx.totalRefundedSet?.shopMoney?.currencyCode || orderCurrency),
      amount: safeAmount(amount), gateway: String(tx.gateway || tx.payment_method_title || tx.payment_method || '').slice(0, 100) || null,
      processed_at: tx.processed_at || tx.processedAt || tx.createdAt || tx.date_created_gmt || tx.date_created || null };
  }).filter(Boolean);
}
function normalizeLineItems(rows) {
  return rows.slice(0, 100).map(line => ({ id: line.id == null ? null : String(line.id).slice(0, 191),
    productId: line.product_id == null ? null : String(line.product_id),
    variantId: line.variant_id == null ? null : String(line.variant_id),
    title: String(line.title || line.name || line.product_title || '').slice(0, 255),
    sku: String(line.sku || '').slice(0, 100) || null,
    quantity: Math.max(0, Number(line.quantity) || 0),
    unitPrice: line.originalUnitPriceSet?.shopMoney?.amount ?? line.price ?? line.subtotal ?? null,
  }));
}
function normalizeCustomer(provider, row) {
  const customer = customerOf(row, provider);
  const id = row?.id == null ? customer.id : provider === 'shopify' ? canonicalShopifyId('Customer', row.id) : String(row.id);
  if (!id || id.length > 191) fail('INVALID_PROVIDER_CUSTOMER', 422);
  // Customer API rows carry their ID at row.id; customerOf only reads nested
  // order/customer payloads so an order ID can never be mistaken for this ID.
  return { ...customer, id, updatedAt: row.updated_at || row.updatedAt || null, source: provider };
}
function normalizeProduct(provider, row) {
  const id = row?.id == null ? '' : provider === 'shopify' ? canonicalShopifyId('Product', row.id) : String(row.id);
  if (!id || id.length > 191) fail('INVALID_PROVIDER_PRODUCT', 422);
  const variants = nodes(row.variants);
  const first = variants[0] || {};
  const price = row.price ?? first.price ?? row.priceRangeV2?.minVariantPrice?.amount ?? row.priceRange?.minVariantPrice?.amount ?? '0';
  const cur = row.currency || first.currency || first.currencyCode || row.priceRangeV2?.minVariantPrice?.currencyCode || row.currencyCode || 'QAR';
  const sourceImage = provider === 'woocommerce' ? row.images?.[0]?.src : row.featuredImage?.url || row.image?.src;
  let imageUrl = null;
  try {
    const image = new URL(sourceImage);
    const host = image.hostname.toLowerCase().replace(/\.$/, '');
    if (image.protocol === 'https:' && !image.username && !image.password && !image.port && !net.isIP(host) &&
        !['localhost','local','internal','test','invalid','example','home','lan','onion'].some(suffix => host === suffix || host.endsWith(`.${suffix}`)) &&
        host.split('.').length >= 2) imageUrl = image.toString();
  } catch { /* Image previews are optional; malformed or private URLs are omitted. */ }
  return { id, title: String(row.name || row.title || row.handle || id).slice(0, 255), sku: String(row.sku || first.sku || '').slice(0, 100) || null,
    status: String(row.status || 'unknown').toLowerCase().slice(0, 32), currency: currency(cur), price: safeAmount(price),
    imageUrl, variants, variantsTruncated: Boolean(row.variants?.pageInfo?.hasNextPage),
    updatedAt: row.date_modified_gmt || row.updatedAt || row.updated_at || null, source: provider };
}
function normalizeOrder(provider, row) {
  const id = row?.id == null ? '' : provider === 'shopify' ? canonicalShopifyId('Order', row.id) : String(row.id);
  if (!id || id.length > 191) fail('INVALID_PROVIDER_ORDER', 422);
  const financial = row.financial_status || row.displayFinancialStatus ||
    (row.date_paid || row.date_paid_gmt ? 'paid_reported_by_store' : row.status === 'refunded' ? 'refunded_reported_by_store' : 'unknown');
  let transactions = [...nodes(row.transactions)];
  if (provider === 'woocommerce' && row.transaction_id) transactions.push({
    id: String(row.transaction_id), kind: 'payment', type: 'payment', status: row.date_paid || row.date_paid_gmt ? 'reported_paid_by_store' : 'unverified',
    currency: row.currency, amount: row.total, gateway: row.payment_method_title || row.payment_method || null, processed_at: row.date_paid_gmt || row.date_paid || null,
  });
  for (const refund of row.refunds || []) {
    const refundTransactions = nodes(refund.transactions);
    if (refundTransactions.length) {
      transactions.push(...refundTransactions.map(transaction => ({ ...transaction, kind: transaction.kind || 'refund' })));
    } else {
      transactions.push({ id: `refund:${refund.id}`, kind: 'refund', status: 'recorded_by_store', currency: row.currency ||
        refund.totalRefundedSet?.shopMoney?.currencyCode, amount: refund.total ?? refund.totalRefundedSet?.shopMoney?.amount,
        gateway: row.payment_method || null, processed_at: refund.date_created_gmt || refund.date_created || refund.createdAt || null, refund });
    }
  }
  const totalSet = row.totalPriceSet || row.total_price_set;
  const orderCurrency = currency(moneyCurrency(row) || totalSet?.shopMoney?.currencyCode);
  transactions = normalizeTransactions(transactions, orderCurrency);
  const c = customerOf(row, provider);
  let contactConsent = 'unknown', contactConsentAt = null;
  if (provider === 'woocommerce' && Array.isArray(row.meta_data)) {
    const consent = row.meta_data.find(item => item?.key === '_7network_retail_followup_consent')?.value;
    if (consent === 'granted' || consent === 'denied') contactConsent = consent;
    contactConsentAt = row.meta_data.find(item => item?.key === '_7network_retail_followup_consent_at')?.value || null;
  }
  const orderStatus = row.status || (row.cancelledAt || row.cancelled_at ? 'cancelled' :
    row.displayFulfillmentStatus || (row.closed ? 'closed' : 'open'));
  return { id, number: String(row.name || row.number || row.order_number || id).slice(0, 80),
    status: String(orderStatus || 'unknown').toLowerCase().slice(0, 64), financialStatus: String(financial).toLowerCase().slice(0, 64),
    currency: orderCurrency, total: safeAmount(moneyAmount(row)), customerId: c.id, customer: c,
    contactConsent, contactConsentAt,
    lineItems: normalizeLineItems(nodes(row.lineItems || row.line_items)),
    lineItemsTruncated: Boolean(row.lineItems?.pageInfo?.hasNextPage || (Array.isArray(row.line_items) && row.line_items.length > 100)),
    transactionsTruncated: Boolean(row.transactions?.pageInfo?.hasNextPage || (row.refunds || []).some(refund => refund.transactions?.pageInfo?.hasNextPage)),
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null, source: provider };
}
function normalizeCheckout(provider, row, now = Date.now()) {
  const id = row?.id == null ? '' : provider === 'shopify' ? canonicalShopifyId('AbandonedCheckout', row.id) : String(row.id);
  if (!id || id.length > 191) fail('INVALID_PROVIDER_CHECKOUT', 422);
  const created = new Date(row.created_at || row.createdAt || row.created || now).getTime();
  const sourceStatus = String(row.status || '').toLowerCase();
  const recovered = Boolean(row.completed_at || row.completedAt || row.order_id || row.recoveryState === 'RECOVERED' || sourceStatus === 'recovered');
  const isAbandoned = sourceStatus === 'abandoned' || (!recovered && row.recoveryState === 'NOT_RECOVERED' && Number.isFinite(created) && now - created >= 60 * 60 * 1000) ||
    (!recovered && provider === 'shopify' && Number.isFinite(created) && now - created >= 60 * 60 * 1000);
  const status = recovered ? 'recovered' : sourceStatus === 'expired' || sourceStatus === 'closed' ? 'expired' :
    sourceStatus === 'payment_pending' ? 'payment_pending' : isAbandoned ? 'abandoned' : ['started','abandoned','recovered','expired','payment_pending'].includes(sourceStatus) ? sourceStatus : 'started';
  const customer = customerOf(row, provider);
  const consent = ['granted','denied','unknown'].includes(row.contactConsent) ? row.contactConsent : 'unknown';
  const totalSet = row.totalPriceSet || row.total_price_set;
  return { id, status, currency: currency(moneyCurrency(row) || totalSet?.shopMoney?.currencyCode), total: safeAmount(moneyAmount(row)),
    customerId: customer.id, customer, recoveryUrl: row.abandoned_checkout_url || row.abandonedCheckoutUrl || row.recoveryUrl || null,
    contactConsent: consent, consentAt: row.consentAt || null, lineItems: normalizeLineItems(nodes(row.lineItems || row.line_items)),
    lineItemsTruncated: Boolean(row.lineItems?.pageInfo?.hasNextPage || (Array.isArray(row.line_items) && row.line_items.length > 100)),
    createdAt: row.created_at || row.createdAt || null, updatedAt: row.updated_at || row.updatedAt || null, source: provider };
}
function shopifySignature(raw, signature, secret) {
  if (!Buffer.isBuffer(raw) || typeof signature !== 'string' || typeof secret !== 'string' || !secret) return false;
  let provided; try { provided = Buffer.from(signature, 'base64'); } catch { return false; }
  const expected = crypto.createHmac('sha256', secret).update(raw).digest();
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}
function shopifyQuerySignature(query, secret) {
  if (!query || typeof query !== 'object' || typeof query.hmac !== 'string' || !secret) return false;
  const provided = Buffer.from(query.hmac, 'hex');
  const message = Object.keys(query).filter(key => !['hmac','signature'].includes(key)).sort()
    .map(key => `${key}=${Array.isArray(query[key]) ? query[key].join(',') : query[key]}`).join('&');
  const expected = crypto.createHmac('sha256', secret).update(message).digest();
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}
function wooSignature(raw, signature, secret) {
  if (!Buffer.isBuffer(raw) || typeof signature !== 'string' || typeof secret !== 'string' || !secret) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(raw).digest('base64'));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function randomSecret() { return crypto.randomBytes(32).toString('base64url'); }
function validateId(id) { return typeof id === 'string' && UUID.test(id); }
function dateOrNull(value) { if (!value) return null; const date = new Date(value); return Number.isFinite(date.getTime()) ? date : null; }

function publicIpv4(address) {
  const p = address.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b,c] = p;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) || (a === 203 && b === 0 && c === 113));
}
async function pinnedIpv4(hostname, shopify = false) {
  if (shopify ? !SHOP.test(hostname) : net.isIP(hostname)) fail('INVALID_STORE_DOMAIN', 400);
  let found; try { found = await dns.lookup(hostname, { all: true, verbatim: true }); } catch { fail('PROVIDER_DNS_FAILED', 502); }
  const ipv4 = found.filter(item => item.family === 4);
  const addresses = ipv4.filter(item => publicIpv4(item.address));
  if (!addresses.length || addresses.length !== ipv4.length) fail('PROVIDER_HOST_REJECTED', 400);
  return addresses[0].address;
}
async function requestHttps(urlValue, { method = 'GET', headers = {}, body = null, shopify = false, maxBytes = MAX_RESPONSE_BYTES } = {}) {
  let url; try { url = new URL(urlValue); } catch { fail('PROVIDER_REQUEST_FAILED', 502); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.hostname === 'localhost') fail('INVALID_STORE_DOMAIN', 400);
  const address = await pinnedIpv4(url.hostname, shopify);
  const agent = new https.Agent({ keepAlive: false, lookup(host, options, callback) {
    if (options?.all) callback(null, [{ address, family: 4 }]); else callback(null, address, 4);
  }});
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, agent, servername: url.hostname, timeout: 10000 }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > maxBytes) { req.destroy(); reject(Object.assign(Error('PROVIDER_RESPONSE_TOO_LARGE'), { code: 'PROVIDER_RESPONSE_TOO_LARGE', status: 502 })); } else chunks.push(chunk); });
      res.on('end', () => {
        agent.destroy();
        const raw = Buffer.concat(chunks);
        if (res.statusCode >= 300 && res.statusCode < 400) return reject(Object.assign(Error('PROVIDER_REDIRECT_REJECTED'), { code: 'PROVIDER_REDIRECT_REJECTED', status: 502 }));
        let data = null;
        if (raw.length) { try { data = JSON.parse(raw.toString('utf8')); } catch { return reject(Object.assign(Error('PROVIDER_RESPONSE_INVALID'), { code: 'PROVIDER_RESPONSE_INVALID', status: 502 })); } }
        resolve({ status: res.statusCode, headers: res.headers, data });
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(Error('PROVIDER_TIMEOUT'), { code: 'PROVIDER_TIMEOUT', status: 502 })));
    req.on('error', error => { agent.destroy(); reject(error.code ? error : Object.assign(Error('PROVIDER_REQUEST_FAILED'), { code: 'PROVIDER_REQUEST_FAILED', status: 502 })); });
    if (body) req.write(body);
    req.end();
  });
}

async function upsertCustomer(db, connection, row) {
  const customer = normalizeCustomer(connection.provider, row);
  const encrypted = seal(customer, connection.tenant_id, connection.id, `customer:${customer.id}`);
  await db.query(`INSERT INTO sx_retail_external_customers
    (tenant_id,connection_id,external_customer_id,customer_status,customer_ciphertext,customer_iv,customer_auth_tag,source_updated_at)
    VALUES (?,?,?,'active',?,?,?,?) ON DUPLICATE KEY UPDATE customer_status='active',customer_ciphertext=VALUES(customer_ciphertext),
    customer_iv=VALUES(customer_iv),customer_auth_tag=VALUES(customer_auth_tag),source_updated_at=VALUES(source_updated_at),imported_at=UTC_TIMESTAMP(3)`,
  [connection.tenant_id, connection.id, customer.id, encrypted.ciphertext, encrypted.iv, encrypted.authTag, dateOrNull(customer.updatedAt)]);
  return customer;
}
async function upsertProduct(db, connection, row) {
  const normalizedRow = connection.provider === 'woocommerce' ? { ...row, currency: connection.default_currency || 'QAR' } : row;
  const product = normalizeProduct(connection.provider, normalizedRow);
  const encrypted = seal(product, connection.tenant_id, connection.id, `product:${product.id}`);
  await db.query(`INSERT INTO sx_retail_external_products
    (tenant_id,connection_id,external_product_id,product_status,currency,price,product_ciphertext,product_iv,product_auth_tag,source_updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE product_status=VALUES(product_status),currency=VALUES(currency),price=VALUES(price),
    product_ciphertext=VALUES(product_ciphertext),product_iv=VALUES(product_iv),product_auth_tag=VALUES(product_auth_tag),
    source_updated_at=VALUES(source_updated_at),imported_at=UTC_TIMESTAMP(3)`,
  [connection.tenant_id, connection.id, product.id, product.status, product.currency, product.price, encrypted.ciphertext, encrypted.iv,
    encrypted.authTag, dateOrNull(product.updatedAt)]);
  return product;
}
async function upsertOrder(db, connection, row) {
  const order = normalizeOrder(connection.provider, row);
  const customer = seal(order.customer, connection.tenant_id, connection.id, `order-customer:${order.id}`);
  const snapshot = seal(order, connection.tenant_id, connection.id, `order:${order.id}`);
  await db.query(`INSERT INTO sx_retail_external_orders
    (tenant_id,connection_id,external_order_id,order_number,order_status,financial_status,currency,total_amount,customer_external_id,
      contact_consent,consent_at,customer_ciphertext,customer_iv,customer_auth_tag,order_ciphertext,order_iv,order_auth_tag,source_updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE order_number=VALUES(order_number),order_status=VALUES(order_status),
    financial_status=VALUES(financial_status),currency=VALUES(currency),total_amount=VALUES(total_amount),customer_external_id=VALUES(customer_external_id),
    contact_consent=VALUES(contact_consent),consent_at=VALUES(consent_at),customer_ciphertext=VALUES(customer_ciphertext),customer_iv=VALUES(customer_iv),
    customer_auth_tag=VALUES(customer_auth_tag),order_ciphertext=VALUES(order_ciphertext),order_iv=VALUES(order_iv),
    order_auth_tag=VALUES(order_auth_tag),source_updated_at=VALUES(source_updated_at),imported_at=UTC_TIMESTAMP(3)`,
  [connection.tenant_id, connection.id, order.id, order.number, order.status, order.financialStatus, order.currency, order.total, order.customerId,
    order.contactConsent, dateOrNull(order.contactConsentAt), customer.ciphertext, customer.iv, customer.authTag, snapshot.ciphertext, snapshot.iv, snapshot.authTag,
    dateOrNull(order.updatedAt)]);
  for (const tx of order.transactions || []) {
    const txId = String(tx.id || tx.transaction_id || '');
    const amount = tx.amount ?? tx.amountSet?.shopMoney?.amount ?? tx.amountSet?.presentmentMoney?.amount ?? tx.total;
    if (!txId || amount == null) continue;
    const transactionCurrency = tx.currency || tx.amountSet?.shopMoney?.currencyCode || tx.amountSet?.presentmentMoney?.currencyCode || order.currency;
    const encrypted = seal(tx, connection.tenant_id, connection.id, `transaction:${txId}`);
    await db.query(`INSERT INTO sx_retail_external_transactions
      (tenant_id,connection_id,external_order_id,external_transaction_id,transaction_kind,transaction_status,currency,amount,gateway,processed_at,
        transaction_ciphertext,transaction_iv,transaction_auth_tag)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE external_order_id=VALUES(external_order_id),transaction_kind=VALUES(transaction_kind),
      transaction_status=VALUES(transaction_status),currency=VALUES(currency),amount=VALUES(amount),gateway=VALUES(gateway),processed_at=VALUES(processed_at),
      transaction_ciphertext=VALUES(transaction_ciphertext),transaction_iv=VALUES(transaction_iv),transaction_auth_tag=VALUES(transaction_auth_tag)`,
    [connection.tenant_id, connection.id, order.id, txId, String(tx.kind || tx.type || 'unknown').slice(0, 48),
      String(tx.status || 'unknown').toLowerCase().slice(0, 48), currency(transactionCurrency), safeAmount(amount),
      String(tx.gateway || tx.payment_method || '').slice(0, 100) || null, dateOrNull(tx.processed_at || tx.createdAt || tx.date_created_gmt),
      encrypted.ciphertext, encrypted.iv, encrypted.authTag]);
  }
  return order;
}
async function upsertTransaction(db, connection, externalOrderId, transaction) {
  const id = String(transaction.id || transaction.transaction_id || '');
  const amount = transaction.amount ?? transaction.amountSet?.shopMoney?.amount ?? transaction.amountSet?.presentmentMoney?.amount ?? transaction.total;
  if (!id || id.length > 191 || amount == null) fail('INVALID_PROVIDER_TRANSACTION', 422);
  const orderId = connection.provider === 'shopify' ? canonicalShopifyId('Order', externalOrderId) : String(externalOrderId);
  const txCurrency = transaction.currency || transaction.amountSet?.shopMoney?.currencyCode || transaction.amountSet?.presentmentMoney?.currencyCode || connection.default_currency;
  const safeTransaction = { id, kind: String(transaction.kind || transaction.type || 'unknown').slice(0, 48),
    status: String(transaction.status || 'unknown').toLowerCase().slice(0, 48), currency: currency(txCurrency), amount: safeAmount(amount),
    gateway: String(transaction.gateway || transaction.payment_method_title || transaction.payment_method || '').slice(0, 100) || null,
    processed_at: transaction.processed_at || transaction.processedAt || transaction.createdAt || transaction.date_created_gmt || null };
  const encrypted = seal(safeTransaction, connection.tenant_id, connection.id, `transaction:${id}`);
  await db.query(`INSERT INTO sx_retail_external_transactions
    (tenant_id,connection_id,external_order_id,external_transaction_id,transaction_kind,transaction_status,currency,amount,gateway,processed_at,
      transaction_ciphertext,transaction_iv,transaction_auth_tag)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE external_order_id=VALUES(external_order_id),transaction_kind=VALUES(transaction_kind),
    transaction_status=VALUES(transaction_status),currency=VALUES(currency),amount=VALUES(amount),gateway=VALUES(gateway),processed_at=VALUES(processed_at),
    transaction_ciphertext=VALUES(transaction_ciphertext),transaction_iv=VALUES(transaction_iv),transaction_auth_tag=VALUES(transaction_auth_tag)`,
  [connection.tenant_id, connection.id, orderId, id, safeTransaction.kind, safeTransaction.status, safeTransaction.currency,
    safeTransaction.amount, safeTransaction.gateway, dateOrNull(safeTransaction.processed_at), encrypted.ciphertext, encrypted.iv, encrypted.authTag]);
}
async function upsertCheckout(db, connection, row) {
  const checkout = normalizeCheckout(connection.provider, row);
  const customer = seal(checkout.customer, connection.tenant_id, connection.id, `checkout-customer:${checkout.id}`);
  const snapshot = seal(checkout, connection.tenant_id, connection.id, `checkout:${checkout.id}`);
  const recovery = checkout.recoveryUrl ? seal(Buffer.from(checkout.recoveryUrl), connection.tenant_id, connection.id, `recovery:${checkout.id}`) : null;
  await db.query(`INSERT INTO sx_retail_external_checkouts
    (tenant_id,connection_id,external_checkout_id,checkout_status,currency,total_amount,customer_external_id,contact_consent,consent_at,
      customer_ciphertext,customer_iv,customer_auth_tag,recovery_ciphertext,recovery_iv,recovery_auth_tag,checkout_ciphertext,checkout_iv,checkout_auth_tag,source_updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE checkout_status=VALUES(checkout_status),currency=VALUES(currency),
    total_amount=VALUES(total_amount),customer_external_id=VALUES(customer_external_id),contact_consent=VALUES(contact_consent),consent_at=VALUES(consent_at),
    customer_ciphertext=VALUES(customer_ciphertext),customer_iv=VALUES(customer_iv),customer_auth_tag=VALUES(customer_auth_tag),
    recovery_ciphertext=VALUES(recovery_ciphertext),recovery_iv=VALUES(recovery_iv),recovery_auth_tag=VALUES(recovery_auth_tag),
    checkout_ciphertext=VALUES(checkout_ciphertext),checkout_iv=VALUES(checkout_iv),checkout_auth_tag=VALUES(checkout_auth_tag),
    source_updated_at=VALUES(source_updated_at),imported_at=UTC_TIMESTAMP(3)`,
  [connection.tenant_id, connection.id, checkout.id, checkout.status, checkout.currency, checkout.total, checkout.customerId,
    checkout.contactConsent, dateOrNull(checkout.consentAt), customer.ciphertext, customer.iv, customer.authTag,
    recovery?.ciphertext || null, recovery?.iv || null, recovery?.authTag || null, snapshot.ciphertext, snapshot.iv, snapshot.authTag,
    dateOrNull(checkout.updatedAt)]);
  return checkout;
}
async function redactCustomer(db, connection, externalId) {
  const [orders] = await db.query(`SELECT external_order_id AS id,order_ciphertext AS ciphertext,order_iv AS iv,order_auth_tag AS authTag
    FROM sx_retail_external_orders WHERE tenant_id=? AND connection_id=? AND customer_external_id=?`, [connection.tenant_id, connection.id, externalId]);
  for (const row of orders) {
    const order = openJson(row, connection.tenant_id, connection.id, `order:${row.id}`);
    order.customer = null;
    delete order.billing; delete order.shipping;
    const encrypted = seal(order, connection.tenant_id, connection.id, `order:${row.id}`);
    await db.query(`UPDATE sx_retail_external_orders SET customer_external_id=NULL,contact_consent='unknown',customer_ciphertext=NULL,
      customer_iv=NULL,customer_auth_tag=NULL,order_ciphertext=?,order_iv=?,order_auth_tag=?
      WHERE tenant_id=? AND connection_id=? AND external_order_id=?`,
    [encrypted.ciphertext, encrypted.iv, encrypted.authTag, connection.tenant_id, connection.id, row.id]);
  }
  const [checkouts] = await db.query(`SELECT external_checkout_id AS id,checkout_ciphertext AS ciphertext,checkout_iv AS iv,checkout_auth_tag AS authTag
    FROM sx_retail_external_checkouts WHERE tenant_id=? AND connection_id=? AND customer_external_id=?`, [connection.tenant_id, connection.id, externalId]);
  for (const row of checkouts) {
    const checkout = openJson(row, connection.tenant_id, connection.id, `checkout:${row.id}`);
    checkout.customer = null; checkout.recoveryUrl = null;
    const encrypted = seal(checkout, connection.tenant_id, connection.id, `checkout:${row.id}`);
    await db.query(`UPDATE sx_retail_external_checkouts SET customer_external_id=NULL,contact_consent='unknown',consent_at=NULL,
      customer_ciphertext=NULL,customer_iv=NULL,customer_auth_tag=NULL,recovery_ciphertext=NULL,recovery_iv=NULL,recovery_auth_tag=NULL,
      checkout_ciphertext=?,checkout_iv=?,checkout_auth_tag=? WHERE tenant_id=? AND connection_id=? AND external_checkout_id=?`,
    [encrypted.ciphertext, encrypted.iv, encrypted.authTag, connection.tenant_id, connection.id, row.id]);
  }
  await db.query(`UPDATE sx_retail_external_customers SET customer_status='redacted',customer_ciphertext=NULL,customer_iv=NULL,customer_auth_tag=NULL
    WHERE tenant_id=? AND connection_id=? AND external_customer_id=?`, [connection.tenant_id, connection.id, externalId]);
  const [requests] = await db.query(`SELECT id,provider_request_id AS providerRequestId,request_payload_ciphertext AS ciphertext,
    request_payload_iv AS iv,request_payload_auth_tag AS authTag FROM sx_retail_store_privacy_requests
    WHERE tenant_id=? AND connection_id=? AND status IN ('received','prepared') AND request_payload_ciphertext IS NOT NULL`, [connection.tenant_id, connection.id]);
  for (const request of requests) {
    try {
      const payload = JSON.parse(open({ ciphertext: request.ciphertext, iv: request.iv, authTag: request.authTag }, connection.tenant_id, connection.id,
        `privacy:${request.providerRequestId}`).toString('utf8'));
      const requestedId = canonicalShopifyId('Customer', payload.customer?.id || payload.id);
      if (requestedId === externalId) await db.query(`UPDATE sx_retail_store_privacy_requests SET status='cancelled',request_payload_ciphertext=NULL,
        request_payload_iv=NULL,request_payload_auth_tag=NULL WHERE id=?`, [request.id]);
    } catch { await db.query(`UPDATE sx_retail_store_privacy_requests SET status='cancelled',request_payload_ciphertext=NULL,
      request_payload_iv=NULL,request_payload_auth_tag=NULL WHERE id=?`, [request.id]); }
  }
  // Failed raw events are no longer safe to retry because they could restore erased customer data.
  await db.query(`UPDATE sx_retail_external_events SET payload_ciphertext=NULL,payload_iv=NULL,payload_auth_tag=NULL,error_code='CUSTOMER_REDACTED'
    WHERE tenant_id=? AND connection_id=? AND status='failed'`, [connection.tenant_id, connection.id]);
}
async function eraseConnectionData(db, connection) {
  for (const table of ['sx_retail_external_transactions','sx_retail_external_orders','sx_retail_external_checkouts',
    'sx_retail_external_customers','sx_retail_external_products']) {
    await db.query(`DELETE FROM ${table} WHERE tenant_id=? AND connection_id=?`, [connection.tenant_id, connection.id]);
  }
  await db.query('DELETE FROM sx_retail_store_privacy_requests WHERE tenant_id=? AND connection_id=?', [connection.tenant_id, connection.id]);
  await db.query(`UPDATE sx_retail_external_events SET payload_ciphertext=NULL,payload_iv=NULL,payload_auth_tag=NULL,error_code='SHOP_REDACTED'
    WHERE tenant_id=? AND connection_id=?`, [connection.tenant_id, connection.id]);
}

module.exports = {
  UUID, fail, encryptionKey, aad, seal, open, openJson, normalizeShop, normalizeWooUrl, safeAmount, currency, canonicalShopifyId,
  customerOf, normalizeCustomer, normalizeProduct, normalizeOrder, normalizeCheckout, shopifySignature, shopifyQuerySignature,
  wooSignature, randomSecret, validateId, dateOrNull, publicIpv4, requestHttps, upsertCustomer, upsertProduct, upsertOrder,
  upsertCheckout, upsertTransaction, redactCustomer, eraseConnectionData,
};
