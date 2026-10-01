// Uses a fresh synthetic database only, never the imported training database.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const { discover, applyMigrations } = require('../database/migration-runner');
async function main() {
  if (process.env.LOCAL_ONLY_MODE !== 'true' || !['127.0.0.1', 'localhost', '::1'].includes(process.env.DBHOST)) throw new Error('LOCAL_DATABASE_ONLY');
  const db = 'salemax_migration_test_' + crypto.randomBytes(6).toString('hex');
  const config = { host: process.env.DBHOST, port: Number(process.env.DBPORT), user: process.env.DBUSER, password: process.env.DBPASS };
  const admin = await mysql.createConnection(config);
  let connection, other, created = false;
  try {
    await admin.query(`CREATE DATABASE \`${db}\``);
    created = true;
    connection = await mysql.createConnection({ ...config, database: db });
    other = await mysql.createConnection({ ...config, database: db });
    await connection.query('CREATE TABLE instance (id INT PRIMARY KEY, status VARCHAR(20))');
    await connection.query("INSERT INTO instance VALUES (1, 'INACTIVE')");
    const migrations = discover(path.join(__dirname, '../database/migrations'));
    const result = await applyMigrations(connection, migrations);
    assert.equal(result.applied.length, 3);
    assert.equal((await applyMigrations(connection, migrations)).skipped.length, 3);
    const [[instance]] = await connection.query('SELECT inactiveSince FROM instance WHERE id=1');
    assert.ok(instance.inactiveSince);
    await connection.query("INSERT INTO pipeline_settings(uid_hash, uid) VALUES (?, ?)", ['1'.repeat(64), 'synthetic-owner']);
    await applyMigrations(connection, migrations);
    const [[count]] = await connection.query('SELECT COUNT(*) AS n FROM pipeline_settings');
    assert.equal(count.n, 1);
    const lockName = 'salemax:migrate:' + crypto.createHash('sha256').update(db).digest('hex').slice(0,40);
    await connection.query('SELECT GET_LOCK(?, 0)', [lockName]);
    await assert.rejects(applyMigrations(other, migrations), { code: 'MIGRATION_LOCKED' });
    await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
    const broken = { file: '20261001_test_failure.sql', checksum: 'f'.repeat(64), statements: ['CREATE TABLE before_failure (id INT)', 'INVALID SQL'] };
    await assert.rejects(applyMigrations(connection, [...migrations, broken]), { code: 'MIGRATION_RECOVERY_REQUIRED' });
    const [[failed]] = await connection.query('SELECT status, statements_completed FROM salemax_schema_migrations WHERE migration_name=?', [broken.file]);
    assert.equal(failed.status, 'failed'); assert.equal(failed.statements_completed, 1);
    await assert.rejects(applyMigrations(other, [...migrations, broken]), { code: 'MIGRATION_RECOVERY_REQUIRED' });
    console.log(JSON.stringify({ realMariaDb: true, forwardMigrations: 3, repeatedRunsPreserveRecords: true, twoConnectionLock: true, ddlFailureRecoveryGate: true, customerDataTouched: false, externalWrites: false }));
  } finally {
    if (other) await other.end();
    if (connection) await connection.end();
    try { if (created) await admin.query(`DROP DATABASE IF EXISTS \`${db}\``); }
    finally { await admin.end(); }
  }
}
main().catch(error => { console.error('Migration integration failed:', error.code || error.message); process.exitCode=1; });
