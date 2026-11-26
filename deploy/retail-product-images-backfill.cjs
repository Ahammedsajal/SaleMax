'use strict';

const pool = require('./database/config').promise();
const backfill = require('./modules/platform/retail-native-import-backfill');

async function main() {
  let connection;
  try {
    const raw = String(process.argv[2] || '').trim();
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (host !== 'essentialsbyd.com' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) {
      throw Object.assign(Error('RETAIL_PRODUCT_IMAGE_TARGET_DENIED'), { code: 'RETAIL_PRODUCT_IMAGE_TARGET_DENIED' });
    }
    const [rows] = await pool.query(`SELECT id,tenant_id,provider,store_domain,default_currency,created_by_identity_id
      FROM sx_retail_store_connections WHERE status='active' AND provider='woocommerce' AND store_domain=? LIMIT 2`,
    [host]);
    if (rows.length !== 1) throw Object.assign(Error('RETAIL_PRODUCT_IMAGE_TARGET_NOT_UNIQUE'), { code: 'RETAIL_PRODUCT_IMAGE_TARGET_NOT_UNIQUE' });
    connection = rows[0];
    let imported = 0, failures = 0, remaining = 0, rounds = 0;
    for (; rounds < 20; rounds++) {
      const result = await backfill.backfillProductImagesOnly(pool, connection, { limit: 25 });
      imported += result.images;
      failures += result.failed;
      remaining = result.pendingImages;
      if (!remaining) { rounds++; break; }
    }
    const [[catalogue]] = await pool.query(`SELECT COUNT(*) AS importedItems,
        COALESCE(SUM(p.status='active'),0) AS publishedItems,COALESCE(SUM(p.status='draft'),0) AS draftItems
      FROM sx_retail_catalogue_imports i JOIN sx_product_catalog p ON p.tenant_id=i.tenant_id AND p.id=i.product_id
      WHERE i.tenant_id=? AND i.connection_id=? AND i.review_state<>'source_deleted' AND p.deleted_at IS NULL`,
    [connection.tenant_id, connection.id]);
    const [[images]] = await pool.query(`SELECT COALESCE(SUM(image_state='ready'),0) AS ready,
        COALESCE(SUM(image_state='failed'),0) AS failed,COALESCE(SUM(image_state='none'),0) AS noImage
      FROM sx_retail_catalogue_import_media WHERE tenant_id=? AND connection_id=?`, [connection.tenant_id, connection.id]);
    console.log(JSON.stringify({ storeMatches: rows.length, rounds, imagesProcessed: imported, failures,
      remainingImages: remaining, catalogue, images }));
    if (Number(catalogue.draftItems) > 0) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  const code = /^[A-Z0-9_]{1,64}$/.test(String(error?.code || '')) ? error.code : 'RETAIL_PRODUCT_IMAGE_BACKFILL_FAILED';
  console.error(JSON.stringify({ code }));
  process.exitCode = 1;
});
