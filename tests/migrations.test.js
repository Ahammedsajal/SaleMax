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
  assert.equal(migrations.length, 16);
  assert.equal(migrations.at(-1).file, '20261007_pipeline_contacts.sql');
  assert.ok(migrations.every(m => !/rollback/.test(m.file)));
  assert.equal(migrations[0].file, '20260928_lead_pipeline.sql');
});
test('destructive forward files fail before database execution', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'salemax-migrations-'));
  try { fs.writeFileSync(path.join(folder, '20261001_bad.sql'), 'DROP TABLE invoice;'); assert.throws(() => discover(folder), { code: 'DESTRUCTIVE_FORWARD_MIGRATION' }); }
  finally { fs.rmSync(folder, { recursive: true, force: true }); }
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
