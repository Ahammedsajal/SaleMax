'use strict';

// WooCommerce publishing is deliberately separate from the existing read-only
// connection credentials. A field is written only when the owner enabled the
// store, the mapping selected that field, and the current Woo value still
// matches the last accepted baseline (or a conflict-specific owner approval).
const crypto = require('node:crypto');
const connector = require('./retail-connected-stores');

const FIELDS = Object.freeze(['name', 'sku', 'description', 'price', 'stock_quantity']);
const FIELD_COLUMNS = Object.freeze({ name: 'publish_name', sku: 'publish_sku', description: 'publish_description',
  price: 'publish_price', stock_quantity: 'publish_stock' });
const fail = connector.fail;
let runtime = null;
let stopping = false;

function json(value) { return JSON.stringify(value === undefined ? null : value); }
function readJson(value, fallback = {}) {
  try { return typeof value === 'string' ? JSON.parse(value) : value || fallback; } catch { return fallback; }
}
function normalize(field, value) {
  if (field === 'price') {
    if (value == null || value === '') return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 999999999) fail('INVALID_PRODUCT_PRICE', 422);
    return Math.round(n * 100);
  }
  if (field === 'stock_quantity') {
    if (value == null || !Number.isSafeInteger(Number(value)) || Number(value) < 0 || Number(value) > 1000000000) fail('INVALID_PRODUCT_STOCK', 422);
    return Number(value);
  }
  const text = value == null ? '' : String(value);
  if (text.length > (field === 'description' ? 5000 : 255)) fail('INVALID_PRODUCT_FIELD', 422);
  return text;
}
function remoteValue(field, product) {
  if (field === 'name') return normalize(field, product.name);
  if (field === 'sku') return normalize(field, product.sku);
  if (field === 'description') return normalize(field, product.description);
  if (field === 'price') return normalize(field, product.regular_price);
  if (field === 'stock_quantity') {
    if (product.manage_stock !== true && product.manage_stock !== 1 && product.manage_stock !== 'yes') fail('WOOCOMMERCE_STOCK_MANAGEMENT_DISABLED', 409);
    return normalize(field, product.stock_quantity);
  }
  fail('INVALID_PRODUCT_FIELD', 400);
}
function wireValue(field, value) { return field === 'price' ? (value == null ? '' : `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`) : value; }
function credentials(connection) {
  if (!connection.product_write_credentials_ciphertext || !connection.product_write_credentials_iv || !connection.product_write_credentials_auth_tag) {
    fail('WOOCOMMERCE_WRITE_CREDENTIALS_REQUIRED', 409);
  }
  return connector.openJson({ ciphertext: connection.product_write_credentials_ciphertext, iv: connection.product_write_credentials_iv,
    authTag: connection.product_write_credentials_auth_tag }, connection.tenant_id, connection.id, 'woo-product-write-credentials');
}
function authHeaders(connection) {
  const value = credentials(connection);
  return { Authorization: `Basic ${Buffer.from(`${value.consumerKey}:${value.consumerSecret}`).toString('base64')}`, Accept: 'application/json' };
}
function productUrl(connection, externalId) {
  if (!/^\d{1,20}$/.test(String(externalId))) fail('INVALID_WOOCOMMERCE_PRODUCT_ID', 422);
  const base = new URL(connection.store_domain);
  return new URL(`${base.pathname.replace(/\/$/, '')}/wp-json/wc/v3/products/${encodeURIComponent(externalId)}`, base.origin);
}
async function wooProduct(connection, externalId, method = 'GET', body = null) {
  const headers = authHeaders(connection);
  if (body) headers['Content-Type'] = 'application/json';
  const response = await connector.requestHttps(productUrl(connection, externalId).toString(), {
    method, headers, body: body ? JSON.stringify(body) : null,
  });
  if (response.status < 200 || response.status >= 300 || !response.data || Array.isArray(response.data)) {
    const forbidden = response.status === 401 || response.status === 403;
    const missing = response.status === 404;
    fail(forbidden ? 'WOOCOMMERCE_WRITE_PERMISSION_REQUIRED' : missing ? 'WOOCOMMERCE_PRODUCT_NOT_FOUND' : 'WOOCOMMERCE_PRODUCT_REQUEST_FAILED', forbidden ? 403 : missing ? 404 : 502);
  }
  return response.data;
}
async function localValues(db, tenantId, productId, locationId) {
  const [[product]] = await db.query(`SELECT p.id,p.code,p.name_en AS name,p.description_en AS description,p.status,
      (SELECT o.price_minor FROM sx_product_offers o WHERE o.tenant_id=p.tenant_id AND o.course_id=p.id AND o.status='active' AND o.currency='QAR'
       AND (o.valid_from IS NULL OR o.valid_from<=CURRENT_DATE) AND (o.valid_until IS NULL OR o.valid_until>=CURRENT_DATE)
       ORDER BY o.version DESC LIMIT 1) AS priceMinor,
      (SELECT o.currency FROM sx_product_offers o WHERE o.tenant_id=p.tenant_id AND o.course_id=p.id AND o.status='active' AND o.currency='QAR'
       AND (o.valid_from IS NULL OR o.valid_from<=CURRENT_DATE) AND (o.valid_until IS NULL OR o.valid_until>=CURRENT_DATE)
       ORDER BY o.version DESC LIMIT 1) AS currency
    FROM sx_product_catalog p WHERE p.tenant_id=? AND p.id=? AND p.deleted_at IS NULL`, [tenantId, productId]);
  if (!product || product.status === 'retired') fail('LOCAL_PRODUCT_NOT_FOUND', 404);
  let stock = null;
  if (locationId) {
    const [[row]] = await db.query(`SELECT l.status,
      (SELECT m.quantity FROM sx_business_stock_movements m WHERE m.tenant_id=? AND m.product_id=? AND m.location_id=? ORDER BY m.id DESC LIMIT 1) AS quantity,
      (SELECT COALESCE(SUM(r.quantity),0) FROM sx_retail_stock_reservations r WHERE r.tenant_id=? AND r.product_id=? AND r.location_id=?) AS reserved
      FROM sx_retail_locations l WHERE l.tenant_id=? AND l.id=?`,
    [tenantId, productId, locationId, tenantId, productId, locationId, tenantId, locationId]);
    if (!row || row.status !== 'active') fail('STOCK_LOCATION_NOT_ACTIVE', 409);
    stock = Math.max(0, Number(row.quantity || 0) - Number(row.reserved || 0));
  }
  const price = product.priceMinor == null ? null : Number(product.priceMinor);
  if (price != null && (!Number.isSafeInteger(price) || price < 0)) fail('INVALID_PRODUCT_PRICE', 422);
  return { name: normalize('name', product.name), sku: normalize('sku', product.code), description: normalize('description', product.description),
    price: price == null ? null : Math.round(price), stock_quantity: stock, currency: product.currency || null };
}
function fieldEnabled(mapping, field) { return Number(mapping[FIELD_COLUMNS[field]]) === 1; }
function selectedFields(fields, hasStockLocation) {
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > FIELDS.length || fields.some(field => !FIELDS.includes(field)) || new Set(fields).size !== fields.length) {
    fail('INVALID_PRODUCT_SYNC_FIELDS', 400);
  }
  if (fields.includes('stock_quantity') && !hasStockLocation) fail('STOCK_LOCATION_REQUIRED', 422);
  return Object.fromEntries(FIELDS.map(field => [FIELD_COLUMNS[field], fields.includes(field) ? 1 : 0]));
}
function productFields(row) {
  return FIELDS.reduce((result, field) => { if (fieldEnabled(row, field)) result.push(field); return result; }, []);
}
async function audit(db, tenantId, actorId, action, connectionId, mappingId, changes) {
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
    VALUES (?, ?, ?, 'identity', ?, 'retail-woocommerce-product-sync', ?, ?, ?)`,
  [crypto.randomUUID(), tenantId, actorId, action, mappingId || connectionId, JSON.stringify(changes || {}), crypto.randomUUID()]);
}
async function openConflict(db, mapping, field, local, remote, baseline) {
  await db.query(`INSERT INTO sx_retail_woo_product_sync_conflicts
      (tenant_id,connection_id,mapping_id,field_name,local_value_json,remote_value_json,baseline_value_json,status,resolution,resolved_by_identity_id,detected_at,resolved_at)
    VALUES (?,?,?,?,?,?,?,'active',NULL,NULL,UTC_TIMESTAMP(3),NULL)
    ON DUPLICATE KEY UPDATE local_value_json=VALUES(local_value_json),remote_value_json=VALUES(remote_value_json),
      baseline_value_json=VALUES(baseline_value_json),status='active',resolution=NULL,resolved_by_identity_id=NULL,
      detected_at=UTC_TIMESTAMP(3),resolved_at=NULL`,
  [mapping.tenant_id, mapping.connection_id, mapping.id, field, json(local), json(remote), baseline == null ? null : json(baseline)]);
  await db.query(`INSERT INTO sx_retail_woo_product_sync_jobs
      (tenant_id,connection_id,mapping_id,field_name,desired_value_json,status,attempts,revision,available_at,last_error_code)
    VALUES (?,?,?,?,?,'conflict',0,1,UTC_TIMESTAMP(3),NULL)
    ON DUPLICATE KEY UPDATE desired_value_json=VALUES(desired_value_json),status='conflict',attempts=0,revision=revision+1,
      approved_remote_value_json=NULL,override_approved_by=NULL,override_approved_at=NULL,lease_token=NULL,lease_until=NULL,last_error_code='PRODUCT_SYNC_CONFLICT'`,
  [mapping.tenant_id, mapping.connection_id, mapping.id, field, json(local)]);
}
async function setBaseline(db, mapping, field, value) {
  const baseline = readJson(mapping.baseline_json, {}); baseline[field] = value;
  await db.query('UPDATE sx_retail_woo_product_mappings SET baseline_json=? WHERE tenant_id=? AND id=?',
    [json(baseline), mapping.tenant_id, mapping.id]);
  mapping.baseline_json = baseline;
}
async function resolveConflictRow(db, mapping, field, resolution, identityId = null) {
  await db.query(`UPDATE sx_retail_woo_product_sync_conflicts SET status=?,resolution=?,resolved_by_identity_id=?,resolved_at=UTC_TIMESTAMP(3)
    WHERE tenant_id=? AND mapping_id=? AND field_name=? AND status='active'`,
  [resolution === 'pause' ? 'paused' : 'resolved', resolution, identityId, mapping.tenant_id, mapping.id, field]);
}
async function enqueueField(db, mapping, field, value, enabled, forceQueue = false) {
  const [[existingJob]] = await db.query(`SELECT status,desired_value_json AS desiredValueJson,approved_remote_value_json AS approvedRemoteValueJson
    FROM sx_retail_woo_product_sync_jobs WHERE tenant_id=? AND mapping_id=? AND field_name=? LIMIT 1`,
  [mapping.tenant_id, mapping.id, field]);
  if (existingJob?.approvedRemoteValueJson != null &&
      JSON.stringify(readJson(existingJob.desiredValueJson, null)) === JSON.stringify(value)) {
    const [[connection]] = await db.query('SELECT product_sync_enabled,status FROM sx_retail_store_connections WHERE tenant_id=? AND id=?', [mapping.tenant_id, mapping.connection_id]);
    const approvedStatus = connection?.status === 'active' && Number(connection.product_sync_enabled) === 1 && enabled ? 'queued' : 'paused';
    await db.query(`UPDATE sx_retail_woo_product_sync_jobs SET status=?,available_at=UTC_TIMESTAMP(3),lease_token=NULL,lease_until=NULL
      WHERE tenant_id=? AND mapping_id=? AND field_name=? AND approved_remote_value_json IS NOT NULL`,
    [approvedStatus, mapping.tenant_id, mapping.id, field]);
    return;
  }
  const conflict = await db.query(`SELECT status FROM sx_retail_woo_product_sync_conflicts WHERE tenant_id=? AND mapping_id=? AND field_name=? AND status='active' LIMIT 1`,
  [mapping.tenant_id, mapping.id, field]);
  if (conflict[0]?.length) {
    await db.query(`UPDATE sx_retail_woo_product_sync_conflicts SET local_value_json=? WHERE tenant_id=? AND mapping_id=? AND field_name=? AND status='active'`,
      [json(value), mapping.tenant_id, mapping.id, field]);
    await db.query(`UPDATE sx_retail_woo_product_sync_jobs SET desired_value_json=?,revision=revision+1 WHERE tenant_id=? AND mapping_id=? AND field_name=? AND status='conflict'`,
      [json(value), mapping.tenant_id, mapping.id, field]);
    return;
  }
  const baseline = readJson(mapping.baseline_json, {})[field];
  const [[connection]] = await db.query('SELECT product_sync_enabled,status FROM sx_retail_store_connections WHERE tenant_id=? AND id=?', [mapping.tenant_id, mapping.connection_id]);
  const status = connection?.status === 'active' && Number(connection.product_sync_enabled) === 1 && enabled ?
    (forceQueue || JSON.stringify(value) !== JSON.stringify(baseline) ? 'queued' : 'synced') : 'paused';
  await db.query(`INSERT INTO sx_retail_woo_product_sync_jobs
      (tenant_id,connection_id,mapping_id,field_name,desired_value_json,status,attempts,revision,available_at,last_error_code)
    VALUES (?,?,?,?,?,?,0,1,UTC_TIMESTAMP(3),NULL)
    ON DUPLICATE KEY UPDATE desired_value_json=VALUES(desired_value_json),
      status=IF(status='processing','processing',IF(status='conflict','conflict',VALUES(status))),
      attempts=IF(status='processing',attempts,0),revision=revision+1,available_at=UTC_TIMESTAMP(3),last_error_code=NULL,
      approved_remote_value_json=NULL,override_approved_by=NULL,override_approved_at=NULL`,
  [mapping.tenant_id, mapping.connection_id, mapping.id, field, json(value), status]);
}
async function enqueueProductChange(db, tenantId, productId, locationId = null) {
  const [mappings] = await db.query(`SELECT m.*,c.product_sync_enabled,c.status AS connection_status
    FROM sx_retail_woo_product_mappings m JOIN sx_retail_store_connections c ON c.tenant_id=m.tenant_id AND c.id=m.connection_id
    WHERE m.tenant_id=? AND m.local_product_id=? AND m.mapping_status='active'`, [tenantId, productId]);
  for (const mapping of mappings) {
    if (locationId && fieldEnabled(mapping, 'stock_quantity') && mapping.stock_location_id !== locationId) continue;
    const local = await localValues(db, tenantId, productId, mapping.stock_location_id);
    for (const field of productFields(mapping)) await enqueueField(db, mapping, field, local[field],
      mapping.connection_status === 'active' && Number(mapping.product_sync_enabled) === 1);
  }
}
async function observeWooProduct(db, connection, product) {
  if (connection.provider !== 'woocommerce' || product?.id == null) return;
  const [[mapping]] = await db.query(`SELECT m.*,c.product_sync_enabled,c.status AS connection_status
    FROM sx_retail_woo_product_mappings m JOIN sx_retail_store_connections c ON c.tenant_id=m.tenant_id AND c.id=m.connection_id
    WHERE m.tenant_id=? AND m.connection_id=? AND m.external_product_id=? AND m.mapping_status='active' LIMIT 1`,
  [connection.tenant_id, connection.id, String(product.id)]);
  if (!mapping) return;
  const local = await localValues(db, mapping.tenant_id, mapping.local_product_id, mapping.stock_location_id);
  const baseline = readJson(mapping.baseline_json, {});
  for (const field of productFields(mapping)) {
    const remote = remoteValue(field, product), desired = local[field];
    if (JSON.stringify(remote) === JSON.stringify(desired)) {
      await resolveConflictRow(db, mapping, field, 'aligned');
      await setBaseline(db, mapping, field, remote);
      await enqueueField(db, mapping, field, desired, false);
    } else if (JSON.stringify(remote) !== JSON.stringify(baseline[field])) {
      await openConflict(db, mapping, field, desired, remote, baseline[field]);
    } else {
      await enqueueField(db, mapping, field, desired, Number(mapping.product_sync_enabled) === 1 && mapping.connection_status === 'active');
    }
  }
}

async function createMapping(pool, connection, actorId, body) {
  if (connection.provider !== 'woocommerce' || connection.status !== 'active') fail('WOOCOMMERCE_STORE_REQUIRED', 409);
  const productId = String(body?.localProductId || '').toLowerCase(), externalId = String(body?.externalProductId || '');
  if (!connector.UUID.test(productId) || !/^\d{1,20}$/.test(externalId)) fail('INVALID_PRODUCT_MAPPING', 400);
  const hasStock = body?.publishFields?.includes('stock_quantity');
  const selected = selectedFields(body?.publishFields, hasStock && connector.UUID.test(String(body?.stockLocationId || '')));
  const remote = await wooProduct(connection, externalId);
  if (remote.type !== 'simple') fail('WOOCOMMERCE_SIMPLE_PRODUCTS_ONLY', 422);
  if (hasStock && remote.manage_stock !== true && remote.manage_stock !== 1 && remote.manage_stock !== 'yes') fail('WOOCOMMERCE_STOCK_MANAGEMENT_DISABLED', 422);
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[localRow]] = await db.query(`SELECT p.id,o.currency FROM sx_product_catalog p
      LEFT JOIN sx_product_offers o ON o.tenant_id=p.tenant_id AND o.course_id=p.id AND o.status='active' AND o.currency='QAR'
        AND (o.valid_from IS NULL OR o.valid_from<=CURRENT_DATE) AND (o.valid_until IS NULL OR o.valid_until>=CURRENT_DATE)
      WHERE p.tenant_id=? AND p.id=? AND p.deleted_at IS NULL AND p.status<>'retired' ORDER BY o.version DESC LIMIT 1 FOR UPDATE`,
    [connection.tenant_id, productId]);
    if (!localRow) fail('LOCAL_PRODUCT_NOT_FOUND', 404);
    if (selected.publish_price && connection.default_currency !== 'QAR') fail('PRODUCT_CURRENCY_MISMATCH', 422);
    if (selected.publish_price && !localRow.currency) fail('PRODUCT_PRICE_REQUIRED', 422);
    if (hasStock) {
      const [[location]] = await db.query("SELECT id FROM sx_retail_locations WHERE tenant_id=? AND id=? AND status='active'", [connection.tenant_id, body.stockLocationId]);
      if (!location) fail('STOCK_LOCATION_NOT_ACTIVE', 422);
    }
    const local = await localValues(db, connection.tenant_id, productId, hasStock ? body.stockLocationId : null);
    const [[existing]] = await db.query(`SELECT id,mapping_status FROM sx_retail_woo_product_mappings
      WHERE tenant_id=? AND connection_id=? AND (local_product_id=? OR external_product_id=?) LIMIT 1 FOR UPDATE`,
    [connection.tenant_id, connection.id, productId, externalId]);
    if (existing?.mapping_status === 'active') fail('PRODUCT_ALREADY_MAPPED', 409);
    const id = existing?.id || crypto.randomUUID(), baseline = {};
    for (const field of body.publishFields) baseline[field] = remoteValue(field, { ...remote, manage_stock: remote.manage_stock });
    if (existing) {
      await db.query(`UPDATE sx_retail_woo_product_mappings SET local_product_id=?,external_product_id=?,mapping_status='active',
        publish_name=?,publish_sku=?,publish_description=?,publish_price=?,publish_stock=?,stock_location_id=?,baseline_json=?,updated_by_identity_id=?
        WHERE tenant_id=? AND connection_id=? AND id=?`,
      [productId, externalId, selected.publish_name, selected.publish_sku, selected.publish_description, selected.publish_price, selected.publish_stock,
        hasStock ? body.stockLocationId : null, json(baseline), actorId, connection.tenant_id, connection.id, id]);
      await db.query("UPDATE sx_retail_woo_product_sync_jobs SET status='paused',attempts=0,override_approved_by=NULL,override_approved_at=NULL,approved_remote_value_json=NULL,lease_token=NULL,lease_until=NULL,last_error_code='PRODUCT_MAPPING_RECONFIGURED' WHERE tenant_id=? AND mapping_id=?", [connection.tenant_id, id]);
      await db.query("UPDATE sx_retail_woo_product_sync_conflicts SET status='paused',resolution='mapping_reconfigured',resolved_by_identity_id=?,resolved_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND mapping_id=? AND status='active'", [actorId, connection.tenant_id, id]);
    } else {
      await db.query(`INSERT INTO sx_retail_woo_product_mappings
        (id,tenant_id,connection_id,local_product_id,external_product_id,mapping_status,publish_name,publish_sku,publish_description,publish_price,publish_stock,
         stock_location_id,baseline_json,created_by_identity_id,updated_by_identity_id)
        VALUES (?,?,?, ?,?,'active',?,?,?,?,?,?, ?,?,?)`,
      [id, connection.tenant_id, connection.id, productId, externalId, selected.publish_name, selected.publish_sku, selected.publish_description,
        selected.publish_price, selected.publish_stock, hasStock ? body.stockLocationId : null, json(baseline), actorId, actorId]);
    }
    const mapping = { id, tenant_id: connection.tenant_id, connection_id: connection.id, local_product_id: productId, external_product_id: externalId,
      stock_location_id: hasStock ? body.stockLocationId : null, baseline_json: baseline, ...selected };
    for (const field of productFields(mapping)) {
      const remoteField = baseline[field], localField = local[field];
      if (JSON.stringify(remoteField) !== JSON.stringify(localField)) await openConflict(db, mapping, field, localField, remoteField, remoteField);
      else await enqueueField(db, mapping, field, localField, Number(connection.product_sync_enabled) === 1, true);
    }
    await audit(db, connection.tenant_id, actorId, existing ? 'retail.woocommerce-product-mapping-reconfigured' : 'retail.woocommerce-product-mapped', connection.id, id,
      { localProductId: productId, externalProductId: externalId, fields: body.publishFields, stockLocationId: hasStock ? body.stockLocationId : null, reactivated: Boolean(existing) });
    await db.commit();
    return { id };
  } catch (error) { try { await db.rollback(); } catch {} if (error.code === 'ER_DUP_ENTRY') fail('PRODUCT_ALREADY_MAPPED', 409); throw error; }
  finally { db.release(); }
}
async function updateMapping(pool, connection, actorId, mappingId, body) {
  if (connection.provider !== 'woocommerce' || connection.status !== 'active') fail('WOOCOMMERCE_STORE_REQUIRED', 409);
  if (!connector.UUID.test(mappingId) || !Array.isArray(body?.publishFields)) fail('INVALID_PRODUCT_MAPPING', 400);
  const [[current]] = await pool.query('SELECT * FROM sx_retail_woo_product_mappings WHERE tenant_id=? AND connection_id=? AND id=?',
    [connection.tenant_id, connection.id, mappingId]);
  if (!current) fail('PRODUCT_MAPPING_NOT_FOUND', 404);
  const hasStock = body.publishFields.includes('stock_quantity');
  const selected = selectedFields(body.publishFields, hasStock && connector.UUID.test(String(body.stockLocationId || current.stock_location_id || '')));
  const remote = await wooProduct(connection, current.external_product_id);
  if (remote.type !== 'simple') fail('WOOCOMMERCE_SIMPLE_PRODUCTS_ONLY', 422);
  if (hasStock && remote.manage_stock !== true && remote.manage_stock !== 1 && remote.manage_stock !== 'yes') fail('WOOCOMMERCE_STOCK_MANAGEMENT_DISABLED', 422);
  const locationId = hasStock ? body.stockLocationId || current.stock_location_id : null;
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[locked]] = await db.query('SELECT * FROM sx_retail_woo_product_mappings WHERE tenant_id=? AND connection_id=? AND id=? FOR UPDATE',
      [connection.tenant_id, connection.id, mappingId]);
    if (!locked) fail('PRODUCT_MAPPING_NOT_FOUND', 404);
    const local = await localValues(db, connection.tenant_id, locked.local_product_id, locationId);
    const baseline = readJson(locked.baseline_json, {});
    if (selected.publish_price && connection.default_currency !== 'QAR') fail('PRODUCT_CURRENCY_MISMATCH', 422);
    if (selected.publish_price && local.price == null) fail('PRODUCT_PRICE_REQUIRED', 422);
    if (hasStock) {
      const [[location]] = await db.query("SELECT id FROM sx_retail_locations WHERE tenant_id=? AND id=? AND status='active'", [connection.tenant_id, locationId]);
      if (!location) fail('STOCK_LOCATION_NOT_ACTIVE', 422);
    }
    const nextBaseline = { ...baseline };
    for (const field of FIELDS) {
      const wasEnabled = fieldEnabled(locked, field), willEnable = Boolean(selected[FIELD_COLUMNS[field]]);
      if (!willEnable) {
        await resolveConflictRow(db, locked, field, 'pause', actorId);
        await db.query("UPDATE sx_retail_woo_product_sync_jobs SET status='paused',override_approved_by=NULL,override_approved_at=NULL,approved_remote_value_json=NULL,lease_token=NULL,lease_until=NULL WHERE tenant_id=? AND mapping_id=? AND field_name=?", [connection.tenant_id, mappingId, field]);
      } else if (!wasEnabled) {
        const currentRemote = remoteValue(field, remote); nextBaseline[field] = currentRemote;
      }
    }
    await db.query(`UPDATE sx_retail_woo_product_mappings SET mapping_status='active',publish_name=?,publish_sku=?,publish_description=?,publish_price=?,publish_stock=?,stock_location_id=?,baseline_json=?,updated_by_identity_id=?
      WHERE tenant_id=? AND connection_id=? AND id=?`,
    [selected.publish_name, selected.publish_sku, selected.publish_description, selected.publish_price, selected.publish_stock, locationId,
      json(nextBaseline), actorId, connection.tenant_id, connection.id, mappingId]);
    const mapping = { ...locked, ...selected, stock_location_id: locationId, baseline_json: nextBaseline };
    for (const field of productFields(mapping)) {
      const remoteField = remoteValue(field, remote), localField = local[field], oldBaseline = baseline[field];
      const wasEnabled = fieldEnabled(locked, field);
      if (wasEnabled && JSON.stringify(remoteField) !== JSON.stringify(oldBaseline) && JSON.stringify(remoteField) !== JSON.stringify(localField)) {
        await openConflict(db, mapping, field, localField, remoteField, oldBaseline);
      } else if (!wasEnabled && JSON.stringify(remoteField) !== JSON.stringify(localField)) {
        await openConflict(db, mapping, field, localField, remoteField, remoteField);
      } else if (JSON.stringify(remoteField) !== JSON.stringify(localField)) {
        await enqueueField(db, mapping, field, localField, Number(connection.product_sync_enabled) === 1);
      } else {
        await resolveConflictRow(db, mapping, field, 'aligned');
        await setBaseline(db, mapping, field, remoteField);
        await enqueueField(db, mapping, field, localField, Number(connection.product_sync_enabled) === 1);
      }
    }
    await audit(db, connection.tenant_id, actorId, 'retail.woocommerce-product-mapping-updated', connection.id, mappingId,
      { fields: body.publishFields, stockLocationId: locationId, reactivated: locked.mapping_status === 'disabled' });
    await db.commit();
    return { id: mappingId };
  } catch (error) { try { await db.rollback(); } catch {} throw error; } finally { db.release(); }
}
async function disableMapping(pool, connection, actorId, mappingId) {
  if (!connector.UUID.test(mappingId)) fail('PRODUCT_MAPPING_NOT_FOUND', 404);
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[mapping]] = await db.query('SELECT * FROM sx_retail_woo_product_mappings WHERE tenant_id=? AND connection_id=? AND id=? FOR UPDATE',
      [connection.tenant_id, connection.id, mappingId]);
    if (!mapping) fail('PRODUCT_MAPPING_NOT_FOUND', 404);
    await db.query("UPDATE sx_retail_woo_product_mappings SET mapping_status='disabled',updated_by_identity_id=? WHERE tenant_id=? AND id=?", [actorId, connection.tenant_id, mappingId]);
    await db.query("UPDATE sx_retail_woo_product_sync_jobs SET status='paused',override_approved_by=NULL,override_approved_at=NULL,approved_remote_value_json=NULL,lease_token=NULL,lease_until=NULL WHERE tenant_id=? AND mapping_id=?", [connection.tenant_id, mappingId]);
    await db.query("UPDATE sx_retail_woo_product_sync_conflicts SET status='paused',resolution='mapping_disabled',resolved_by_identity_id=?,resolved_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND mapping_id=? AND status='active'", [actorId, connection.tenant_id, mappingId]);
    await audit(db, connection.tenant_id, actorId, 'retail.woocommerce-product-mapping-disabled', connection.id, mappingId, {});
    await db.commit(); return { id: mappingId, enabled: false };
  } catch (error) { try { await db.rollback(); } catch {} throw error; } finally { db.release(); }
}
async function pauseProductMappings(db, tenantId, productId, actorId, reason = 'local_product_retired') {
  if (!connector.UUID.test(String(productId))) return;
  const [mappings] = await db.query(`SELECT id,connection_id FROM sx_retail_woo_product_mappings
    WHERE tenant_id=? AND local_product_id=? AND mapping_status='active' FOR UPDATE`, [tenantId, productId]);
  for (const mapping of mappings) {
    await db.query("UPDATE sx_retail_woo_product_mappings SET mapping_status='disabled',updated_by_identity_id=? WHERE tenant_id=? AND id=?",
      [actorId, tenantId, mapping.id]);
    await db.query("UPDATE sx_retail_woo_product_sync_jobs SET status='paused',override_approved_by=NULL,override_approved_at=NULL,approved_remote_value_json=NULL,lease_token=NULL,lease_until=NULL,last_error_code='LOCAL_PRODUCT_RETIRED' WHERE tenant_id=? AND mapping_id=?",
      [tenantId, mapping.id]);
    await db.query(`UPDATE sx_retail_woo_product_sync_conflicts SET status='paused',resolution=?,resolved_by_identity_id=?,resolved_at=UTC_TIMESTAMP(3)
      WHERE tenant_id=? AND mapping_id=? AND status='active'`, [reason, actorId, tenantId, mapping.id]);
    await audit(db, tenantId, actorId, 'retail.woocommerce-product-mapping-paused', mapping.connection_id, mapping.id, { reason });
  }
}
async function markWooProductDeleted(db, connection, externalId) {
  await db.query("UPDATE sx_retail_woo_product_mappings SET mapping_status='disabled' WHERE tenant_id=? AND connection_id=? AND external_product_id=?",
    [connection.tenant_id, connection.id, String(externalId)]);
  await db.query("UPDATE sx_retail_woo_product_sync_jobs SET status='failed',last_error_code='WOOCOMMERCE_PRODUCT_DELETED',lease_token=NULL,lease_until=NULL WHERE tenant_id=? AND connection_id=? AND mapping_id IN (SELECT id FROM sx_retail_woo_product_mappings WHERE tenant_id=? AND connection_id=? AND external_product_id=?) AND status<>'synced'",
    [connection.tenant_id, connection.id, connection.tenant_id, connection.id, String(externalId)]);
  await db.query("UPDATE sx_retail_woo_product_sync_conflicts SET status='paused',resolution='provider_product_deleted',resolved_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND connection_id=? AND mapping_id IN (SELECT id FROM sx_retail_woo_product_mappings WHERE tenant_id=? AND connection_id=? AND external_product_id=?) AND status='active'",
    [connection.tenant_id, connection.id, connection.tenant_id, connection.id, String(externalId)]);
}

async function resolveConflict(pool, connection, actorId, mappingId, field, resolution) {
  if (!connector.UUID.test(mappingId) || !FIELDS.includes(field) || !['publish_local','keep_woo'].includes(resolution)) fail('INVALID_CONFLICT_RESOLUTION', 400);
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[mapping]] = await db.query(`SELECT m.*,c.product_sync_enabled,c.status AS connection_status FROM sx_retail_woo_product_mappings m
      JOIN sx_retail_store_connections c ON c.tenant_id=m.tenant_id AND c.id=m.connection_id
      WHERE m.tenant_id=? AND m.connection_id=? AND m.id=? AND m.mapping_status='active' FOR UPDATE`, [connection.tenant_id, connection.id, mappingId]);
    if (!mapping || !fieldEnabled(mapping, field)) fail('PRODUCT_MAPPING_NOT_FOUND', 404);
    const [[conflict]] = await db.query(`SELECT local_value_json AS localValue,remote_value_json AS remoteValue,baseline_value_json AS baselineValue
      FROM sx_retail_woo_product_sync_conflicts WHERE tenant_id=? AND mapping_id=? AND field_name=? AND status='active' FOR UPDATE`,
    [connection.tenant_id, mappingId, field]);
    if (!conflict) fail('PRODUCT_SYNC_CONFLICT_NOT_FOUND', 404);
    let queued = false;
    if (resolution === 'keep_woo') {
      await resolveConflictRow(db, mapping, field, 'pause', actorId);
      await db.query("UPDATE sx_retail_woo_product_mappings SET ??=0,updated_by_identity_id=? WHERE tenant_id=? AND id=?", [FIELD_COLUMNS[field], actorId, connection.tenant_id, mappingId]);
      await db.query("UPDATE sx_retail_woo_product_sync_jobs SET status='paused',override_approved_by=NULL,override_approved_at=NULL,approved_remote_value_json=NULL,lease_token=NULL,lease_until=NULL WHERE tenant_id=? AND mapping_id=? AND field_name=?", [connection.tenant_id, mappingId, field]);
      await audit(db, connection.tenant_id, actorId, 'retail.woocommerce-conflict-kept-woo-paused', connection.id, mappingId,
        { field, remoteValue: readJson(conflict.remoteValue, null) });
    } else {
      queued = Number(mapping.product_sync_enabled) === 1 && mapping.connection_status === 'active';
      await db.query(`UPDATE sx_retail_woo_product_sync_conflicts SET status='resolved',resolution='publish_local_approved',resolved_by_identity_id=?,resolved_at=UTC_TIMESTAMP(3)
        WHERE tenant_id=? AND mapping_id=? AND field_name=? AND status='active'`, [actorId, connection.tenant_id, mappingId, field]);
      await db.query(`UPDATE sx_retail_woo_product_sync_jobs SET desired_value_json=?,approved_remote_value_json=?,override_approved_by=?,override_approved_at=UTC_TIMESTAMP(3),
        status=IF(?=1,'queued','paused'),attempts=0,revision=revision+1,available_at=UTC_TIMESTAMP(3),lease_token=NULL,lease_until=NULL,last_error_code=NULL
        WHERE tenant_id=? AND mapping_id=? AND field_name=?`, [conflict.localValue, conflict.remoteValue, actorId,
        Number(mapping.product_sync_enabled) === 1 && mapping.connection_status === 'active' ? 1 : 0, connection.tenant_id, mappingId, field]);
      await audit(db, connection.tenant_id, actorId, 'retail.woocommerce-conflict-overwrite-approved', connection.id, mappingId,
        { field, remoteValue: readJson(conflict.remoteValue, null), localValue: readJson(conflict.localValue, null), explicitOwnerApproval: true });
    }
    await db.commit(); return { mappingId, field, resolution, queued };
  } catch (error) { try { await db.rollback(); } catch {} throw error; } finally { db.release(); }
}

async function setStoreEnabled(pool, connection, actorId, enabled) {
  if (typeof enabled !== 'boolean') fail('INVALID_PRODUCT_SYNC_SETTINGS', 400);
  if (connection.provider !== 'woocommerce' || enabled && connection.status !== 'active') fail('WOOCOMMERCE_STORE_REQUIRED', 409);
  if (enabled && (process.env.LOCAL_ONLY_MODE === 'true' || process.env.SALEMAX_PLATFORM_ENABLED !== 'true' || process.env.SALEMAX_RETAIL_WOO_PRODUCT_SYNC_ENABLED !== 'true')) {
    fail('PRODUCT_SYNC_WORKER_DISABLED', 503);
  }
  if (enabled && !connection.product_write_credentials_ciphertext) fail('WOOCOMMERCE_WRITE_CREDENTIALS_REQUIRED', 409);
  const [[mappingCount]] = await pool.query(`SELECT COUNT(*) AS count FROM sx_retail_woo_product_mappings WHERE tenant_id=? AND connection_id=? AND mapping_status='active'`,
    [connection.tenant_id, connection.id]);
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    await db.query('SELECT id FROM sx_retail_store_connections WHERE tenant_id=? AND id=? FOR UPDATE', [connection.tenant_id, connection.id]);
    await db.query('UPDATE sx_retail_store_connections SET product_sync_enabled=? WHERE tenant_id=? AND id=?', [enabled ? 1 : 0, connection.tenant_id, connection.id]);
    if (!enabled) await db.query("UPDATE sx_retail_woo_product_sync_jobs SET status=IF(status='processing',status,'paused'),lease_token=IF(status='processing',lease_token,NULL),lease_until=IF(status='processing',lease_until,NULL) WHERE tenant_id=? AND connection_id=? AND status IN ('queued','retry','processing')", [connection.tenant_id, connection.id]);
    await audit(db, connection.tenant_id, actorId, enabled ? 'retail.woocommerce-product-sync-enabled' : 'retail.woocommerce-product-sync-disabled', connection.id, null,
      { enabled, productMappings: Number(mappingCount.count) });
    await db.commit();
  } catch (error) { try { await db.rollback(); } catch {} throw error; } finally { db.release(); }
  if (enabled) {
    let after = '';
    while (true) {
      const [mappings] = await pool.query(`SELECT * FROM sx_retail_woo_product_mappings WHERE tenant_id=? AND connection_id=? AND mapping_status='active' AND id>?
        ORDER BY id LIMIT 50`, [connection.tenant_id, connection.id, after]);
      if (!mappings.length) break;
      const writer = await pool.getConnection();
      try {
        await writer.beginTransaction();
        for (const mapping of mappings) {
          const local = await localValues(writer, connection.tenant_id, mapping.local_product_id, mapping.stock_location_id);
          for (const field of productFields(mapping)) await enqueueField(writer, mapping, field, local[field], true, true);
        }
        await writer.commit();
      } catch (error) { try { await writer.rollback(); } catch {} throw error; } finally { writer.release(); }
      after = mappings.at(-1).id;
    }
  }
  return { enabled };
}

async function storeWriteCredentials(pool, connection, actorId, consumerKey, consumerSecret) {
  if (connection.provider !== 'woocommerce' || connection.status !== 'active' || typeof consumerKey !== 'string' || !/^ck_[A-Za-z0-9]{32,64}$/.test(consumerKey) ||
      typeof consumerSecret !== 'string' || !/^cs_[A-Za-z0-9]{32,64}$/.test(consumerSecret)) fail('INVALID_WOOCOMMERCE_CREDENTIALS', 400);
  const encrypted = connector.seal({ consumerKey, consumerSecret }, connection.tenant_id, connection.id, 'woo-product-write-credentials');
  const url = new URL(`${new URL(connection.store_domain).pathname.replace(/\/$/, '')}/wp-json/wc/v3/products?per_page=1`, new URL(connection.store_domain).origin);
  const value = { consumerKey, consumerSecret };
  const response = await connector.requestHttps(url.toString(), { headers: { Authorization: `Basic ${Buffer.from(`${value.consumerKey}:${value.consumerSecret}`).toString('base64')}`, Accept: 'application/json' } });
  if (response.status < 200 || response.status >= 300 || !Array.isArray(response.data)) fail(response.status === 401 || response.status === 403 ? 'WOOCOMMERCE_KEY_OR_PERMISSION_INVALID' : 'WOOCOMMERCE_CONNECTION_FAILED', 502);
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [updated] = await db.query(`UPDATE sx_retail_store_connections SET product_write_credentials_ciphertext=?,product_write_credentials_iv=?,product_write_credentials_auth_tag=?,product_write_verified_at=NULL,product_sync_enabled=0
      WHERE tenant_id=? AND id=? AND provider='woocommerce' AND status='active'`,
    [encrypted.ciphertext, encrypted.iv, encrypted.authTag, connection.tenant_id, connection.id]);
    if (!updated.affectedRows) fail('STORE_CONNECTION_NOT_ACTIVE', 409);
    await db.query("UPDATE sx_retail_woo_product_sync_jobs SET status='paused',approved_remote_value_json=NULL,override_approved_by=NULL,override_approved_at=NULL,lease_token=NULL,lease_until=NULL WHERE tenant_id=? AND connection_id=? AND status IN ('queued','retry','processing','conflict')", [connection.tenant_id, connection.id]);
    await audit(db, connection.tenant_id, actorId, 'retail.woocommerce-write-key-saved', connection.id, null, { readAccessVerified: true, writeAccessVerified: false });
    await db.commit();
  } catch (error) { try { await db.rollback(); } catch {} throw error; } finally { db.release(); }
  return { configured: true, writeAccessVerified: false };
}

async function state(pool, connection, offsetValue = 0) {
  const offset = Number(offsetValue);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) fail('INVALID_PAGE', 400);
  const tenantId = connection.tenant_id;
  const [catalog] = await pool.query(`SELECT id,code,name_en AS nameEn,name_ar AS nameAr FROM sx_product_catalog
    WHERE tenant_id=? AND deleted_at IS NULL AND status<>'retired' ORDER BY name_en,id LIMIT 500`, [tenantId]);
  const [external] = await pool.query(`SELECT external_product_id AS id,product_status AS status,currency,price,product_ciphertext AS ciphertext,
      product_iv AS iv,product_auth_tag AS authTag FROM sx_retail_external_products WHERE tenant_id=? AND connection_id=? AND product_status<>'deleted'
      ORDER BY imported_at DESC,external_product_id LIMIT 500`, [tenantId, connection.id]);
  const storeProducts = external.map(row => {
    const value = connector.openJson(row, tenantId, connection.id, `product:${row.id}`);
    return { id: row.id, title: value.title, sku: value.sku, status: row.status, type: value.type || null, currency: row.currency, price: String(row.price) };
  });
  const [locations] = await pool.query("SELECT id,code,name_en AS nameEn,name_ar AS nameAr,is_default AS isDefault FROM sx_retail_locations WHERE tenant_id=? AND status='active' ORDER BY is_default DESC,name_en LIMIT 100", [tenantId]);
  const [mappings] = await pool.query(`SELECT m.id,m.local_product_id AS localProductId,m.external_product_id AS externalProductId,m.mapping_status AS status,
      m.publish_name AS publishName,m.publish_sku AS publishSku,m.publish_description AS publishDescription,m.publish_price AS publishPrice,
      m.publish_stock AS publishStock,m.stock_location_id AS stockLocationId,m.baseline_json AS baselineJson,p.code,p.name_en AS productNameEn,p.name_ar AS productNameAr
    FROM sx_retail_woo_product_mappings m JOIN sx_product_catalog p ON p.tenant_id=m.tenant_id AND p.id=m.local_product_id
    WHERE m.tenant_id=? AND m.connection_id=? ORDER BY m.updated_at DESC,m.id LIMIT 100 OFFSET ?`, [tenantId, connection.id, offset]);
  const [conflicts] = await pool.query(`SELECT c.mapping_id AS mappingId,c.field_name AS field,c.local_value_json AS localValueJson,
      c.remote_value_json AS remoteValueJson,c.baseline_value_json AS baselineValueJson,c.detected_at AS detectedAt,
      p.name_en AS productNameEn,m.external_product_id AS externalProductId
    FROM sx_retail_woo_product_sync_conflicts c JOIN sx_retail_woo_product_mappings m ON m.tenant_id=c.tenant_id AND m.id=c.mapping_id
    JOIN sx_product_catalog p ON p.tenant_id=m.tenant_id AND p.id=m.local_product_id
    WHERE c.tenant_id=? AND c.connection_id=? AND c.status='active' ORDER BY c.detected_at,m.id,c.field_name LIMIT 100 OFFSET ?`, [tenantId, connection.id, offset]);
  const [jobs] = await pool.query(`SELECT j.id,j.mapping_id AS mappingId,j.field_name AS field,j.status,j.attempts,j.last_error_code AS lastErrorCode,
      j.last_attempt_at AS lastAttemptAt,j.synced_at AS syncedAt,p.name_en AS productNameEn,m.external_product_id AS externalProductId,m.mapping_status AS mappingStatus
    FROM sx_retail_woo_product_sync_jobs j JOIN sx_retail_woo_product_mappings m ON m.tenant_id=j.tenant_id AND m.id=j.mapping_id
    JOIN sx_product_catalog p ON p.tenant_id=m.tenant_id AND p.id=m.local_product_id
    WHERE j.tenant_id=? AND j.connection_id=? ORDER BY j.updated_at DESC,j.id DESC LIMIT 100 OFFSET ?`, [tenantId, connection.id, offset]);
  const [[mappingCount]] = await pool.query("SELECT COUNT(*) AS count FROM sx_retail_woo_product_mappings WHERE tenant_id=? AND connection_id=?", [tenantId, connection.id]);
  const [[conflictCount]] = await pool.query("SELECT COUNT(*) AS count FROM sx_retail_woo_product_sync_conflicts WHERE tenant_id=? AND connection_id=? AND status='active'", [tenantId, connection.id]);
  const [[jobCount]] = await pool.query("SELECT COUNT(*) AS count FROM sx_retail_woo_product_sync_jobs WHERE tenant_id=? AND connection_id=?", [tenantId, connection.id]);
  const fields = rows => rows.map(row => ({ ...row, localValue: readJson(row.localValueJson, null), remoteValue: readJson(row.remoteValueJson, null),
    baselineValue: readJson(row.baselineValueJson, null) }));
  return { enabled: Number(connection.product_sync_enabled) === 1, writeCredentialsConfigured: Boolean(connection.product_write_credentials_ciphertext),
    writeAccessVerified: Boolean(connection.product_write_verified_at), workerEnabled: process.env.LOCAL_ONLY_MODE !== 'true' &&
      process.env.SALEMAX_PLATFORM_ENABLED === 'true' && process.env.SALEMAX_RETAIL_WOO_PRODUCT_SYNC_ENABLED === 'true', catalog, storeProducts, locations, offset,
    hasMore: offset + mappings.length < Number(mappingCount.count) || offset + conflicts.length < Number(conflictCount.count) || offset + jobs.length < Number(jobCount.count),
    mappings: mappings.map(row => ({ ...row, baseline: readJson(row.baselineJson, {}) })), conflicts: fields(conflicts), jobs };
}

function searchPage(value) {
  const page = Number(value || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) fail('INVALID_PAGE', 400);
  return page;
}
function searchText(value) {
  const query = typeof value === 'string' ? value.trim() : '';
  if (query.length < 2 || query.length > 100 || /[\u0000-\u001f]/.test(query)) fail('INVALID_PRODUCT_SEARCH', 400);
  return query;
}
async function searchCatalog(pool, tenantId, searchValue, pageValue = 1) {
  const query = searchText(searchValue), page = searchPage(pageValue), escaped = query.replace(/[!%_]/g, '!$&');
  const [rows] = await pool.query(`SELECT id,code,name_en AS nameEn,name_ar AS nameAr FROM sx_product_catalog
    WHERE tenant_id=? AND deleted_at IS NULL AND status<>'retired' AND (code LIKE ? ESCAPE '!' OR name_en LIKE ? ESCAPE '!' OR name_ar LIKE ? ESCAPE '!')
    ORDER BY name_en,id LIMIT 50 OFFSET ?`, [tenantId, `%${escaped}%`, `%${escaped}%`, `%${escaped}%`, (page - 1) * 50]);
  const [[count]] = await pool.query(`SELECT COUNT(*) AS count FROM sx_product_catalog
    WHERE tenant_id=? AND deleted_at IS NULL AND status<>'retired' AND (code LIKE ? ESCAPE '!' OR name_en LIKE ? ESCAPE '!' OR name_ar LIKE ? ESCAPE '!')`,
  [tenantId, `%${escaped}%`, `%${escaped}%`, `%${escaped}%`]);
  return { rows, page, hasMore: page * 50 < Number(count.count) };
}
async function searchWooProducts(connection, searchValue, pageValue = 1) {
  if (connection.provider !== 'woocommerce' || connection.status !== 'active') fail('WOOCOMMERCE_STORE_REQUIRED', 409);
  const query = searchText(searchValue), page = searchPage(pageValue);
  if (!connection.credentials_ciphertext || !connection.credentials_iv || !connection.credentials_auth_tag) fail('STORE_CONNECTION_NOT_READY', 409);
  const value = connector.openJson({ ciphertext: connection.credentials_ciphertext, iv: connection.credentials_iv,
    authTag: connection.credentials_auth_tag }, connection.tenant_id, connection.id, 'credentials');
  const base = new URL(connection.store_domain);
  const url = new URL(`${base.pathname.replace(/\/$/, '')}/wp-json/wc/v3/products`, base.origin);
  url.searchParams.set('search', query); url.searchParams.set('per_page', '50'); url.searchParams.set('page', String(page));
  const response = await connector.requestHttps(url.toString(), { headers: {
    Authorization: `Basic ${Buffer.from(`${value.consumerKey}:${value.consumerSecret}`).toString('base64')}`, Accept: 'application/json',
  } });
  if (response.status < 200 || response.status >= 300 || !Array.isArray(response.data)) {
    fail(response.status === 401 || response.status === 403 ? 'WOOCOMMERCE_KEY_OR_PERMISSION_INVALID' : 'WOOCOMMERCE_REQUEST_FAILED', 502);
  }
  const totalPages = Math.max(1, Math.min(10000, Number(response.headers['x-wp-totalpages']) || 1));
  return { rows: response.data.map(row => ({ id: String(row.id), title: String(row.name || '').slice(0, 255),
    sku: String(row.sku || '').slice(0, 100) || null, status: String(row.status || 'unknown').slice(0, 32),
    type: String(row.type || 'simple').toLowerCase().slice(0, 32) })), page, hasMore: page < totalPages };
}

async function retryJob(pool, connection, jobId) {
  if (!/^\d{1,20}$/.test(String(jobId))) fail('PRODUCT_SYNC_JOB_NOT_FOUND', 404);
  if (process.env.LOCAL_ONLY_MODE === 'true' || process.env.SALEMAX_PLATFORM_ENABLED !== 'true' || process.env.SALEMAX_RETAIL_WOO_PRODUCT_SYNC_ENABLED !== 'true') {
    fail('PRODUCT_SYNC_WORKER_DISABLED', 503);
  }
  const [result] = await pool.query(`UPDATE sx_retail_woo_product_sync_jobs j
    JOIN sx_retail_woo_product_mappings m ON m.tenant_id=j.tenant_id AND m.id=j.mapping_id
    JOIN sx_retail_store_connections c ON c.tenant_id=j.tenant_id AND c.id=j.connection_id
    SET j.status='queued',j.attempts=0,j.available_at=UTC_TIMESTAMP(3),j.last_error_code=NULL,j.lease_token=NULL,j.lease_until=NULL
    WHERE j.tenant_id=? AND j.connection_id=? AND j.id=? AND j.status='failed' AND m.mapping_status='active'
      AND c.status='active' AND c.product_sync_enabled=1 AND c.product_write_credentials_ciphertext IS NOT NULL`,
  [connection.tenant_id, connection.id, jobId]);
  if (!result.affectedRows) fail('PRODUCT_SYNC_JOB_NOT_RETRYABLE', 409);
  return { queued: true };
}

async function claim(pool) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [[job]] = await db.query(`SELECT j.id FROM sx_retail_woo_product_sync_jobs j
      JOIN sx_retail_store_connections c ON c.tenant_id=j.tenant_id AND c.id=j.connection_id
      JOIN sx_retail_woo_product_mappings m ON m.tenant_id=j.tenant_id AND m.id=j.mapping_id
      WHERE j.status IN ('queued','retry') AND j.available_at<=UTC_TIMESTAMP(3) AND (j.lease_until IS NULL OR j.lease_until<UTC_TIMESTAMP(3))
        AND c.provider='woocommerce' AND c.status='active' AND c.product_sync_enabled=1 AND m.mapping_status='active'
      ORDER BY j.available_at,j.id LIMIT 1 FOR UPDATE SKIP LOCKED`);
    if (!job) { await db.commit(); return null; }
    const token = crypto.randomUUID();
    await db.query(`UPDATE sx_retail_woo_product_sync_jobs SET status='processing',attempts=attempts+1,last_attempt_at=UTC_TIMESTAMP(3),
      lease_token=?,lease_until=UTC_TIMESTAMP(3)+INTERVAL 90 SECOND WHERE id=?`, [token, job.id]);
    await db.commit(); return { id: job.id, token };
  } catch (error) { try { await db.rollback(); } catch {} throw error; } finally { db.release(); }
}
async function processJob(pool, claimed) {
  const db = await pool.getConnection();
  let providerWriteSucceeded = false;
  try {
    await db.beginTransaction();
    const [[job]] = await db.query(`SELECT j.*,(j.override_approved_at IS NULL OR j.override_approved_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 24 HOUR)) AS approval_expired,
        m.external_product_id,m.local_product_id,m.stock_location_id,m.baseline_json,
        m.mapping_status,c.product_sync_enabled,c.provider,c.status AS connection_status,c.store_domain,c.default_currency,
        c.product_write_credentials_ciphertext,c.product_write_credentials_iv,c.product_write_credentials_auth_tag,
        m.publish_name,m.publish_sku,m.publish_description,m.publish_price,m.publish_stock
      FROM sx_retail_woo_product_sync_jobs j
      JOIN sx_retail_woo_product_mappings m ON m.tenant_id=j.tenant_id AND m.id=j.mapping_id
      JOIN sx_retail_store_connections c ON c.tenant_id=j.tenant_id AND c.id=j.connection_id
      WHERE j.id=? AND j.lease_token=? FOR UPDATE`, [claimed.id, claimed.token]);
    if (!job || job.status !== 'processing') { await db.rollback(); return; }
    if (Number(job.product_sync_enabled) !== 1 || job.connection_status !== 'active' || job.mapping_status !== 'active' || !fieldEnabled(job, job.field_name)) {
      await db.query("UPDATE sx_retail_woo_product_sync_jobs SET status='paused',lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?", [job.id, claimed.token]);
      await db.commit(); return;
    }
    const mapping = { ...job, tenant_id: job.tenant_id, connection_id: job.connection_id, id: job.mapping_id };
    const connection = { ...job, id: job.connection_id, tenant_id: job.tenant_id, provider: job.provider, store_domain: job.store_domain,
      product_write_credentials_ciphertext: job.product_write_credentials_ciphertext, product_write_credentials_iv: job.product_write_credentials_iv,
      product_write_credentials_auth_tag: job.product_write_credentials_auth_tag };
    const source = await localValues(db, job.tenant_id, job.local_product_id, job.stock_location_id);
    const storedDesired = readJson(job.desired_value_json, null), desired = source[job.field_name];
    const sourceChanged = JSON.stringify(desired) !== JSON.stringify(storedDesired);
    if (job.field_name === 'price' && desired == null) fail('LOCAL_PRODUCT_PRICE_UNAVAILABLE', 422);
    if (sourceChanged) await db.query(`UPDATE sx_retail_woo_product_sync_jobs SET desired_value_json=?,approved_remote_value_json=NULL,
      override_approved_by=NULL,override_approved_at=NULL,revision=revision+1 WHERE id=? AND lease_token=?`,
    [json(desired), job.id, claimed.token]);
    const current = await wooProduct(connection, job.external_product_id);
    if (current.type !== 'simple') fail('WOOCOMMERCE_SIMPLE_PRODUCTS_ONLY', 422);
    if (job.field_name === 'stock_quantity' && current.manage_stock !== true && current.manage_stock !== 1 && current.manage_stock !== 'yes') fail('WOOCOMMERCE_STOCK_MANAGEMENT_DISABLED', 409);
    const remote = remoteValue(job.field_name, current), baseline = readJson(job.baseline_json, {})[job.field_name];
    const approvedRemote = sourceChanged || job.approved_remote_value_json == null ? undefined : readJson(job.approved_remote_value_json, null);
    if (JSON.stringify(remote) === JSON.stringify(desired)) {
      await setBaseline(db, mapping, job.field_name, remote);
      await resolveConflictRow(db, mapping, job.field_name, 'aligned');
      await db.query("UPDATE sx_retail_woo_product_sync_jobs SET status='synced',synced_at=UTC_TIMESTAMP(3),last_error_code=NULL,lease_token=NULL,lease_until=NULL,approved_remote_value_json=NULL,override_approved_by=NULL,override_approved_at=NULL WHERE id=? AND lease_token=?",
        [job.id, claimed.token]);
      await db.commit(); return;
    }
    const approvalExpired = approvedRemote !== undefined && Number(job.approval_expired) === 1;
    if (approvedRemote !== undefined && (approvalExpired || JSON.stringify(remote) !== JSON.stringify(approvedRemote))) {
      await openConflict(db, mapping, job.field_name, desired, remote, baseline);
      await db.commit(); return;
    }
    if (approvedRemote === undefined && JSON.stringify(remote) !== JSON.stringify(baseline)) {
      await openConflict(db, mapping, job.field_name, desired, remote, baseline);
      await db.commit(); return;
    }
    const put = {};
    put[job.field_name === 'price' ? 'regular_price' : job.field_name] = wireValue(job.field_name, desired);
    const updated = await wooProduct(connection, job.external_product_id, 'PUT', put);
    providerWriteSucceeded = true;
    if (JSON.stringify(remoteValue(job.field_name, updated)) !== JSON.stringify(desired)) fail('WOOCOMMERCE_VALUE_NOT_CONFIRMED', 502);
    await setBaseline(db, mapping, job.field_name, desired);
    await resolveConflictRow(db, mapping, job.field_name, 'publish_local_approved', job.override_approved_by || null);
    await db.query("UPDATE sx_retail_woo_product_sync_jobs SET status='synced',synced_at=UTC_TIMESTAMP(3),last_error_code=NULL,lease_token=NULL,lease_until=NULL,approved_remote_value_json=NULL,override_approved_by=NULL,override_approved_at=NULL WHERE id=? AND lease_token=?",
      [job.id, claimed.token]);
    if (providerWriteSucceeded) await db.query('UPDATE sx_retail_store_connections SET product_write_verified_at=COALESCE(product_write_verified_at,UTC_TIMESTAMP(3)) WHERE tenant_id=? AND id=?', [job.tenant_id, job.connection_id]);
    await db.commit();
  } catch (error) {
    try { await db.rollback(); } catch {}
    const code = /^[A-Z0-9_]{1,64}$/.test(String(error?.code || '')) ? error.code : 'WOOCOMMERCE_PRODUCT_SYNC_FAILED';
    const permanent = ['WOOCOMMERCE_WRITE_PERMISSION_REQUIRED','WOOCOMMERCE_WRITE_CREDENTIALS_REQUIRED','WOOCOMMERCE_PRODUCT_NOT_FOUND','WOOCOMMERCE_SIMPLE_PRODUCTS_ONLY',
      'WOOCOMMERCE_STOCK_MANAGEMENT_DISABLED','LOCAL_PRODUCT_NOT_FOUND','LOCAL_PRODUCT_PRICE_UNAVAILABLE','INVALID_PRODUCT_PRICE','INVALID_PRODUCT_STOCK'].includes(code);
    await db.query(`UPDATE sx_retail_woo_product_sync_jobs SET status=IF(?=1,'failed',IF(attempts>=8,'failed','retry')),
      available_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL LEAST(3600,POW(2,LEAST(attempts,10))*15) SECOND),
      last_error_code=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND status='processing'`,
    [permanent ? 1 : 0, code, claimed.id, claimed.token]);
  } finally { db.release(); }
}
async function workOnce(pool) { const job = await claim(pool); if (job) await processJob(pool, job); }
function start({ pool, intervalMs = 2500, logger = console } = {}) {
  if (!pool || process.env.LOCAL_ONLY_MODE === 'true' || process.env.SALEMAX_PLATFORM_ENABLED !== 'true' ||
      process.env.SALEMAX_RETAIL_WOO_PRODUCT_SYNC_ENABLED !== 'true') return null;
  if (runtime) return runtime;
  stopping = false;
  let timer;
  const tick = async () => {
    if (stopping) return;
    try { await workOnce(pool); } catch { logger.error('WooCommerce product sync worker encountered an internal error.'); }
    if (!stopping) timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, intervalMs);
  runtime = { stop() { stopping = true; clearTimeout(timer); runtime = null; } };
  return runtime;
}

module.exports = { FIELDS, FIELD_COLUMNS, normalize, remoteValue, localValues, wooProduct, observeWooProduct, enqueueProductChange,
  createMapping, updateMapping, disableMapping, pauseProductMappings, markWooProductDeleted, resolveConflict, setStoreEnabled, storeWriteCredentials, state,
  searchCatalog, searchWooProducts, retryJob, workOnce, start };
