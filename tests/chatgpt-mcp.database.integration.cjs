'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { applyMigrations, discover } = require('../database/migration-runner');

async function main() {
  const socketPath = process.env.SALEMAX_TEST_DB_SOCKET || null;
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(process.env.DBHOST);
  if (process.env.LOCAL_ONLY_MODE !== 'true' || !loopback
      || process.env.MCP_SYNTHETIC_ONLY !== 'true'
      || !process.env.DBPASS || process.env.MCP_SYNTHETIC_PASSWORD !== process.env.DBPASS) {
    throw new Error('SYNTHETIC_DATABASE_REQUIRED');
  }
  if (socketPath && !path.isAbsolute(socketPath)) throw new Error('INVALID_SYNTHETIC_SOCKET');

  const databaseName = `salemax_mcp_test_${crypto.randomBytes(6).toString('hex')}`;
  if (!/^salemax_mcp_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('INVALID_SYNTHETIC_DATABASE_NAME');
  const config = {
    host: process.env.DBHOST,
    port: Number(process.env.DBPORT || 3306),
    user: process.env.DBUSER,
    password: process.env.DBPASS,
    ...(socketPath ? { socketPath } : {}),
  };
  const admin = await mysql.createConnection(config);
  let db;
  let second;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    db = await mysql.createConnection({ ...config, database: databaseName });
    second = await mysql.createConnection({ ...config, database: databaseName });

    const migrationsDirectory = path.join(__dirname, '../database/migrations');
    const discovered = discover(migrationsDirectory);
    assert.equal(discovered.some(migration => migration.file === '20261102_chatgpt_mcp_oauth_rollback.sql'), false, 'rollback migration is never auto-discovered');
    const migration = discovered.filter(item => item.file === '20261102_chatgpt_mcp_oauth.sql');
    assert.equal(migration.length, 1);
    const applied = await applyMigrations(db, migration);
    assert.deepEqual(applied.applied, ['20261102_chatgpt_mcp_oauth.sql']);

    const clientId = crypto.randomBytes(32).toString('base64url');
    const connectionId = crypto.randomUUID();
    const familyId = crypto.randomUUID();
    const identityId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    const uidHash = crypto.createHash('sha256').update('synthetic-owner').digest('hex');
    const redirect = 'https://chatgpt.com/connector/oauth/synthetic-callback';
    await db.query('INSERT INTO mcp_oauth_clients(client_id,client_name,redirect_uris) VALUES(?,?,?)', [clientId, 'Synthetic ChatGPT', JSON.stringify([redirect])]);
    await db.query(
      `INSERT INTO mcp_oauth_connections(id,client_id,source_table,source_id,identity_id,tenant_id,legacy_uid_hash,actor_role,scope_text)
       VALUES(?,?,'user','1',?,?,?,'owner','pipeline.read offline_access')`,
      [connectionId, clientId, identityId, tenantId, uidHash],
    );

    const rawAccessToken = crypto.randomBytes(32).toString('base64url');
    const accessHash = crypto.createHash('sha256').update(rawAccessToken).digest('hex');
    await db.query(
      `INSERT INTO mcp_oauth_tokens(token_hash,connection_id,token_family_id,token_type,resource_uri,scope_text,expires_at)
       VALUES(?,?,?,'access','https://7network.live/mcp','pipeline.read',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE))`,
      [accessHash, connectionId, familyId],
    );
    const [storedTokens] = await db.query('SELECT token_hash,token_type FROM mcp_oauth_tokens WHERE token_hash=?', [accessHash]);
    assert.deepEqual(storedTokens, [{ token_hash: accessHash, token_type: 'access' }], 'only a SHA-256 token digest is persisted');

    await db.query(
      `INSERT INTO mcp_oauth_authorization_transactions(transaction_hash,client_id,redirect_uri,state_value,resource_uri,scope_text,code_challenge,expires_at)
       VALUES(?,?,?,?,?,'pipeline.read','${'a'.repeat(43)}',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE))`,
      [crypto.createHash('sha256').update('synthetic-transaction').digest('hex'), clientId, redirect, 'state-value', 'https://7network.live/mcp'],
    );
    const idempotencyKey = `synthetic-${crypto.randomBytes(8).toString('hex')}`;
    const requestHash = crypto.createHash('sha256').update('synthetic request').digest('hex');
    const insertIdempotency = connection => connection.query(
      `INSERT INTO mcp_tool_idempotency(connection_id,idempotency_key,request_hash,expires_at)
       VALUES(?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))`, [connectionId, idempotencyKey, requestHash],
    );
    const concurrent = await Promise.allSettled([insertIdempotency(db), insertIdempotency(second)]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1, 'idempotency key is unique per connection under concurrent insertion');
    assert.equal(concurrent.filter(result => result.status === 'rejected' && result.reason.code === 'ER_DUP_ENTRY').length, 1);

    await db.query(
      `INSERT INTO mcp_oauth_events(connection_id,client_id,event_type,tool_name,resource_id,outcome,details_json)
       VALUES(?,?,'tool_called','search_pipeline_leads','synthetic-lead','success',JSON_OBJECT('synthetic',true))`,
      [connectionId, clientId],
    );
    const [[versionRow]] = await db.query('SELECT VERSION() AS version');
    const [[eventCount]] = await db.query('SELECT COUNT(*) AS count FROM mcp_oauth_events WHERE connection_id=?', [connectionId]);
    assert.equal(Number(eventCount.count), 1);
    console.log(JSON.stringify({ syntheticDatabase: true, databaseVersion: versionRow.version, migration: '20261102_chatgpt_mcp_oauth.sql', tokenDigestOnly: true, idempotencyConcurrency: 'one winner', auditEvents: Number(eventCount.count), customerDataTouched: false, externalWrites: false }));
  } finally {
    if (second) await second.end();
    if (db) await db.end();
    if (created) await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    await admin.end();
  }
}

main().catch(error => {
  console.error('7Network ChatGPT MCP database test failed:', error.code || error.message);
  process.exitCode = 1;
});
