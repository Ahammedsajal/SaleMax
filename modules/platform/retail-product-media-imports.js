'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const connector = require('./retail-connected-stores');
const media = require('./training-course-media');

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_TENANT_MEDIA_BYTES = 2 * 1024 * 1024 * 1024;
const fail = (code, status = 422) => { throw Object.assign(Error(code), { code, status }); };
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    return url.toString();
  } catch { return null; }
}

async function queue(db, connection, externalProductId, productId, imageUrl) {
  const safe = safeUrl(imageUrl);
  const hash = safe ? sha256(safe) : null;
  const state = safe ? 'pending' : 'none';
  await db.query(`INSERT INTO sx_retail_catalogue_import_media
      (tenant_id,connection_id,external_product_id,product_id,image_media_id,image_url_hash,image_state)
    VALUES (?,?,?,?,NULL,?,?) ON DUPLICATE KEY UPDATE
      image_state=IF(VALUES(image_url_hash) IS NULL,IF(image_media_id IS NULL,'none','ready'),
        IF(image_url_hash=VALUES(image_url_hash),
          IF(image_state='failed' AND (retry_after IS NULL OR retry_after<=UTC_TIMESTAMP(3)),'pending',image_state),'pending')),
      attempt_count=IF(image_url_hash<=>VALUES(image_url_hash),attempt_count,0),
      retry_after=IF(image_url_hash<=>VALUES(image_url_hash),retry_after,NULL),
      last_error_code=IF(image_url_hash<=>VALUES(image_url_hash),last_error_code,NULL),
      image_url_hash=VALUES(image_url_hash),product_id=VALUES(product_id),updated_at=UTC_TIMESTAMP(3)`,
  [connection.tenant_id, connection.id, externalProductId, productId, hash, state]);
}

async function queueGalleryRows(db, connection, externalProductId, productId, rows) {
  if (!rows.length) return;
  const placeholders = rows.map(() => '(?,?,?,?,?,NULL,?,?)').join(',');
  const params = [];
  for (const row of rows) {
    const safe = safeUrl(row.imageUrl), hash = safe ? sha256(safe) : null;
    params.push(connection.tenant_id, connection.id, externalProductId, row.imageIndex, productId, hash, safe ? 'pending' : 'none');
  }
  await db.query(`INSERT INTO sx_retail_catalogue_import_images
      (tenant_id,connection_id,external_product_id,image_index,product_id,image_media_id,image_url_hash,image_state)
    VALUES ${placeholders} ON DUPLICATE KEY UPDATE
      image_state=IF(VALUES(image_url_hash) IS NULL,'none',
        IF(image_url_hash=VALUES(image_url_hash),
          IF(image_state='failed' AND (retry_after IS NULL OR retry_after<=UTC_TIMESTAMP(3)),'pending',image_state),'pending')),
      attempt_count=IF(image_url_hash<=>VALUES(image_url_hash),attempt_count,0),
      retry_after=IF(image_url_hash<=>VALUES(image_url_hash),retry_after,NULL),
      last_error_code=IF(image_url_hash<=>VALUES(image_url_hash),last_error_code,NULL),
      image_url_hash=VALUES(image_url_hash),product_id=VALUES(product_id),updated_at=UTC_TIMESTAMP(3)`, params);
}

async function queueGalleryIndex(db, connection, externalProductId, productId, imageIndex, imageUrl) {
  return queueGalleryRows(db, connection, externalProductId, productId, [{ imageIndex, imageUrl }]);
}

async function queueImages(db, connection, externalProductId, productId, imageUrls) {
  const safeImages = [...new Set((Array.isArray(imageUrls) ? imageUrls : [])
    .map(safeUrl).filter(Boolean))].slice(0, 12);
  await queue(db, connection, externalProductId, productId, safeImages[0] || null);
  await queueGalleryRows(db, connection, externalProductId, productId,
    safeImages.map((imageUrl, imageIndex) => ({ imageIndex, imageUrl })));
  await db.query(`UPDATE sx_retail_catalogue_import_images SET image_state='none',image_url_hash=NULL,
      retry_after=NULL,last_error_code=NULL,updated_at=UTC_TIMESTAMP(3)
    WHERE tenant_id=? AND connection_id=? AND external_product_id=? AND image_index>=?`,
  [connection.tenant_id, connection.id, externalProductId, safeImages.length]);
  return safeImages.length;
}
function imageMime(response) {
  const value = String(response.headers?.['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  return ['image/jpeg', 'image/png', 'image/webp'].includes(value) ? value : null;
}

async function importImage(pool, connection, externalProductId, productId, imageUrl, imageIndex = 0) {
  if (!Number.isSafeInteger(imageIndex) || imageIndex < 0 || imageIndex >= 12) fail('INVALID_RETAIL_PRODUCT_IMAGE_INDEX', 422);
  const url = safeUrl(imageUrl);
  const hash = url ? sha256(url) : null;
  const [[current]] = await pool.query(`SELECT i.image_media_id AS imageMediaId,i.image_url_hash AS imageUrlHash,i.image_state AS imageState,
      m.id AS liveMediaId FROM sx_retail_catalogue_import_images i LEFT JOIN sx_product_media m
        ON m.tenant_id=i.tenant_id AND m.id=i.image_media_id AND m.course_id=i.product_id AND m.deleted_at IS NULL
    WHERE i.tenant_id=? AND i.connection_id=? AND i.external_product_id=? AND i.image_index=?`,
  [connection.tenant_id, connection.id, externalProductId, imageIndex]);

  if (!url) {
    await queueGalleryIndex(pool, connection, externalProductId, productId, imageIndex, null);
    if (imageIndex === 0) await queue(pool, connection, externalProductId, productId, null);
    return { status: 'none' };
  }
  if (!current) await queueGalleryIndex(pool, connection, externalProductId, productId, imageIndex, url);
  if (current?.imageUrlHash === hash && current.imageState === 'ready' && current.liveMediaId) return { status: 'ready', unchanged: true };

  const response = await connector.requestHttps(url, { method: 'GET', maxBytes: MAX_SOURCE_BYTES, binary: true });
  if (response.status !== 200 || !imageMime(response) || !Buffer.isBuffer(response.data) || response.data.length < 16) {
    fail('RETAIL_PRODUCT_IMAGE_UNAVAILABLE', 502);
  }

  let image;
  try {
    image = await require('sharp')(response.data, { limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84, effort: 4 }).toBuffer();
  } catch { fail('RETAIL_PRODUCT_IMAGE_INVALID', 422); }
  if (!image.length || image.length > MAX_SOURCE_BYTES) fail('RETAIL_PRODUCT_IMAGE_TOO_LARGE', 413);

  const identityId = connection.created_by_identity_id;
  if (!identityId) fail('RETAIL_PRODUCT_IMAGE_CREATOR_UNAVAILABLE', 503);
  const id = crypto.randomUUID();
  const temporary = path.join(media.tempDirectory(), `${id}.webp`);
  const target = media.filePath(connection.tenant_id, productId, id);
  let moved = false, replacedFile = null;
  const db = await pool.getConnection();
  try {
    await media.ensureDirectories();
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const directory = await fs.lstat(path.dirname(target));
    if (!directory.isDirectory() || directory.isSymbolicLink()) fail('COURSE_MEDIA_STORAGE_UNAVAILABLE', 503);
    await fs.writeFile(temporary, image, { flag: 'wx', mode: 0o600 });
    await db.beginTransaction();
    const [[product]] = await db.query(`SELECT p.id FROM sx_retail_catalogue_imports i
      JOIN sx_product_catalog p ON p.tenant_id=i.tenant_id AND p.id=i.product_id
      WHERE i.tenant_id=? AND i.connection_id=? AND i.external_product_id=? AND i.external_variant_id=''
        AND i.product_id=? AND p.deleted_at IS NULL FOR UPDATE`,
    [connection.tenant_id, connection.id, externalProductId, productId]);
    if (!product) fail('RETAIL_IMPORTED_PRODUCT_NOT_FOUND', 404);
    const [[locked]] = await db.query(`SELECT image_media_id AS imageMediaId,image_url_hash AS imageUrlHash,image_state AS imageState
      FROM sx_retail_catalogue_import_images WHERE tenant_id=? AND connection_id=? AND external_product_id=? AND image_index=? FOR UPDATE`,
    [connection.tenant_id, connection.id, externalProductId, imageIndex]);
    if (locked?.imageUrlHash === hash && locked.imageState === 'ready' && locked.imageMediaId) {
      await db.rollback();
      await fs.rm(temporary, { force: true });
      return { status: 'ready', unchanged: true };
    }
    const [[usage]] = await db.query(`SELECT COALESCE(SUM(file_size_bytes),0) AS usedBytes FROM sx_product_media
      WHERE tenant_id=? AND deleted_at IS NULL`, [connection.tenant_id]);
    if (Number(usage.usedBytes || 0) + image.length > MAX_TENANT_MEDIA_BYTES) fail('RETAIL_PRODUCT_MEDIA_QUOTA_EXCEEDED', 409);

    await fs.rename(temporary, target);
    moved = true;
    await db.query(`INSERT INTO sx_product_media
      (id,tenant_id,course_id,media_kind,mime_type,original_name,storage_key,file_size_bytes,sha256_hex,created_by_identity_id)
      VALUES (?,?,?,'image','image/webp','Store product image.webp',?,?,?,?)`,
    [id, connection.tenant_id, productId, id, image.length, sha256(image), identityId]);
    await db.query(`INSERT INTO sx_retail_catalogue_import_images
      (tenant_id,connection_id,external_product_id,image_index,product_id,image_media_id,image_url_hash,image_state)
      VALUES (?,?,?,?,?,?,?,'ready') ON DUPLICATE KEY UPDATE product_id=VALUES(product_id),image_media_id=VALUES(image_media_id),
        image_url_hash=VALUES(image_url_hash),image_state='ready',attempt_count=0,retry_after=NULL,last_error_code=NULL,updated_at=UTC_TIMESTAMP(3)`,
    [connection.tenant_id, connection.id, externalProductId, imageIndex, productId, id, hash]);
    if (imageIndex === 0) {
      await db.query(`INSERT INTO sx_retail_catalogue_import_media
        (tenant_id,connection_id,external_product_id,product_id,image_media_id,image_url_hash,image_state)
        VALUES (?,?,?,?,?,?,'ready') ON DUPLICATE KEY UPDATE product_id=VALUES(product_id),image_media_id=VALUES(image_media_id),
          image_url_hash=VALUES(image_url_hash),image_state='ready',attempt_count=0,retry_after=NULL,last_error_code=NULL,updated_at=UTC_TIMESTAMP(3)`,
      [connection.tenant_id, connection.id, externalProductId, productId, id, hash]);
    }
    if (locked?.imageMediaId && locked.imageMediaId !== id) {
      const [[prior]] = await db.query(`SELECT storage_key AS storageKey FROM sx_product_media
        WHERE tenant_id=? AND course_id=? AND id=? AND deleted_at IS NULL FOR UPDATE`,
      [connection.tenant_id, productId, locked.imageMediaId]);
      const [[listing]] = await db.query(`SELECT COUNT(*) AS n FROM sx_retail_listings
        WHERE tenant_id=? AND product_id=? AND photo_id=?`, [connection.tenant_id, productId, locked.imageMediaId]);
      if (prior && Number(listing.n) === 0) {
        await db.query('UPDATE sx_product_media SET deleted_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND course_id=? AND id=?',
          [connection.tenant_id, productId, locked.imageMediaId]);
        replacedFile = media.filePath(connection.tenant_id, productId, prior.storageKey);
      }
    }
    await db.commit();
    if (replacedFile) await fs.rm(replacedFile, { force: true }).catch(() => {});
    return { status: 'ready', mediaId: id };
  } catch (error) {
    await db.rollback().catch(() => {});
    if (moved) await fs.rm(target, { force: true }).catch(() => {});
    throw error;
  } finally {
    db.release();
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function markFailure(pool, connection, externalProductId, productId, imageUrl, error, imageIndex = 0) {
  if (!Number.isSafeInteger(imageIndex) || imageIndex < 0 || imageIndex >= 12) return;
  const url = safeUrl(imageUrl), hash = url ? sha256(url) : null;
  const code = /^[A-Z0-9_]{1,64}$/.test(String(error?.code || '')) ? String(error.code) : 'RETAIL_PRODUCT_IMAGE_FAILED';
  await pool.query(`INSERT INTO sx_retail_catalogue_import_images
      (tenant_id,connection_id,external_product_id,image_index,product_id,image_media_id,image_url_hash,image_state,attempt_count,retry_after,last_error_code)
    VALUES (?,?,?,?,?,NULL,?,'failed',1,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE),?)
    ON DUPLICATE KEY UPDATE product_id=VALUES(product_id),image_url_hash=COALESCE(VALUES(image_url_hash),image_url_hash),
      image_state='failed',attempt_count=LEAST(attempt_count+1,65535),
      retry_after=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE),last_error_code=VALUES(last_error_code),updated_at=UTC_TIMESTAMP(3)`,
  [connection.tenant_id, connection.id, externalProductId, imageIndex, productId, hash, code]);
  if (imageIndex === 0) {
    await pool.query(`INSERT INTO sx_retail_catalogue_import_media
        (tenant_id,connection_id,external_product_id,product_id,image_media_id,image_url_hash,image_state,attempt_count,retry_after,last_error_code)
      VALUES (?,?,?,?,NULL,?,'failed',1,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE),?)
      ON DUPLICATE KEY UPDATE product_id=VALUES(product_id),image_url_hash=COALESCE(VALUES(image_url_hash),image_url_hash),
        image_state='failed',attempt_count=LEAST(attempt_count+1,65535),
        retry_after=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE),last_error_code=VALUES(last_error_code),updated_at=UTC_TIMESTAMP(3)`,
    [connection.tenant_id, connection.id, externalProductId, productId, hash, code]);
  }
}

async function eraseConnection(db, tenantId, connectionId) {
  const [rows] = await db.query(`SELECT DISTINCT m.id AS mediaId,m.course_id AS productId,m.storage_key AS storageKey
    FROM sx_retail_catalogue_import_images i JOIN sx_product_media m
      ON m.tenant_id=i.tenant_id AND m.id=i.image_media_id AND m.course_id=i.product_id
    WHERE i.tenant_id=? AND i.connection_id=? AND m.deleted_at IS NULL`, [tenantId, connectionId]);
  if (rows.length) {
    const mediaIds = rows.map(row => row.mediaId);
    await db.query(`UPDATE sx_retail_listings SET photo_id=NULL WHERE tenant_id=? AND photo_id IN (?)`, [tenantId, mediaIds]);
    await db.query(`UPDATE sx_product_media SET deleted_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id IN (?)`, [tenantId, mediaIds]);
  }
  await db.query('DELETE FROM sx_retail_catalogue_import_images WHERE tenant_id=? AND connection_id=?', [tenantId, connectionId]);
  await db.query('DELETE FROM sx_retail_catalogue_import_media WHERE tenant_id=? AND connection_id=?', [tenantId, connectionId]);
  return rows.map(row => media.filePath(tenantId, row.productId, row.storageKey));
}

async function removeFiles(files) {
  await Promise.all((files || []).map(file => fs.rm(file, { force: true }).catch(() => {})));
}

module.exports = { safeUrl, queue, queueImages, queueGalleryIndex, importImage, markFailure, eraseConnection, removeFiles, MAX_SOURCE_BYTES, MAX_IMAGE_PIXELS };
