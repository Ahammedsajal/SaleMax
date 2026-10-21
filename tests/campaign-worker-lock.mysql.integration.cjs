'use strict';

// Run only against a disposable local MySQL/MariaDB server. This script creates
// and drops one randomly named synthetic database and never reads app tables.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const { acquireCampaignWorkerLock } = require('../modules/platform/campaign-worker-lock');

async function main() {
  if (process.env.CAMPAIGN_LOCK_TEST_TARGET !== 'local-disposable') {
    throw new Error('SET_CAMPAIGN_LOCK_TEST_TARGET_TO_LOCAL_DISPOSABLE');
  }
  const socketPath = process.env.CAMPAIGN_LOCK_TEST_SOCKET;
  const host = process.env.CAMPAIGN_LOCK_TEST_HOST || '127.0.0.1';
  if (!socketPath && !['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('CAMPAIGN_LOCK_TEST_MUST_USE_LOCAL_DATABASE');
  }
  const connection = {
    ...(socketPath ? { socketPath } : { host }),
    port: Number(process.env.CAMPAIGN_LOCK_TEST_PORT || 3306),
    user: process.env.CAMPAIGN_LOCK_TEST_USER,
    password: process.env.CAMPAIGN_LOCK_TEST_PASSWORD || '',
  };
  if (!connection.user) throw new Error('CAMPAIGN_LOCK_TEST_USER_REQUIRED');

  const admin = await mysql.createConnection(connection);
  const schema = `seven_lock_test_${crypto.randomBytes(8).toString('hex')}`;
  let pool, evidence;
  try {
    await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
    pool = mysql.createPool({ ...connection, database: schema, connectionLimit: 4 });

    const first = await acquireCampaignWorkerLock(pool, 'synthetic-owner-a', 'synthetic-campaign-1');
    assert.ok(first, 'first worker acquires the campaign lock');
    await first.assertHeld();
    assert.equal(await acquireCampaignWorkerLock(pool, 'synthetic-owner-a', 'synthetic-campaign-1'), null,
      'second session cannot acquire the same campaign concurrently');

    const otherTenant = await acquireCampaignWorkerLock(pool, 'synthetic-owner-b', 'synthetic-campaign-1');
    assert.ok(otherTenant, 'same campaign identifier remains independent across tenants');
    await otherTenant.assertHeld();
    await first.release();

    const recovered = await acquireCampaignWorkerLock(pool, 'synthetic-owner-a', 'synthetic-campaign-1');
    assert.ok(recovered, 'lock is available after explicit release');
    await recovered.release();
    await otherTenant.release();

    const lost = await acquireCampaignWorkerLock(pool, 'synthetic-owner-a', 'synthetic-campaign-2');
    assert.ok(lost);
    const [[session]] = await pool.query('SELECT IS_USED_LOCK(?) AS connectionId', [lost.name]);
    assert.ok(Number.isSafeInteger(Number(session.connectionId)));
    await admin.query(`KILL ${Number(session.connectionId)}`);
    await assert.rejects(lost.assertHeld());
    await lost.release();

    evidence = {
      databaseVersion: (await admin.query('SELECT VERSION() AS version'))[0][0].version,
      independentDatabaseSessions: true,
      tenantScopedLockNames: true,
      deadSessionReleasesLock: true,
      syntheticDatabaseDropped: true,
    };
  } finally {
    if (pool) await pool.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.end();
  }
  console.log(JSON.stringify(evidence));
}

main().catch(error => {
  console.error('Campaign lock integration failed:', error.code || error.message);
  process.exitCode = 1;
});
