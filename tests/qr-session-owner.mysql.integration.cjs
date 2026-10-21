'use strict';

// Run only against a disposable local MySQL/MariaDB server. Creates and drops
// one random database; it never connects to the application schema.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const { resolveQrSessionOwner } = require('../modules/platform/qr-session-owner');

async function main() {
  if (process.env.QR_SESSION_OWNER_TEST_TARGET !== 'local-disposable') {
    throw new Error('SET_QR_SESSION_OWNER_TEST_TARGET_TO_LOCAL_DISPOSABLE');
  }
  const socketPath = process.env.QR_SESSION_OWNER_TEST_SOCKET;
  const host = process.env.QR_SESSION_OWNER_TEST_HOST || '127.0.0.1';
  if (!socketPath && !['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('QR_SESSION_OWNER_TEST_MUST_USE_LOCAL_DATABASE');
  }
  const connection = {
    ...(socketPath ? { socketPath } : { host }),
    port: Number(process.env.QR_SESSION_OWNER_TEST_PORT || 3306),
    user: process.env.QR_SESSION_OWNER_TEST_USER,
    password: process.env.QR_SESSION_OWNER_TEST_PASSWORD || '',
  };
  if (!connection.user) throw new Error('QR_SESSION_OWNER_TEST_USER_REQUIRED');

  const admin = await mysql.createConnection(connection);
  const schema = `seven_qr_owner_test_${crypto.randomBytes(8).toString('hex')}`;
  let db, evidence;
  try {
    await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    db = await mysql.createConnection({ ...connection, database: schema });
    await db.query('CREATE TABLE instance(id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,uid VARCHAR(191) NOT NULL,uniqueId VARCHAR(191) NOT NULL,number VARCHAR(40),KEY idx_uniqueid(uniqueId)) ENGINE=InnoDB');
    await db.query('INSERT INTO instance(uid,uniqueId,number) VALUES (?,?,?)', ['actual-owner', 'otherprefix_custom-session', '97450000000']);
    await db.query('INSERT INTO instance(uid,uniqueId) VALUES (?,?),(?,?)', ['owner-a', 'duplicate-session', 'owner-b', 'duplicate-session']);

    const lookup = (id, uid = null) => resolveQrSessionOwner(async (sql, args) => (await db.query(sql, args))[0], id, uid);
    assert.deepEqual(await lookup('otherprefix_custom-session', 'actual-owner'), {
      instanceId: 1,
      uid: 'actual-owner',
      uniqueId: 'otherprefix_custom-session',
      number: '97450000000',
    });
    assert.equal(await lookup('otherprefix_custom-session', 'otherprefix'), null);
    assert.equal(await lookup('duplicate-session'), null);
    assert.equal(await lookup('missing-session'), null);

    await db.query('DELETE FROM instance WHERE uniqueId = ?', ['duplicate-session']);
    await db.query('ALTER TABLE instance ADD UNIQUE INDEX uq_instance_uniqueid (uniqueId(150))');

    const attempts = await Promise.allSettled([
      db.query('INSERT INTO instance(uid,uniqueId) VALUES (?,?)', ['race-a', 'concurrent-session']),
      db.query('INSERT INTO instance(uid,uniqueId) VALUES (?,?)', ['race-b', 'concurrent-session']),
    ]);
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter(result => result.status === 'rejected' && result.reason?.code === 'ER_DUP_ENTRY').length, 1);

    const [[server]] = await db.query('SELECT VERSION() AS version');
    evidence = { databaseVersion: server.version, ownerResolvedFromDatabase: true, ambiguousSessionDenied: true, concurrentDuplicateDenied: true };
  } finally {
    if (db) await db.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``);
    await admin.end();
  }
  console.log(JSON.stringify({ ...evidence, syntheticDatabaseDropped: true }));
}

main().catch(error => {
  console.error('QR session owner integration failed:', error.code || error.message);
  process.exitCode = 1;
});
