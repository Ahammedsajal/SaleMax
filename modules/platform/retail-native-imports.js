'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const directory = require('./retail-customer-directory');
const connector = () => require('./retail-connected-stores');
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const fail = (code, status = 409) => { throw Object.assign(Error(code), { code, status }); };

function safeProductImageUrl(value) {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase().replace(/\.$/, '');
    const blocked = ['localhost','local','internal','test','invalid','example','home','lan','onion'];
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || net.isIP(host) ||
        !host.includes('.') || blocked.some(suffix => host === suffix || host.endsWith(`.${suffix}`))) return null;
    return url.toString();
  } catch { return null; }
}

function deterministicUuid(value) {
  const bytes = crypto.createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function productUuid(connection, productId, variantId = '') {
  return deterministicUuid(`7network-retail-product\0${connection.tenant_id}\0${connection.id}\0${productId}\0${variantId}`);
}
function codeForSku(sku, source) {
  const raw = String(sku || '').trim().toUpperCase();
  const cleaned = raw.replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  const suffix = crypto.createHash('sha256').update(source).digest('hex').slice(0, 8).toUpperCase();
  return cleaned && cleaned.length <= 31 && /^[A-Z0-9]/.test(cleaned) ? cleaned : `EXT-${suffix}`;
}
function plainText(value, max = 5000) {
  return String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0*39;/gi, "'").replace(/\s+/g, ' ').trim().slice(0, max);
}
function minorAmount(value, currency) {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  const match = String(value ?? '0').match(/^(\d{1,14})(?:\.(\d{1,6}))?$/);
  if (!match) fail('INVALID_PROVIDER_AMOUNT', 422);
  const scale = 10n ** BigInt(digits), fraction = match[2] || '';
  let amount = BigInt(match[1]) * scale + BigInt((fraction + '0'.repeat(digits)).slice(0, digits) || '0');
  if (fraction[digits] >= '5') amount++;
  if (amount > 18446744073709551615n) fail('INVALID_PROVIDER_AMOUNT', 422);
  return amount.toString();
}
function normalizedAttributes(variant) {
  const rows = Array.isArray(variant?.attributes) ? variant.attributes : Array.isArray(variant?.selectedOptions) ? variant.selectedOptions : [];
  return rows.slice(0, 20).map(row => ({ name: String(row?.name || '').slice(0, 80), value: String(row?.option ?? row?.value ?? '').slice(0, 100) }))
    .filter(row => row.name || row.value);
}
function variantTitle(variant, attributes) {
  const value = String(variant?.title || attributes.map(row => `${row.name}: ${row.value}`).filter(Boolean).join(' / ') || 'Default').trim();
  return value.slice(0, 160);
}
async function codeForProduct(db, tenantId, sku, source, productId) {
  const base = codeForSku(sku, source);
  const [[row]] = await db.query('SELECT id FROM sx_product_catalog WHERE tenant_id=? AND code=? LIMIT 1', [tenantId, base]);
  if (!row || row.id === productId) return { code: base, conflict: false };
  const suffix = crypto.createHash('sha256').update(source).digest('hex').slice(0, 10).toUpperCase();
  return { code: `EXT-${suffix}`, conflict: true };
}
async function sourceProduct(db, connection, productId, variantId = '') {
  const [[row]] = await db.query(`SELECT product_id AS productId,parent_product_id AS parentProductId,review_state AS reviewState,
      source_updated_at AS sourceUpdatedAt FROM sx_retail_catalogue_imports
    WHERE tenant_id=? AND connection_id=? AND external_product_id=? AND external_variant_id=? FOR UPDATE`,
  [connection.tenant_id, connection.id, productId, variantId]);
  return row || null;
}
async function ensureNativeProduct(db, connection, sourceProductId, variantId, { title, sku, description = '', attributes = [], parentId = null,
  price, currency, priceAvailable = true, updatedAt = null, reviewState = null }) {
  const existing = await sourceProduct(db, connection, sourceProductId, variantId);
  const sourceKey = `${connection.tenant_id}\0${connection.id}\0${sourceProductId}\0${variantId}`;
  const id = existing?.productId || productUuid(connection, sourceProductId, variantId);
  const { code, conflict } = await codeForProduct(db, connection.tenant_id, sku, sourceKey, id);
  const sourceStatus = connector().dateOrNull(updatedAt);
  if (!existing) {
    const [[orphan]] = await db.query('SELECT id FROM sx_product_catalog WHERE tenant_id=? AND id=? FOR UPDATE',
      [connection.tenant_id, id]);
    if (orphan) {
      // Reuse the local tombstone after an owner erases and later reconnects
      // the same source item; retain Arabic copy and publish it in the catalogue.
      await db.query(`UPDATE sx_product_catalog SET code=?,name_en=?,description_en=?,catalogue_kind='product',parent_product_id=?,status='active',
          deleted_at=NULL,revision=revision+1,updated_at=UTC_TIMESTAMP(3)
        WHERE tenant_id=? AND id=?`, [code, plainText(title, 200) || 'Imported product', plainText(description), parentId,
        connection.tenant_id, id]);
    } else {
      await db.query(`INSERT INTO sx_product_catalog
        (id,tenant_id,code,name_en,name_ar,description_en,description_ar,duration_value,duration_unit,delivery_mode,
          difficulty_level,outcomes_en,outcomes_ar,prerequisites_en,prerequisites_ar,certificate_details_en,certificate_details_ar,
          source_categories,status,revision,created_by_identity_id,updated_by_identity_id,catalogue_kind,parent_product_id)
        VALUES (?,?,?,?,'',?, '',1,'hours','in_person','all_levels','','','','','','',JSON_ARRAY(),'active',1,?,?, 'product',?)`,
      [id, connection.tenant_id, code, plainText(title, 200) || 'Imported product', plainText(description),
        connection.created_by_identity_id, connection.created_by_identity_id, parentId]);
    }
    await db.query(`INSERT INTO sx_retail_catalogue_imports
      (tenant_id,connection_id,external_product_id,external_variant_id,product_id,parent_product_id,source_sku,variant_attributes,review_state,source_updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, [connection.tenant_id, connection.id, sourceProductId, variantId, id, parentId,
      sku || null, JSON.stringify(attributes), reviewState || (!sku ? 'missing_sku' : conflict ? 'sku_conflict' : 'ready'), sourceStatus]);
  } else {
    const stale = existing.sourceUpdatedAt && sourceStatus && new Date(existing.sourceUpdatedAt) > new Date(sourceStatus);
    if (!stale) {
      // Store-owned fields update from source. Local Arabic copy, notes, status,
      // and publication state are not changed by connector refreshes.
      await db.query(`UPDATE sx_product_catalog SET name_en=?,description_en=?,revision=revision+1,updated_at=UTC_TIMESTAMP(3)
        WHERE tenant_id=? AND id=? AND deleted_at IS NULL`, [plainText(title, 200) || 'Imported product', plainText(description), connection.tenant_id, id]);
      await db.query(`UPDATE sx_retail_catalogue_imports SET source_sku=?,variant_attributes=?,review_state=?,source_updated_at=?,imported_at=UTC_TIMESTAMP(3)
        WHERE tenant_id=? AND connection_id=? AND external_product_id=? AND external_variant_id=?`,
      [sku || null, JSON.stringify(attributes), reviewState || (!sku ? 'missing_sku' : conflict ? 'sku_conflict' : 'ready'), sourceStatus,
        connection.tenant_id, connection.id, sourceProductId, variantId]);
    }
  }
  if (priceAvailable && price != null) await writeSourceOffer(db, connection, sourceProductId, variantId, id, price, currency);
  return id;
}
async function writeSourceOffer(db, connection, sourceProductId, variantId, productId, price, currency) {
  const amount = minorAmount(price, currency || connection.default_currency || 'QAR');
  const [[current]] = await db.query(`SELECT id,version,currency,price_minor AS priceMinor FROM sx_product_offers
    WHERE tenant_id=? AND course_id=? AND source_connection_id=? AND source_external_product_id=? AND source_external_variant_id=?
      AND status='active' ORDER BY version DESC LIMIT 1 FOR UPDATE`,
  [connection.tenant_id, productId, connection.id, sourceProductId, variantId]);
  if (current && String(current.priceMinor) === amount && current.currency === currency) return;
  const [[latest]] = await db.query('SELECT COALESCE(MAX(version),0) AS version FROM sx_product_offers WHERE tenant_id=? AND course_id=? FOR UPDATE',
    [connection.tenant_id, productId]);
  await db.query("UPDATE sx_product_offers SET status='retired' WHERE tenant_id=? AND course_id=? AND status='active'",
    [connection.tenant_id, productId]);
  const version = Number(latest.version) + 1;
  await db.query(`INSERT INTO sx_product_offers(id,tenant_id,course_id,version,currency,price_minor,registration_fee_minor,
      payment_term_count,payment_interval,valid_from,valid_until,inclusions,status,created_by_identity_id,
      source_connection_id,source_external_product_id,source_external_variant_id)
    VALUES (?,?,?,?,?,?,0,1,'once',NULL,NULL,JSON_ARRAY(),'active',?,?,?,?)`,
  [crypto.randomUUID(), connection.tenant_id, productId, version, currency, amount, connection.created_by_identity_id,
    connection.id, sourceProductId, variantId]);
}
async function upsertProduct(db, connection, product) {
  if (!product || !product.id) return;
  const rootId = await ensureNativeProduct(db, connection, product.id, '', {
    title: product.title, sku: product.sku, description: product.descriptionEn || '', attributes: [], parentId: null,
    price: product.priceUnavailable ? null : product.price, currency: product.currency,
    priceAvailable: !product.priceUnavailable, updatedAt: product.updatedAt,
    reviewState: product.variationCount > 0 && !product.sku ? 'ready' : null,
  });
  const imageUrls = Array.isArray(product.imageUrls) ? product.imageUrls : product.imageUrl ? [product.imageUrl] : [];
  await require('./retail-product-media-imports').queueImages(db, connection, product.id, rootId, imageUrls);
  const variants = Array.isArray(product.variants) ? product.variants : [];
  for (const variant of variants) {
    const id = variant?.id == null ? '' : connection.provider === 'shopify' ? String(variant.id) : String(variant.id);
    if (!id) continue;
    const attributes = normalizedAttributes(variant);
    const title = variantTitle(variant, attributes);
    const price = variant.price ?? variant.priceSet?.shopMoney?.amount ?? null;
    await ensureNativeProduct(db, connection, product.id, id, {
      title: `${product.title} · ${title}`, sku: variant.sku, description: product.descriptionEn || '', attributes,
      parentId: rootId, price, currency: variant.currency || variant.currencyCode || product.currency,
      priceAvailable: price != null, updatedAt: variant.updatedAt || product.updatedAt,
    });
  }
  await refreshParentPrice(db, connection, product.id, rootId);
  return rootId;
}
async function upsertProductVariants(db, connection, externalProductId, variants) {
  if (connection.provider !== 'shopify' || !Array.isArray(variants) || !variants.length) return 0;
  const sourceId = connector().canonicalShopifyId('Product', externalProductId);
  const parent = await sourceProduct(db, connection, sourceId, '');
  if (!parent) return 0;
  const [[source]] = await db.query(`SELECT product_ciphertext AS ciphertext,product_iv AS iv,product_auth_tag AS authTag
    FROM sx_retail_external_products WHERE tenant_id=? AND connection_id=? AND external_product_id=?`,
  [connection.tenant_id, connection.id, sourceId]);
  if (!source) return 0;
  const product = connector().openJson(source, connection.tenant_id, connection.id, `product:${sourceId}`);
  for (const variant of variants) {
    const id = connector().canonicalShopifyId('ProductVariant', variant?.id);
    if (!id || id.length > 191) continue;
    const attributes = normalizedAttributes(variant);
    const rawPrice = variant.price?.amount ?? variant.price ?? null;
    await ensureNativeProduct(db, connection, sourceId, id, {
      title: `${product.title || ''} · ${variantTitle(variant, attributes)}`.replace(/^ · /, ''),
      sku: variant.sku, description: product.descriptionEn || '', attributes, parentId: parent.productId,
      price: rawPrice, currency: variant.price?.currencyCode || variant.currencyCode || product.currency,
      priceAvailable: rawPrice != null, updatedAt: variant.updatedAt || product.updatedAt,
    });
  }
  await refreshParentPrice(db, connection, sourceId, parent.productId);
  return variants.length;
}
async function upsertVariation(db, connection, variation) {
  const [[parent]] = await db.query(`SELECT product_id AS productId FROM sx_retail_catalogue_imports
    WHERE tenant_id=? AND connection_id=? AND external_product_id=? AND external_variant_id='' FOR UPDATE`,
  [connection.tenant_id, connection.id, variation.productId]);
  if (!parent) return null;
  const [[sourceProduct]] = await db.query(`SELECT product_ciphertext AS ciphertext,product_iv AS iv,product_auth_tag AS authTag
    FROM sx_retail_external_products WHERE tenant_id=? AND connection_id=? AND external_product_id=?`,
  [connection.tenant_id, connection.id, variation.productId]);
  const parentData = sourceProduct ? connector().openJson(sourceProduct, connection.tenant_id, connection.id, `product:${variation.productId}`) : {};
  const attributes = normalizedAttributes(variation);
  const childId = await ensureNativeProduct(db, connection, variation.productId, variation.id, {
    title: `${parentData.title || variation.parentTitle || ''} · ${variantTitle(variation, attributes)}`.replace(/^ · /, ''),
    sku: variation.sku, description: parentData.descriptionEn || variation.parentDescription || '', attributes, parentId: parent.productId,
    price: variation.price, currency: variation.currency || connection.default_currency,
    priceAvailable: true, updatedAt: variation.updatedAt,
  });
  await refreshParentPrice(db, connection, variation.productId, parent.productId);
  return childId;
}
async function refreshParentPrice(db, connection, externalProductId, parentProductId) {
  const [[rows]] = await db.query(`SELECT MIN(o.price_minor) AS amount,o.currency FROM sx_retail_catalogue_imports i
    JOIN sx_product_offers o ON o.tenant_id=i.tenant_id AND o.course_id=i.product_id AND o.source_connection_id=i.connection_id
      AND o.source_external_product_id=i.external_product_id AND o.source_external_variant_id=i.external_variant_id AND o.status='active'
    WHERE i.tenant_id=? AND i.connection_id=? AND i.external_product_id=? AND i.external_variant_id<>''
      AND i.review_state<>'source_deleted' GROUP BY o.currency ORDER BY amount LIMIT 1`,
  [connection.tenant_id, connection.id, externalProductId]);
  if (!rows?.amount) return;
  const [[rootOffer]] = await db.query(`SELECT id,version,currency,price_minor AS priceMinor FROM sx_product_offers
    WHERE tenant_id=? AND course_id=? AND source_connection_id=? AND source_external_product_id=? AND source_external_variant_id='' AND status='active'
    ORDER BY version DESC LIMIT 1 FOR UPDATE`, [connection.tenant_id, parentProductId, connection.id, externalProductId]);
  if (rootOffer && rootOffer.currency === rows.currency && String(rootOffer.priceMinor) === String(rows.amount)) return;
  await writeSourceOffer(db, connection, externalProductId, '', parentProductId, String(rows.amount), rows.currency);
}
async function markProductDeleted(db, connection, externalProductId, externalVariantId = '') {
  await db.query(`UPDATE sx_retail_catalogue_imports SET review_state='source_deleted',source_updated_at=UTC_TIMESTAMP(3),imported_at=UTC_TIMESTAMP(3)
    WHERE tenant_id=? AND connection_id=? AND external_product_id=? AND (?='' OR external_variant_id=?)`,
  [connection.tenant_id, connection.id, externalProductId, externalVariantId, externalVariantId]);
}
async function upsertOrder(db, connection, order, customerDirectoryKey) {
  const externalOrderId = String(order.id || '');
  if (!externalOrderId || externalOrderId.length > 191) fail('INVALID_PROVIDER_ORDER', 422);
  const [[location]] = await db.query(`SELECT id FROM sx_retail_locations WHERE tenant_id=? AND status='active' AND is_default=1 LIMIT 1`, [connection.tenant_id]);
  const lines = [];
  for (const [index, source] of (order.lineItems || []).slice(0, 100).entries()) {
    const productId = source.productId == null ? '' : String(source.productId);
    const variantId = source.variantId == null ? '' : String(source.variantId);
    const [[target]] = productId ? await db.query(`SELECT product_id AS productId FROM sx_retail_catalogue_imports
      WHERE tenant_id=? AND connection_id=? AND external_product_id=? AND external_variant_id IN (?, '')
      ORDER BY (external_variant_id=?) DESC LIMIT 1`, [connection.tenant_id, connection.id, productId, variantId, variantId]) : [[]];
    const quantity = connector().safeQuantity(source.quantity || '0');
    const id = target?.productId || deterministicUuid(`7network-retail-order-line\0${connection.id}\0${externalOrderId}\0${source.id || index}`);
    lines.push({ id, productId: target?.productId || null, sourceLineId: source.id || null,
      nameEn: plainText(source.title || source.name || 'Imported item', 200), nameAr: '', sku: source.sku || '',
      quantity, priceMinor: source.unitPrice == null || BigInt(minorAmount(source.unitPrice, order.currency)) > BigInt(Number.MAX_SAFE_INTEGER)
        ? null : Number(minorAmount(source.unitPrice, order.currency)),
      sourceTotal: source.total, sourceCurrency: order.currency, importedFromStore: true,
      quantityPrecision: 6, unitRevision: 0, baseUnitCode: 'unit', baseUnitLabel: '', baseUnitLabelAr: '',
    });
  }
  const customer = order.customer || {};
  const buyerName = [customer.firstName, customer.lastName].filter(Boolean).join(' ').slice(0, 120) || 'Store customer';
  const buyerPhone = String(customer.phone || '').slice(0, 30);
  const buyerEmail = directory.normalizeEmail(customer.email).slice(0, 254) || null;
  const sourceTotal = connector().safeAmount(order.total);
  const sourceRefund = connector().safeAmount(order.breakdown?.refunds || '0');
  const totalMinor = minorAmount(sourceTotal, order.currency);
  const requestId = deterministicUuid(`7network-retail-order-request\0${connection.id}\0${externalOrderId}`);
  const id = deterministicUuid(`7network-retail-order\0${connection.id}\0${externalOrderId}`);
  const requestHash = crypto.createHash('sha256').update(JSON.stringify({ connectionId: connection.id, externalOrderId })).digest('hex');
  await db.query(`INSERT INTO sx_retail_orders
      (id,tenant_id,request_id,request_hash,buyer_name,buyer_phone,buyer_email,delivery_address,fulfillment,order_lines,total_minor,delivery_fee,
       status,location_id,currency,customer_directory_key,external_source_connection_id,external_source_order_id,
       source_order_status,source_financial_status,source_total_amount,source_refund_amount,created_at)
    VALUES (?,?,?,?,?,?,?,'','pickup',?,?,0,'placed',?,?,?,?,?,?,?,?,?,COALESCE(?,UTC_TIMESTAMP(3)))
    ON DUPLICATE KEY UPDATE buyer_name=VALUES(buyer_name),buyer_phone=VALUES(buyer_phone),buyer_email=VALUES(buyer_email),
      delivery_address=VALUES(delivery_address),order_lines=VALUES(order_lines),total_minor=VALUES(total_minor),currency=VALUES(currency),
      customer_directory_key=VALUES(customer_directory_key),source_order_status=VALUES(source_order_status),
      source_financial_status=VALUES(source_financial_status),source_total_amount=VALUES(source_total_amount),
      source_refund_amount=VALUES(source_refund_amount)`,
  [id, connection.tenant_id, requestId, requestHash, buyerName, buyerPhone, buyerEmail, JSON.stringify(lines), totalMinor,
    // Source orders are immutable snapshots; null means the store has not mapped them to a local stock location.
    location?.id || null, order.currency, customerDirectoryKey, connection.id, externalOrderId, order.status, order.financialStatus,
    sourceTotal, sourceRefund, connector().dateOrNull(order.createdAt)]);
  const [[native]] = await db.query('SELECT id FROM sx_retail_orders WHERE tenant_id=? AND external_source_connection_id=? AND external_source_order_id=?',
    [connection.tenant_id, connection.id, externalOrderId]);
  await directory.indexSource(db, { tenantId: connection.tenant_id, connectionId: connection.id, sourceKind: 'order',
    sourceId: externalOrderId, directoryKey: customerDirectoryKey, customer });
  return native?.id || id;
}
async function refreshCustomerOrders(db, connection, externalCustomerId, customerDirectoryKey, customer) {
  const buyerName = [customer?.firstName, customer?.lastName].filter(Boolean).join(' ').slice(0, 120) || 'Store customer';
  await db.query(`UPDATE sx_retail_orders o JOIN sx_retail_external_orders e
      ON e.tenant_id=o.tenant_id AND e.connection_id=o.external_source_connection_id AND e.external_order_id=o.external_source_order_id
    SET o.customer_directory_key=?,o.buyer_name=?,o.buyer_phone=?,o.buyer_email=?
    WHERE o.tenant_id=? AND e.connection_id=? AND e.customer_external_id=?`,
  [customerDirectoryKey, buyerName, String(customer?.phone || '').slice(0, 30), directory.normalizeEmail(customer?.email).slice(0, 254) || null,
    connection.tenant_id, connection.id, externalCustomerId]);
}
async function variants(pool, tenantId, parentId) {
  if (!UUID.test(parentId || '')) fail('PRODUCT_NOT_FOUND', 404);
  const [[parent]] = await pool.query(`SELECT id FROM sx_product_catalog WHERE tenant_id=? AND id=? AND catalogue_kind='product' AND parent_product_id IS NULL AND deleted_at IS NULL`, [tenantId, parentId]);
  if (!parent) fail('PRODUCT_NOT_FOUND', 404);
  const [rows] = await pool.query(`SELECT p.id,p.code,p.name_en AS nameEn,p.name_ar AS nameAr,p.description_en AS descriptionEn,
      p.description_ar AS descriptionAr,p.status,p.revision,i.source_sku AS sourceSku,i.variant_attributes AS attributes,
      i.review_state AS reviewState,o.currency,o.price_minor AS priceMinor
    FROM sx_retail_catalogue_imports i JOIN sx_product_catalog p ON p.tenant_id=i.tenant_id AND p.id=i.product_id
    LEFT JOIN sx_product_offers o ON o.tenant_id=i.tenant_id AND o.course_id=i.product_id AND o.status='active'
    WHERE i.tenant_id=? AND i.parent_product_id=? AND i.review_state<>'source_deleted' AND p.deleted_at IS NULL
    ORDER BY p.code,p.id`, [tenantId, parentId]);
  return rows.map(row => ({ ...row, attributes: typeof row.attributes === 'string' ? JSON.parse(row.attributes) : row.attributes || [] }));
}
async function listProducts(pool, context, { page = 1, limit = 20, search = '', status = '' } = {}) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('INVALID_PAGING');
  if (typeof search !== 'string' || search.length > 100) fail('INVALID_SEARCH');
  if (status && !['draft', 'active', 'retired'].includes(status)) fail('INVALID_STATUS');
  const tenantId = context.tenant.id, term = search.trim().replace(/[\\%_]/g, '\\$&'), pattern = `%${term}%`;
  const where = `c.tenant_id=? AND c.deleted_at IS NULL AND c.parent_product_id IS NULL
    AND (?='' OR c.status=?) AND (?='' OR c.code LIKE ? OR c.name_en LIKE ? OR c.name_ar LIKE ?)`;
  const params = [tenantId, status, status, term, pattern, pattern, pattern];
  const [[total]] = await pool.query(`SELECT COUNT(*) AS n FROM sx_product_catalog c WHERE ${where}`, params);
  const [rows] = await pool.query(`SELECT c.id,c.code,c.student_id_prefix AS studentIdPrefix,c.name_en AS nameEn,c.name_ar AS nameAr,
      c.description_en AS descriptionEn,c.description_ar AS descriptionAr,c.duration_value AS durationValue,c.duration_unit AS durationUnit,
      c.delivery_mode AS deliveryMode,c.difficulty_level AS difficultyLevel,c.outcomes_en AS outcomesEn,c.outcomes_ar AS outcomesAr,
      c.prerequisites_en AS prerequisitesEn,c.prerequisites_ar AS prerequisitesAr,c.certificate_details_en AS certificateDetailsEn,
      c.certificate_details_ar AS certificateDetailsAr,c.source_categories AS sourceCategories,c.status,c.revision,c.updated_at AS updatedAt,
      c.catalogue_kind AS catalogueKind,c.parent_product_id AS parentProductId,
      (SELECT im.image_media_id FROM sx_retail_catalogue_import_media im JOIN sx_product_media pm
        ON pm.tenant_id=im.tenant_id AND pm.id=im.image_media_id AND pm.course_id=im.product_id AND pm.deleted_at IS NULL
        WHERE im.tenant_id=c.tenant_id AND im.product_id=c.id AND im.image_media_id IS NOT NULL
        ORDER BY im.updated_at DESC LIMIT 1) AS imageMediaId,
      (SELECT COUNT(*) FROM sx_product_catalog child JOIN sx_retail_catalogue_imports ci
        ON ci.tenant_id=child.tenant_id AND ci.product_id=child.id AND ci.review_state<>'source_deleted'
        WHERE child.tenant_id=c.tenant_id AND child.parent_product_id=c.id AND child.deleted_at IS NULL) AS variantCount,
      (SELECT GROUP_CONCAT(DISTINCT i.review_state ORDER BY i.review_state SEPARATOR ',') FROM sx_retail_catalogue_imports i
        WHERE i.tenant_id=c.tenant_id AND i.product_id=c.id) AS importReviewState,
      (SELECT i.source_sku FROM sx_retail_catalogue_imports i WHERE i.tenant_id=c.tenant_id AND i.product_id=c.id
        ORDER BY (i.external_variant_id='') DESC LIMIT 1) AS sourceSku,
      (SELECT s.provider FROM sx_retail_catalogue_imports i JOIN sx_retail_store_connections s
        ON s.tenant_id=i.tenant_id AND s.id=i.connection_id WHERE i.tenant_id=c.tenant_id AND i.product_id=c.id
        ORDER BY (i.external_variant_id='') DESC LIMIT 1) AS sourceProvider,
      (SELECT s.display_name FROM sx_retail_catalogue_imports i JOIN sx_retail_store_connections s
        ON s.tenant_id=i.tenant_id AND s.id=i.connection_id WHERE i.tenant_id=c.tenant_id AND i.product_id=c.id
        ORDER BY (i.external_variant_id='') DESC LIMIT 1) AS sourceStoreName,
      (SELECT COUNT(*) FROM sx_product_batches b WHERE b.tenant_id=c.tenant_id AND b.course_id=c.id AND b.status IN ('scheduled','open','full')) AS batchCount,
      (SELECT COUNT(*) FROM sx_product_offers o WHERE o.tenant_id=c.tenant_id AND o.course_id=c.id) AS offerVersionCount,
      (SELECT o.price_minor FROM sx_product_offers o WHERE o.tenant_id=c.tenant_id AND o.course_id=c.id ORDER BY o.version DESC LIMIT 1) AS priceMinor,
      (SELECT o.currency FROM sx_product_offers o WHERE o.tenant_id=c.tenant_id AND o.course_id=c.id ORDER BY o.version DESC LIMIT 1) AS priceCurrency,
      (SELECT o.version FROM sx_product_offers o WHERE o.tenant_id=c.tenant_id AND o.course_id=c.id ORDER BY o.version DESC LIMIT 1) AS offerVersion
    FROM sx_product_catalog c WHERE ${where} ORDER BY c.updated_at DESC,c.id LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
  const imageUrls = new Map(), imageMediaIds = new Map();
  if (rows.length) {
    const [galleryRows] = await pool.query(`SELECT gallery.product_id AS productId,gallery.image_index AS imageIndex,
        gallery.image_media_id AS mediaId
      FROM sx_retail_catalogue_import_images gallery JOIN sx_product_media media
        ON media.tenant_id=gallery.tenant_id AND media.id=gallery.image_media_id
          AND media.course_id=gallery.product_id AND media.deleted_at IS NULL
      WHERE gallery.tenant_id=? AND gallery.product_id IN (?) AND gallery.image_state='ready'
      ORDER BY gallery.product_id,gallery.image_index`, [tenantId, rows.map(row => row.id)]);
    for (const image of galleryRows) {
      if (!imageMediaIds.has(image.productId)) imageMediaIds.set(image.productId, []);
      imageMediaIds.get(image.productId).push(image.mediaId);
    }
    const [sources] = await pool.query(`SELECT i.product_id AS productId,i.connection_id AS connectionId,
        p.external_product_id AS externalProductId,p.product_ciphertext AS ciphertext,p.product_iv AS iv,p.product_auth_tag AS authTag
      FROM sx_retail_catalogue_imports i JOIN sx_retail_external_products p
        ON p.tenant_id=i.tenant_id AND p.connection_id=i.connection_id AND p.external_product_id=i.external_product_id
      WHERE i.tenant_id=? AND i.product_id IN (?) AND i.external_variant_id='' AND p.product_status<>'deleted'`,
    [tenantId, rows.map(row => row.id)]);
    for (const source of sources) {
      try {
        const product = connector().openJson(source, tenantId, source.connectionId, `product:${source.externalProductId}`);
        const imageUrl = safeProductImageUrl(product.imageUrl);
        if (imageUrl) imageUrls.set(source.productId, imageUrl);
      } catch { /* The catalogue remains readable if an optional source image is unavailable. */ }
    }
  }
  return { items: rows.map(row => ({ ...row, imageMediaIds: imageMediaIds.get(row.id) || [], imageMediaId: imageMediaIds.get(row.id)?.[0] || null, imageUrl: imageUrls.get(row.id) || null,
      sourceCategories: typeof row.sourceCategories === 'string' ? JSON.parse(row.sourceCategories) : row.sourceCategories || [] })),
    total: Number(total.n), page, limit };
}
async function redactCustomer(db, connection, externalCustomerId) {
  await db.query(`UPDATE sx_retail_orders o JOIN sx_retail_external_orders e
      ON e.tenant_id=o.tenant_id AND e.connection_id=o.external_source_connection_id AND e.external_order_id=o.external_source_order_id
    SET o.buyer_name='Customer removed',o.buyer_phone='',o.buyer_email=NULL,o.delivery_address='',o.delivery_pin=NULL,o.customer_directory_key=NULL
    WHERE o.tenant_id=? AND e.connection_id=? AND e.customer_external_id=?`, [connection.tenant_id, connection.id, externalCustomerId]);
}
async function eraseConnection(db, tenantId, connectionId) {
  const imageFiles = await require('./retail-product-media-imports').eraseConnection(db, tenantId, connectionId);
  const [sources] = await db.query(`SELECT product_id AS productId FROM sx_retail_catalogue_imports
    WHERE tenant_id=? AND connection_id=?`, [tenantId, connectionId]);
  for (const source of sources) {
    const [[product]] = await db.query('SELECT code FROM sx_product_catalog WHERE tenant_id=? AND id=? FOR UPDATE', [tenantId, source.productId]);
    if (!product) continue;
    const tombstone = `REMOVED-${crypto.createHash('sha256').update(`${connectionId}\0${source.productId}`).digest('hex').slice(0, 8).toUpperCase()}`;
    await db.query("UPDATE sx_product_catalog SET code=?,name_en='Removed store product',name_ar='',description_en='',description_ar='',status='retired',deleted_at=COALESCE(deleted_at,UTC_TIMESTAMP(3)),revision=revision+1 WHERE tenant_id=? AND id=?",
      [tombstone, tenantId, source.productId]);
    await db.query("UPDATE sx_product_offers SET status='retired' WHERE tenant_id=? AND course_id=? AND source_connection_id=?",
      [tenantId, source.productId, connectionId]);
  }
  await db.query('DELETE FROM sx_product_offers WHERE tenant_id=? AND source_connection_id=?', [tenantId, connectionId]);
  await db.query(`DELETE FROM sx_retail_customer_search_tokens WHERE tenant_id=? AND connection_id=?`, [tenantId, connectionId]);
  await db.query(`UPDATE sx_retail_orders SET buyer_name='Store data erased',buyer_phone='',buyer_email=NULL,delivery_address='',delivery_pin=NULL,
      customer_directory_key=NULL,order_lines=JSON_ARRAY(),source_order_status=NULL,source_financial_status=NULL,
      source_total_amount=NULL,source_refund_amount=NULL,total_minor=0
    WHERE tenant_id=? AND external_source_connection_id=?`, [tenantId, connectionId]);
  await db.query(`DELETE FROM sx_retail_catalogue_imports WHERE tenant_id=? AND connection_id=?`, [tenantId, connectionId]);
  return imageFiles;
}

module.exports = { deterministicUuid, productUuid, plainText, minorAmount, upsertProduct, upsertProductVariants, upsertVariation,
  upsertOrder, refreshCustomerOrders, markProductDeleted, variants, listProducts, redactCustomer, eraseConnection,
  importProductImage: (...args) => require('./retail-product-media-imports').importImage(...args) };
