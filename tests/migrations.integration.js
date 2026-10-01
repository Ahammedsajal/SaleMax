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
    assert.equal(result.applied.length, 6);
    assert.equal((await applyMigrations(connection, migrations)).skipped.length, 6);
    const [[instance]] = await connection.query('SELECT inactiveSince FROM instance WHERE id=1');
    assert.ok(instance.inactiveSince);
    await connection.query("INSERT INTO pipeline_settings(uid_hash, uid) VALUES (?, ?)", ['1'.repeat(64), 'synthetic-owner']);
    await applyMigrations(connection, migrations);
    const [[count]] = await connection.query('SELECT COUNT(*) AS n FROM pipeline_settings');
    assert.equal(count.n, 1);
    const t1=crypto.randomUUID(), t2=crypto.randomUUID(), i1=crypto.randomUUID(), i2=crypto.randomUUID(), m1=crypto.randomUUID(), m2=crypto.randomUUID();
    for (const [id,slug] of [[t1,'synthetic-a'],[t2,'synthetic-b']]) await connection.query('INSERT INTO sx_tenants(id,slug,name,category_key,category_version,status) VALUES (?,?,?,?,?,?)',[id,slug,slug,'training_center',1,'active']);
    for (const [id,email] of [[i1,'a@example.invalid'],[i2,'b@example.invalid']]) await connection.query('INSERT INTO sx_identities(id,email_normalized,display_name,status) VALUES (?,?,?,?)',[id,email,'Synthetic','active']);
    for (const [id,tenant,identity] of [[m1,t1,i1],[m2,t2,i2]]) await connection.query('INSERT INTO sx_memberships(id,tenant_id,identity_id,role) VALUES (?,?,?,?)',[id,tenant,identity,'owner']);
    await assert.rejects(connection.query('INSERT INTO sx_memberships(id,tenant_id,identity_id,role) VALUES (?,?,?,?)',[crypto.randomUUID(),t1,i2,'owner']), {code:'ER_DUP_ENTRY'});
    const sessionSql='INSERT INTO sx_sessions(id,token_hash,identity_id,audience,tenant_id,membership_id,credential_version,authenticated_at,expires_at) VALUES (?,?,?,?,?,?,1,NOW(),DATE_ADD(NOW(),INTERVAL 1 DAY))';
    await connection.query(sessionSql,[crypto.randomUUID(),'a'.repeat(64),i1,'tenant',t1,m1]);
    await assert.rejects(connection.query(sessionSql,[crypto.randomUUID(),'b'.repeat(64),i2,'tenant',t1,m2]), {code:'ER_NO_REFERENCED_ROW_2'});
    await assert.rejects(connection.query(sessionSql,[crypto.randomUUID(),'c'.repeat(64),i2,'tenant',t1,m1]), {code:'ER_NO_REFERENCED_ROW_2'});
    await assert.rejects(connection.query('INSERT INTO sx_legacy_ownership(source_table,source_id,tenant_id,membership_id,verified_at) VALUES (?,?,?,?,NOW())',['agents','1',t1,m2]), {code:'ER_NO_REFERENCED_ROW_2'});
    await connection.query('INSERT INTO sx_platform_memberships(identity_id,role) VALUES (?,?)',[i1,'super_admin']);
    await assert.rejects(connection.query('INSERT INTO sx_platform_memberships(identity_id,role) VALUES (?,?)',[i2,'super_admin']), {code:'ER_DUP_ENTRY'});
    const sessionEvidence=await require('./session-integration.cjs')(connection,{t1,i1,m1});
    const planEvidence=await require('./plan-integration.cjs')(connection,other,{t1,i1,m1});
    const authEvidence=await require('./auth-integration.cjs')(connection,{...config,database:db},{t1,i1});
    const lockName = 'salemax:migrate:' + crypto.createHash('sha256').update(db).digest('hex').slice(0,40);
    await connection.query('SELECT GET_LOCK(?, 0)', [lockName]);
    await assert.rejects(applyMigrations(other, migrations), { code: 'MIGRATION_LOCKED' });
    await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
    const broken = { file: '20261001_test_failure.sql', checksum: 'f'.repeat(64), statements: ['CREATE TABLE before_failure (id INT)', 'INVALID SQL'] };
    await assert.rejects(applyMigrations(connection, [...migrations, broken]), { code: 'MIGRATION_RECOVERY_REQUIRED' });
    const [[failed]] = await connection.query('SELECT status, statements_completed FROM salemax_schema_migrations WHERE migration_name=?', [broken.file]);
    assert.equal(failed.status, 'failed'); assert.equal(failed.statements_completed, 1);
    await assert.rejects(applyMigrations(other, [...migrations, broken]), { code: 'MIGRATION_RECOVERY_REQUIRED' });
    console.log(JSON.stringify({ realMariaDb: true, forwardMigrations: 6, repeatedRunsPreserveRecords: true, twoConnectionLock: true, tenantSessionForeignKeys: true, identitySessionForeignKeys: true, singleActiveTenantOwner: true, singleActivePlatformOwner: true, crossTenantLegacyMappingDenied: true, ...sessionEvidence,...planEvidence,...authEvidence, ddlFailureRecoveryGate: true, customerDataTouched: false, externalWrites: false }));
  } catch(error) {
    if(connection) {
      try {
        const [rows]=await connection.query('SELECT migration_name, status, statements_completed, error_code FROM salemax_schema_migrations WHERE status <> ?', ['applied']);
        console.error(JSON.stringify({syntheticMigrationDiagnostics:rows}));
      } catch(_) {}
    }
    throw error;
  } finally {
    if (other) await other.end();
    if (connection) await connection.end();
    try { if (created) await admin.query(`DROP DATABASE IF EXISTS \`${db}\``); }
    finally { await admin.end(); }
  }
}
main().catch(error => { console.error('Migration integration failed:', error.code || error.message); process.exitCode=1; });
