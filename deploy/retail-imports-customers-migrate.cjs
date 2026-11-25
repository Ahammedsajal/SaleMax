'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const migrations = ['20270213_retail_native_store_imports.sql'];

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function ledger(connection) {
  const [rows] = await connection.query(
    'SELECT migration_name, checksum, status, statement_count, statements_completed ' +
    'FROM salemax_schema_migrations ORDER BY migration_name'
  );
  return { total: rows.length, checksum: sha(JSON.stringify(rows)), rows };
}

function verifyApplied(baseline, after, manifest, plans) {
  assert.equal(after.total, baseline.total + migrations.length, 'Unexpected migration ledger changes');
  const prior = after.rows.filter(row => !migrations.includes(row.migration_name));
  assert.equal(sha(JSON.stringify(prior)), baseline.checksum, 'An existing migration ledger record changed');
  for (const name of migrations) {
    const row = after.rows.find(item => item.migration_name === name);
    assert.equal(row?.status, 'applied', 'Retail native import migration is missing');
    assert.equal(row.checksum, manifest[name].sha256, 'Retail migration checksum changed');
    assert.equal(row.statements_completed, plans.get(name).statements.length, 'Retail migration is incomplete');
    assert.equal(row.statement_count, row.statements_completed, 'Retail migration statement count differs');
  }
}

async function operationalCounts(connection) {
  const [[row]] = await connection.query(
    'SELECT (SELECT COUNT(*) FROM sx_retail_external_products) AS importedProducts, ' +
    '(SELECT COUNT(*) FROM sx_retail_external_orders) AS importedOrders, ' +
    '(SELECT COUNT(*) FROM sx_retail_external_customers) AS importedCustomers, ' +
    '(SELECT COUNT(*) FROM sx_retail_orders) AS nativeOrders, ' +
    '(SELECT COUNT(*) FROM sx_business_stock_movements) AS stockMovements'
  );
  return row;
}

async function resultCounts(connection) {
  const [[row]] = await connection.query(
    'SELECT (SELECT COUNT(*) FROM sx_retail_external_products) AS importedProducts, ' +
    '(SELECT COUNT(*) FROM sx_retail_external_orders) AS importedOrders, ' +
    '(SELECT COUNT(*) FROM sx_retail_external_customers) AS importedCustomers, ' +
    '(SELECT COUNT(*) FROM sx_retail_catalogue_imports) AS nativeProductImports, ' +
    '(SELECT COUNT(*) FROM sx_retail_customer_search_tokens) AS customerSearchTokens, ' +
    '(SELECT COUNT(*) FROM sx_retail_orders WHERE external_source_connection_id IS NOT NULL) AS nativeImportedOrders'
  );
  return row;
}

async function checkSchema(connection) {
  const expectedColumns = [
    'sx_retail_store_connections.credentials_verified_at',
    'sx_product_catalog.catalogue_kind', 'sx_product_catalog.parent_product_id',
    'sx_product_offers.source_connection_id', 'sx_product_offers.source_external_product_id',
    'sx_product_offers.source_external_variant_id',
    'sx_retail_external_customers.customer_directory_key', 'sx_retail_external_customers.email_lookup_hash',
    'sx_retail_external_orders.customer_directory_key', 'sx_retail_external_orders.email_lookup_hash',
    'sx_retail_orders.currency', 'sx_retail_orders.customer_directory_key',
    'sx_retail_orders.external_source_connection_id', 'sx_retail_orders.external_source_order_id',
    'sx_retail_orders.source_order_status', 'sx_retail_orders.source_financial_status',
    'sx_retail_orders.source_total_amount', 'sx_retail_orders.source_refund_amount',
  ].sort();
  const clauses = expectedColumns.map(() => '(TABLE_NAME=? AND COLUMN_NAME=?)').join(' OR ');
  const [columns] = await connection.query(
    'SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND (' + clauses + ')',
    expectedColumns.flatMap(item => item.split('.'))
  );
  assert.deepEqual(columns.map(row => `${row.TABLE_NAME}.${row.COLUMN_NAME}`).sort(), expectedColumns,
    'Retail native import columns differ');
  const [[location]] = await connection.query(
    "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sx_retail_orders' AND COLUMN_NAME='location_id'"
  );
  assert.equal(location?.IS_NULLABLE, 'YES', 'Imported source orders must allow an unassigned location');
  const [tables] = await connection.query(
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ' +
    'AND TABLE_NAME IN (?,?)',
    ['sx_retail_catalogue_imports', 'sx_retail_customer_search_tokens']
  );
  assert.deepEqual(tables.map(row => row.TABLE_NAME).sort(),
    ['sx_retail_catalogue_imports', 'sx_retail_customer_search_tokens'], 'Retail native import tables are missing');
}

async function main() {
  const mode = process.argv[1];
  const restored = mode === 'rehearse';
  assert(['rehearse', 'apply', 'verify'].includes(mode));
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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'retail-import-migration-'));
  let connection;
  try {
    connection = await pool.getConnection();
    if (restored) {
      const [schemas] = await connection.query(
        "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN " +
        "('information_schema','mysql','performance_schema','sys')"
      );
      assert.equal(schemas.length, 1, 'Expected one restored application schema');
      await connection.query('USE ' + mysql.escapeId(schemas[0].SCHEMA_NAME));
    }
    await connection.query('SET SESSION lock_wait_timeout=20, SESSION innodb_lock_wait_timeout=20');
    fs.cpSync(path.join(runtime, 'migrations'), directory, { recursive: true });
    for (const name of migrations) {
      const source = Buffer.from(manifest[name].source, 'base64');
      assert.equal(sha(source), manifest[name].sha256, 'Migration artifact hash differs');
      const destination = path.join(directory, name);
      if (fs.existsSync(destination)) {
        assert.equal(sha(fs.readFileSync(destination)), manifest[name].sha256, 'Mounted migration differs');
      } else {
        fs.writeFileSync(destination, source, { flag: 'wx', mode: 0o600 });
      }
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

    assert.equal(before.total, baseline.total, 'The selected Retail migration already exists');
    if (!restored) assert(!process.env.SALEMAX_RETAIL_CONNECTOR_PILOT_TENANTS?.trim(),
      'Active connector pilot requires separate readiness verification');
    const beforeCounts = await operationalCounts(connection);
    const result = await runner.applyMigrations(connection, discovered, { only: migrations });
    assert.deepEqual(result, { applied: migrations, skipped: [] });
    const after = await ledger(connection);
    verifyApplied(baseline, after, manifest, plans);
    await checkSchema(connection);
    if (restored) {
      assert.deepEqual(await operationalCounts(connection), beforeCounts, 'Restore rehearsal changed operational row counts');
      const repeat = await runner.applyMigrations(connection, discovered, { only: migrations });
      assert.deepEqual(repeat, { applied: [], skipped: migrations });
    }
    console.log(JSON.stringify({ mode, baseline, applied: migrations, total: after.total, counts: await resultCounts(connection) }));
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
