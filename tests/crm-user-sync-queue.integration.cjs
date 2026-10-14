require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { splitSql } = require('../database/migration-runner');

async function main() {
  const host = String(process.env.DBHOST || '').toLowerCase();
  if (process.env.LOCAL_ONLY_MODE !== 'true' || !['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('LOCAL_DATABASE_ONLY');
  }
  const config = {
    host: process.env.DBHOST,
    port: Number(process.env.DBPORT || 3306),
    user: process.env.DBUSER,
    password: process.env.DBPASS === '__EMPTY__' ? '' : process.env.DBPASS,
  };
  if (!config.user) throw new Error('DATABASE_CONFIG_REQUIRED');
  const database = `salemax_sync_queue_test_${crypto.randomBytes(6).toString('hex')}`;
  const admin = await mysql.createConnection(config);
  let first, second, created = false, stage = 'connect';
  try {
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    first = await mysql.createConnection({ ...config, database });
    second = await mysql.createConnection({ ...config, database });
    const file = path.join(__dirname, '../database/migrations/20261206_legacy_crm_user_sync_queue.sql');
    const statements = splitSql(fs.readFileSync(file, 'utf8'));
    assert.equal(statements.length, 1);
    stage = 'create_queue';
    await first.query(statements[0]);

    const uid = 'synthetic-queue-user';
    const enqueue = `INSERT INTO crm_user_sync_queue (uid, attempts, next_attempt_at, last_status)
      VALUES (?, 0, NOW(), NULL)
      ON DUPLICATE KEY UPDATE attempts = 0, next_attempt_at = NOW(), last_status = NULL`;
    stage = 'concurrent_enqueue';
    await Promise.all([first.query(enqueue, [uid]), second.query(enqueue, [uid])]);
    const [[job]] = await first.query('SELECT uid, attempts, last_status FROM crm_user_sync_queue WHERE uid=?', [uid]);
    assert.deepEqual(job, { uid, attempts: 0, last_status: null });
    stage = 'retry_backoff';
    await first.query(`UPDATE crm_user_sync_queue SET attempts=attempts+1,
      next_attempt_at=DATE_ADD(NOW(), INTERVAL 30 SECOND), last_status=? WHERE uid=?`, ['http_503', uid]);
    const [[retry]] = await second.query('SELECT attempts,last_status,next_attempt_at>NOW() AS retry_delayed FROM crm_user_sync_queue WHERE uid=?', [uid]);
    assert.equal(Number(retry.attempts), 1);
    assert.equal(retry.last_status, 'http_503');
    assert.equal(Number(retry.retry_delayed), 1);
    stage = 'success_cleanup';
    await second.query('DELETE FROM crm_user_sync_queue WHERE uid=?', [uid]);
    const [[count]] = await first.query('SELECT COUNT(*) AS n FROM crm_user_sync_queue');
    assert.equal(Number(count.n), 0);
    console.log(JSON.stringify({ disposableMySql: true, concurrentEnqueueIsIdempotent: true, retryBackoffStored: true, successfulSyncCanClearJob: true, businessDataTouched: false, externalWrites: false }));
  } finally {
    if (second) await second.end();
    if (first) await first.end();
    if (created) await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  }
}

main().catch(error => {
  console.error('CRM sync queue integration failed:', error.code || 'ERROR', error.message || '');
  process.exitCode = 1;
});
