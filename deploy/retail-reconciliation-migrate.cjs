'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const migrations = [
  '20270205_retail_woocommerce_variations_reconciliation.sql',
  '20270206_retail_external_product_mappings.sql',
  '20270207_retail_exact_inventory_quantities.sql',
  '20270208_retail_woocommerce_stock_mapping.sql',
  '20270209_retail_inventory_alerts.sql',
  '20270210_retail_external_order_source_dates.sql',
  '20270211_retail_woocommerce_stock_management_modes.sql',
  '20270212_retail_inventory_unit_recount.sql',
];

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

function verifyApplied(before, after, manifest, plans) {
  assert.equal(after.total, before.total + migrations.length, 'Unexpected migration ledger changes');
  assert.equal(sha(JSON.stringify(after.rows.filter(row => !migrations.includes(row.migration_name)))),
    before.checksum, 'An existing migration ledger record changed');
  migrations.forEach(name => {
    const row = after.rows.find(item => item.migration_name === name);
    assert.equal(row?.status, 'applied', 'Retail migration missing from applied ledger');
    assert.equal(row.checksum, manifest[name].sha256, 'Retail migration checksum changed');
    assert.equal(row.statements_completed, plans.get(name).statements.length, 'Incomplete Retail migration');
    assert.equal(row.statement_count, row.statements_completed, 'Retail migration statement count differs');
  });
}

async function counts(connection) {
  const [[row]] = await connection.query(
    'SELECT (SELECT COUNT(*) FROM sx_retail_external_products) AS importedProducts, ' +
    '(SELECT COUNT(*) FROM sx_retail_external_orders) AS importedOrders, ' +
    '(SELECT COUNT(*) FROM sx_retail_external_customers) AS importedCustomers, ' +
    '(SELECT COUNT(*) FROM sx_retail_orders) AS nativeOrders, ' +
    '(SELECT COUNT(*) FROM sx_business_stock_movements) AS stockMovements'
  );
  return row;
}

async function checkSchema(connection) {
  const [rows] = await connection.query(
    "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS " +
    "WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='sx_business_stock_movements' AND COLUMN_NAME IN " +
    "('quantity','previous_quantity','previous_unit_revision','unit_revision','unit_rebase_id')) OR " +
    "(TABLE_NAME IN ('sx_retail_stock_reservations','sx_retail_stock_transfers','sx_retail_return_lines') AND COLUMN_NAME='quantity'))"
  );
  assert.equal(rows.length, 8, 'Retail quantity or unit columns are missing');
  rows.filter(row => ['quantity', 'previous_quantity'].includes(row.COLUMN_NAME)).forEach(row =>
    assert.equal(row.COLUMN_TYPE, 'decimal(20,6) unsigned', 'Retail stock precision differs')
  );
  const [[row]] = await connection.query(
    "SELECT COUNT(*) AS present FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN " +
    "('sx_retail_external_product_variants','sx_retail_external_product_mappings','sx_retail_product_inventory_units'," +
    "'sx_retail_inventory_location_thresholds','sx_retail_inventory_alert_states'," +
    "'sx_retail_inventory_unit_rebases','sx_retail_product_inventory_unit_versions')"
  );
  assert.equal(row.present, 7, 'Retail reconciliation tables are missing');
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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'retail-migrations-'));
  let connection;
  try {
    connection = await pool.getConnection();
    if (restored) {
      const [schemas] = await connection.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA " +
        "WHERE SCHEMA_NAME NOT IN ('information_schema','mysql','performance_schema','sys')");
      assert.equal(schemas.length, 1, 'Expected a single restored application schema');
      await connection.query('USE ' + mysql.escapeId(schemas[0].SCHEMA_NAME));
    }
    await connection.query('SET SESSION lock_wait_timeout=20, SESSION innodb_lock_wait_timeout=20');
    fs.cpSync(path.join(runtime, 'migrations'), directory, { recursive: true });
    for (const name of migrations) {
      const source = Buffer.from(manifest[name].source, 'base64');
      assert.equal(sha(source), manifest[name].sha256, 'Retail migration artifact hash differs');
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
    if (request.baseline) assert.deepEqual(baseline, request.baseline, 'Production migration history changed');
    for (const row of before.rows) {
      assert.equal(row.status, 'applied', 'Migration ledger has an incomplete migration');
      assert.equal(plans.get(row.migration_name)?.checksum, row.checksum, 'Live migration history differs');
    }

    if (mode === 'verify') {
      verifyApplied(baseline, before, manifest, plans);
      await checkSchema(connection);
      console.log(JSON.stringify({ mode, applied: migrations, total: before.total, counts: await counts(connection) }));
      return;
    }

    assert.equal(before.total, baseline.total, 'A selected Retail migration already exists');
    if (!restored) assert(!process.env.SALEMAX_RETAIL_CONNECTOR_PILOT_TENANTS?.trim(),
      'Existing pilot configuration requires a separate credential check');
    const beforeCounts = await counts(connection);
    const result = await runner.applyMigrations(connection, discovered, { only: migrations });
    assert.deepEqual(result, { applied: migrations, skipped: [] });
    const after = await ledger(connection);
    verifyApplied(baseline, after, manifest, plans);
    await checkSchema(connection);
    if (restored) {
      assert.deepEqual(await counts(connection), beforeCounts, 'Restore rehearsal changed operational row counts');
      const repeat = await runner.applyMigrations(connection, discovered, { only: migrations });
      assert.deepEqual(repeat, { applied: [], skipped: migrations });
    }
    console.log(JSON.stringify({ mode, baseline, applied: migrations, total: after.total, counts: await counts(connection) }));
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
