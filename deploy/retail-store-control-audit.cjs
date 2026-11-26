'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function main() {
  const mode = process.argv[1];
  const restored = mode === 'rehearse';
  assert(['rehearse', 'apply', 'verify'].includes(mode));
  assert.equal(restored, process.env.RETAIL_RESTORE_ONLY === '1');
  const request = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
  assert.deepEqual(request.migrations, {}, 'Store Connections release must not select migrations');

  const runtime = restored ? '/retail-baseline' : path.resolve('database');
  const runner = require(path.join(runtime, 'migration-runner.js'));
  const mysql = require('mysql2/promise');
  const pool = restored
    ? mysql.createPool({ host: '127.0.0.1', user: 'root', password: '', connectionLimit: 1 })
    : require('./database/config').promise();
  let connection;
  try {
    connection = await pool.getConnection();
    if (restored) {
      const [schemas] = await connection.query(
        "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA " +
        "WHERE SCHEMA_NAME NOT IN ('information_schema','mysql','performance_schema','sys')"
      );
      assert.equal(schemas.length, 1, 'Expected one restored application schema');
      await connection.query('USE ' + mysql.escapeId(schemas[0].SCHEMA_NAME));
    }

    const discovered = runner.discover(path.join(runtime, 'migrations'));
    const [rows] = await connection.query(
      'SELECT migration_name, checksum, status, statement_count, statements_completed ' +
      'FROM salemax_schema_migrations ORDER BY migration_name'
    );
    for (const row of rows) {
      assert.equal(row.status, 'applied', 'Migration ledger contains an incomplete row');
      assert.equal(discovered.find(item => item.file === row.migration_name)?.checksum, row.checksum,
        'Migration source differs from the applied ledger');
      assert.equal(row.statement_count, row.statements_completed, 'Migration statement count is incomplete');
    }
    const baseline = { total: rows.length, checksum: sha(JSON.stringify(rows)) };
    if (request.baseline) assert.deepEqual(baseline, request.baseline, 'Database migration ledger changed');
    const result = { mode, baseline, applied: [], migrationChanges: 0 };
    console.log(JSON.stringify(result));
  } finally {
    if (connection) connection.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error?.message || 'STORE_CONTROL_RELEASE_AUDIT_FAILED');
  process.exitCode = 1;
});
