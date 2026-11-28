'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const migrations = ['20270215_retail_product_image_gallery.sql'];
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

async function ledger(connection) {
  const [rows] = await connection.query(
    'SELECT migration_name,checksum,status,statement_count,statements_completed FROM salemax_schema_migrations ORDER BY migration_name'
  );
  return { total: rows.length, checksum: sha(JSON.stringify(rows)), rows };
}

function verifyApplied(baseline, after, manifest, plans) {
  assert.equal(after.total, baseline.total + migrations.length, 'Unexpected migration ledger changes');
  const prior = after.rows.filter(row => !migrations.includes(row.migration_name));
  assert.equal(sha(JSON.stringify(prior)), baseline.checksum, 'An existing migration ledger record changed');
  for (const name of migrations) {
    const row = after.rows.find(item => item.migration_name === name);
    assert.equal(row?.status, 'applied', 'Retail product image migration is missing');
    assert.equal(row.checksum, manifest[name].sha256, 'Retail migration checksum changed');
    assert.equal(row.statements_completed, plans.get(name).statements.length, 'Retail migration is incomplete');
    assert.equal(row.statement_count, row.statements_completed, 'Retail migration statement count differs');
  }
}

async function operationalCounts(connection) {
  const [[row]] = await connection.query(
    'SELECT (SELECT COUNT(*) FROM sx_retail_external_products) AS importedProducts,' +
    '(SELECT COUNT(*) FROM sx_retail_external_orders) AS importedOrders,' +
    '(SELECT COUNT(*) FROM sx_retail_external_customers) AS importedCustomers,' +
    '(SELECT COUNT(*) FROM sx_retail_orders) AS nativeOrders,' +
    '(SELECT COUNT(*) FROM sx_business_stock_movements) AS stockMovements'
  );
  return row;
}

async function resultCounts(connection) {
  const [[row]] = await connection.query(
    'SELECT (SELECT COUNT(*) FROM sx_retail_catalogue_imports) AS nativeProductImports,' +
    '(SELECT COUNT(*) FROM sx_retail_catalogue_import_media) AS productImageMappings,' +
    '(SELECT COUNT(*) FROM sx_retail_catalogue_import_images WHERE image_index<12) AS productGalleryImages,' +
    '(SELECT COUNT(*) FROM sx_retail_customer_search_tokens) AS customerSearchTokens,' +
    '(SELECT COUNT(*) FROM sx_retail_orders WHERE external_source_connection_id IS NOT NULL) AS nativeImportedOrders'
  );
  return row;
}

async function checkSchema(connection) {
  const expectedTables = ['sx_retail_catalogue_import_images','sx_retail_catalogue_import_media'];
  const [tables] = await connection.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?) ORDER BY TABLE_NAME',
    expectedTables
  );
  assert.deepEqual(tables.map(row => row.TABLE_NAME), expectedTables, 'Retail product image tables are missing');
  const [columns] = await connection.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',
    ['sx_retail_catalogue_import_images']
  );
  const expected = ['attempt_count','connection_id','external_product_id','image_index','image_media_id','image_state',
    'image_url_hash','last_error_code','product_id','retry_after','tenant_id','updated_at'].sort();
  assert.deepEqual(columns.map(row => row.COLUMN_NAME).sort(), expected, 'Retail product gallery columns differ');
  const [[mappings]] = await connection.query(`SELECT
    (SELECT COUNT(*) FROM sx_retail_catalogue_import_media) AS legacyCovers,
    (SELECT COUNT(*) FROM sx_retail_catalogue_import_images WHERE image_index=0) AS galleryCovers`);
  assert.equal(Number(mappings.galleryCovers), Number(mappings.legacyCovers), 'Legacy cover mappings were not preserved');
  const [[drafts]] = await connection.query(`SELECT COUNT(*) AS n FROM sx_product_catalog p
    JOIN sx_retail_catalogue_imports i ON i.tenant_id=p.tenant_id AND i.product_id=p.id
    WHERE p.catalogue_kind='product' AND p.status='draft' AND p.deleted_at IS NULL AND i.review_state<>'source_deleted'`);
  assert.equal(Number(drafts.n), 0, 'Imported products remain in draft status');
}

async function main() {
  const mode = process.argv[1];
  const restored = mode === 'rehearse';
  assert(['rehearse','apply','verify'].includes(mode));
  assert.equal(restored, process.env.RETAIL_RESTORE_ONLY === '1');
  const request = JSON.parse(fs.readFileSync(0, 'utf8'));
  const manifest = request.migrations;
  assert.deepEqual(Object.keys(manifest).sort(), migrations);
  const runtime = restored ? '/retail-baseline' : path.resolve('database');
  const runner = require(path.join(runtime, 'migration-runner.js'));
  const mysql = require('mysql2/promise');
  const pool = restored
    ? mysql.createPool({ host: '127.0.0.1', user: 'root', password: '', connectionLimit: 1 })
    : require('./database/config').promise();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'retail-product-images-migration-'));
  let connection;
  try {
    connection = await pool.getConnection();
    if (restored) {
      const [schemas] = await connection.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('information_schema','mysql','performance_schema','sys')");
      assert.equal(schemas.length, 1, 'Expected one restored application schema');
      await connection.query('USE ' + mysql.escapeId(schemas[0].SCHEMA_NAME));
    }
    await connection.query('SET SESSION lock_wait_timeout=20,SESSION innodb_lock_wait_timeout=20');
    fs.cpSync(path.join(runtime, 'migrations'), directory, { recursive: true });
    for (const name of migrations) {
      const source = Buffer.from(manifest[name].source, 'base64');
      assert.equal(sha(source), manifest[name].sha256, 'Migration artifact hash differs');
      const destination = path.join(directory, name);
      if (fs.existsSync(destination)) assert.equal(sha(fs.readFileSync(destination)), manifest[name].sha256, 'Mounted migration differs');
      else fs.writeFileSync(destination, source, { flag: 'wx', mode: 0o600 });
    }
    const discovered = runner.discover(directory);
    const plans = new Map(discovered.map(migration => [migration.file, migration]));
    const before = await ledger(connection);
    const prior = before.rows.filter(row => !migrations.includes(row.migration_name));
    const baseline = { total: prior.length, checksum: sha(JSON.stringify(prior)) };
    if (request.baseline) assert.deepEqual(baseline, request.baseline, 'Migration history changed during release');
    for (const row of prior) {
      assert.equal(row.status, 'applied', 'An existing migration is incomplete');
      assert.equal(plans.get(row.migration_name)?.checksum, row.checksum, 'An existing migration checksum differs');
    }

    if (mode === 'verify') {
      verifyApplied(baseline, before, manifest, plans);
      await checkSchema(connection);
      console.log(JSON.stringify({ mode, applied: migrations, total: before.total, counts: await resultCounts(connection) }));
      return;
    }

    if (!restored) assert(!process.env.SALEMAX_RETAIL_CONNECTOR_PILOT_TENANTS?.trim(),
      'Active connector pilot requires separate readiness verification');
    const beforeCounts = await operationalCounts(connection);
    const selected = before.rows.filter(row => migrations.includes(row.migration_name));
    let result, after;
    if (selected.length) {
      verifyApplied(baseline, before, manifest, plans);
      result = { applied: [], skipped: migrations };
      after = before;
    } else {
      assert.equal(before.total, baseline.total, 'Unexpected migration ledger changes before Retail product migration');
      result = await runner.applyMigrations(connection, discovered, { only: migrations });
      assert.deepEqual(result, { applied: migrations, skipped: [] });
      after = await ledger(connection);
    }
    verifyApplied(baseline, after, manifest, plans);
    await checkSchema(connection);
    if (restored) {
      assert.deepEqual(await operationalCounts(connection), beforeCounts, 'Restore rehearsal changed operational row counts');
      const repeat = await runner.applyMigrations(connection, discovered, { only: migrations });
      assert.deepEqual(repeat, { applied: [], skipped: migrations });
    }
    console.log(JSON.stringify({ mode, baseline, applied: result.applied, skipped: result.skipped,
      total: after.total, counts: await resultCounts(connection) }));
  } catch (error) {
    if (connection) {
      const state = await ledger(connection).catch(() => null);
      if (state) console.error(JSON.stringify({ selected: state.rows.filter(row => migrations.includes(row.migration_name))
        .map(row => ({ migration: row.migration_name, status: row.status, statements: row.statements_completed })) }));
    }
    throw error;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    if (connection) connection.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ code: error.code || error.name }));
  process.exitCode = 1;
});
