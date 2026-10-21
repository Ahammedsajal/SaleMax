const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { splitSql, discover, applyMigrations } = require('../database/migration-runner');
test('quoted delimiters and comments do not split SQL', () => {
  assert.deepEqual(splitSql("-- ;\nINSERT INTO x VALUES ('a;b', 'it''s'); /* ; */ SELECT `a;b`; # comment"), ["INSERT INTO x VALUES ('a;b', 'it''s')", 'SELECT `a;b`']);
  for (const sql of ["SELECT 'broken", '/* broken', 'DELIMITER $$', '/*! DROP TABLE x */']) assert.throws(() => splitSql(sql));
});
test('actual discovery excludes destructive rollback', () => {
  const migrations = discover(path.join(__dirname, '../database/migrations'));
  assert.ok(migrations.some(m => m.file === '20261127_training_course_soft_deletion.sql'));
  assert.ok(migrations.some(m => m.file === '20261113_team_role_profiles.sql'));
  assert.ok(migrations.some(m => m.file === '20261206_legacy_crm_user_sync_queue.sql'));
  const recruitmentScreenings=migrations.find(m=>m.file==='20261019_sales_recruitment_screenings.sql');
  assert.ok(recruitmentScreenings);
  assert.match(recruitmentScreenings.statements.join('\n'),/UNIQUE KEY sx_recruitment_screening_conversation/);
  assert.match(recruitmentScreenings.statements.join('\n'),/consented_at DATETIME\(3\) NOT NULL/);
  const qrShares = migrations.find(m => m.file === '20261207_qr_channel_shares.sql');
  assert.ok(qrShares?.statements.some(sql => /idx_beta_chats_qr_channel\s*\(uid\(191\),\s*origin_instance_unique_id\(191\)\)/i.test(sql)), 'QR channel index uses bounded prefixes for the legacy wide UID column');
  const qrSessionUnique = migrations.find(m => m.file === '20261021_qr_session_unique_id.sql');
  assert.ok(qrSessionUnique?.statements.some(sql => /ADD UNIQUE INDEX uq_instance_uniqueid\s*\(uniqueId\(150\)\)/i.test(sql)), 'QR session IDs have database-enforced uniqueness');
  const teamRoles=migrations.findIndex(m=>m.file==='20261113_team_role_profiles.sql');
  const salesOrg=migrations.findIndex(m=>m.file==='20261114_sales_organization.sql');
  const salesFinance=migrations.findIndex(m=>m.file==='20261115_sales_commissions.sql');
  assert.ok(teamRoles>=0&&salesOrg>teamRoles&&salesFinance>salesOrg,'Sales migrations follow the Team Leader role migration');
  assert.ok(migrations.every(m => !/rollback/.test(m.file)));
  assert.equal(migrations[0].file, '20260928_lead_pipeline.sql');
});
test('destructive forward files fail before database execution', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'salemax-migrations-'));
  try { fs.writeFileSync(path.join(folder, '20261001_bad.sql'), 'DROP TABLE invoice;'); assert.throws(() => discover(folder), { code: 'DESTRUCTIVE_FORWARD_MIGRATION' }); }
  finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
test('rollback, down and revert files are never selected as forward migrations', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), '7network-migration-directions-'));
  try {
    fs.writeFileSync(path.join(folder, '20261001_safe.sql'), 'CREATE TABLE safe_table (id INT PRIMARY KEY);');
    fs.writeFileSync(path.join(folder, '20261002_cleanup_rollback.sql'), 'DROP TABLE customer_data;');
    fs.writeFileSync(path.join(folder, '20261003_cleanup_down.sql'), 'DROP TABLE customer_data;');
    fs.writeFileSync(path.join(folder, '20261004_revert_cleanup.sql'), 'DROP TABLE customer_data;');
    assert.deepEqual(discover(folder).map(migration => migration.file), ['20261001_safe.sql']);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
function fake({ locked = false, rows = [], fail = false } = {}) {
  const calls = [];
  return { calls, async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('DATABASE()')) return [[{ db: 'test' }]];
    if (sql.includes('GET_LOCK')) return [[{ acquired: locked ? 0 : 1 }]];
    if (sql === 'SELECT * FROM salemax_schema_migrations') return [rows];
    if (fail && sql === 'CREATE TABLE example (id INT)') throw Object.assign(new Error('private'), { code: 'ER_TEST_FAILURE' });
    return [[]];
  }};
}
const migration = { file: '20261001_example.sql', checksum: 'a'.repeat(64), statements: ['CREATE TABLE example (id INT)', 'INSERT INTO example VALUES (1)'] };
test('lock contention prevents writes', async () => {
  const connection = fake({ locked: true });
  await assert.rejects(applyMigrations(connection, [migration]), { code: 'MIGRATION_LOCKED' });
  assert.equal(connection.calls.length, 2);
});
test('applied history is skipped and checksum drift blocks new SQL', async () => {
  const row = { migration_name: migration.file, checksum: migration.checksum, status: 'applied' };
  assert.deepEqual(await applyMigrations(fake({ rows: [row] }), [migration]), { applied: [], skipped: [migration.file] });
  const bad = fake({ rows: [{ ...row, checksum: 'b'.repeat(64) }] });
  await assert.rejects(applyMigrations(bad, [migration]), { code: 'MIGRATION_CHECKSUM_CHANGED' });
  assert.ok(!bad.calls.some(call => call.sql.startsWith('INSERT')));
  assert.ok(bad.calls.at(-1).sql.includes('RELEASE_LOCK'));
});
test('failed/interrupted history requires recovery before retrying DDL', async () => {
  for (const status of ['failed', 'running']) {
    const connection = fake({ rows: [{ migration_name: migration.file, checksum: migration.checksum, status }] });
    await assert.rejects(applyMigrations(connection, [migration]), { code: 'MIGRATION_RECOVERY_REQUIRED' });
    assert.ok(!connection.calls.some(call => call.sql.startsWith('INSERT')));
  }
});
test('failure stops following SQL, records safe error code and releases lock', async () => {
  const connection = fake({ fail: true });
  await assert.rejects(applyMigrations(connection, [migration]), { code: 'MIGRATION_RECOVERY_REQUIRED' });
  assert.ok(connection.calls.some(call => call.params?.[0] === 'failed'));
  assert.ok(!connection.calls.some(call => call.sql === migration.statements[1]));
  assert.ok(connection.calls.at(-1).sql.includes('RELEASE_LOCK'));
});
