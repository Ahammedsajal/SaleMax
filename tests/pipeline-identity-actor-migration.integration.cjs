'use strict';

const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');
const path = require('node:path');
const { discover, applyMigrations } = require('../database/migration-runner');

async function main() {
  const host = process.env.DBHOST;
  const port = Number(process.env.DBPORT);
  const database = process.env.SALEMAX_TEST_DATABASE;
  if (process.env.LOCAL_ONLY_MODE !== 'true' || !['127.0.0.1', 'localhost', '::1'].includes(host) ||
      !Number.isSafeInteger(port) || port < 1 || port > 65535 ||
      !/^salemax_migration_test_[a-z0-9_]{1,40}$/.test(database || '') ||
      typeof process.env.DBUSER !== 'string' || !process.env.DBUSER ||
      typeof process.env.DBPASS !== 'string' || !process.env.DBPASS) {
    throw new Error('DISPOSABLE_LOCAL_MARIADB_REQUIRED');
  }

  const db = await mysql.createConnection({ host, port, user: process.env.DBUSER, password: process.env.DBPASS, database, connectTimeout: 5000 });
  try {
    const [[server]] = await db.query('SELECT VERSION() AS version, DATABASE() AS databaseName');
    assert.match(server.version, /mariadb/i, 'the focused migration check requires MariaDB');
    assert.equal(server.databaseName, database);
    const [[existing]] = await db.query('SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
    assert.equal(Number(existing.count), 0, 'refusing to mutate a non-empty test database');

    await db.query(`CREATE TABLE pipeline_activity (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      uid_hash CHAR(64) NOT NULL,
      lead_id CHAR(36) NOT NULL,
      actor_type ENUM('user','agent','system') NOT NULL DEFAULT 'system',
      actor_id VARCHAR(191) NULL,
      activity_type VARCHAR(64) NOT NULL,
      summary VARCHAR(500) NOT NULL,
      details LONGTEXT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY idx_pipeline_activity_lead (uid_hash,lead_id,created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    const name = '20261022_pipeline_identity_activity_actor.sql';
    const migrations = discover(path.join(__dirname, '../database/migrations'));
    const result = await applyMigrations(db, migrations, { only: name });
    assert.deepEqual(result.applied, [name]);
    const [[column]] = await db.query(`SELECT COLUMN_TYPE AS columnType FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='pipeline_activity' AND COLUMN_NAME='actor_type'`);
    assert.match(column.columnType, /'user'.*'agent'.*'identity'.*'system'/);

    const actors = ['user', 'agent', 'identity', 'system'];
    for (const [index, actorType] of actors.entries()) {
      await db.query('INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,actor_id,activity_type,summary) VALUES (?,?,?,?,?,?)',
        [String(index + 1).repeat(64), `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, actorType, `actor-${actorType}`, 'migration_test', 'Synthetic migration actor']);
    }
    const [rows] = await db.query('SELECT actor_type AS actorType FROM pipeline_activity ORDER BY id');
    assert.deepEqual(rows.map(row => row.actorType), actors);
    console.log(JSON.stringify({ mariaDb: server.version, databaseIsDisposable: true, migration: name, preservedActors: actors, canonicalIdentityActivityAccepted: true, customerDataTouched: false, externalWrites: false }));
  } finally {
    await db.end();
  }
}

main().catch(error => {
  process.stderr.write(`${error.code || error.message || 'PIPELINE_IDENTITY_MIGRATION_FAILED'}\n`);
  process.exitCode = 1;
});
