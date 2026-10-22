'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const migration = require('../modules/platform/object-storage-migration');
const cli = require('../scripts/migrate-private-objects-to-s3.cjs');

const tenantId = '11111111-1111-4111-8111-111111111111';
const courseId = '22222222-2222-4222-8222-222222222222';
const mediaId = '33333333-3333-4333-8333-333333333333';
const key = `${tenantId}/${courseId}/${mediaId}`;

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '7network-object-migration-'));
  const external = await fs.mkdtemp(path.join(os.tmpdir(), '7network-object-manifest-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(external, { recursive: true, force: true }); });
  const source = path.join(root, ...key.split('/'));
  await fs.mkdir(path.dirname(source), { recursive: true });
  await fs.writeFile(source, 'synthetic private media');
  return { root, external, source, bytes: Buffer.from('synthetic private media') };
}

function fakeS3() {
  const objects = new Map();
  return {
    driver: 's3', objects,
    async head(objectKey) {
      const item = objects.get(objectKey);
      if (!item) throw Object.assign(Error('missing'), { code: 'STORED_OBJECT_NOT_FOUND' });
      return { contentLength: item.bytes.length, sha256: item.sha256 };
    },
    async openRead(objectKey) {
      const item = objects.get(objectKey);
      if (!item) throw Object.assign(Error('missing'), { code: 'STORED_OBJECT_NOT_FOUND' });
      return { body: require('node:stream').Readable.from([item.bytes]) };
    },
    async putFile(objectKey, sourcePath, metadata) {
      const bytes = await fs.readFile(sourcePath);
      this.objects.set(objectKey, { bytes, sha256: metadata.sha256 });
    }
  };
}

test('manifest hashes stable tenant keys and skips temporary files without exposing source paths', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, '.tmp'));
  await fs.writeFile(path.join(f.root, '.tmp', 'partial'), 'ignore');
  const manifest = await migration.buildManifest({ root: f.root, namespace: 'course-media' });
  assert.equal(manifest.objects.length, 1);
  assert.deepEqual(manifest.objects[0], {
    tenantId, key, bytes: f.bytes.length,
    sha256: crypto.createHash('sha256').update(f.bytes).digest('hex')
  });
  assert.equal(JSON.stringify(manifest).includes(f.root), false);
});

test('migration copies and re-verifies S3 data, is idempotent, and retains source', async t => {
  const f = await fixture(t);
  const manifest = await migration.buildManifest({ root: f.root, namespace: 'course-media' });
  const store = fakeS3();
  const first = await migration.migrateManifest({ root: f.root, manifest, namespace: 'course-media', store });
  const second = await migration.migrateManifest({ root: f.root, manifest, namespace: 'course-media', store });
  assert.equal(first.copied, 1);
  assert.equal(first.sourceDeleted, false);
  assert.equal(second.alreadyPresent, 1);
  assert.deepEqual(await fs.readFile(f.source), f.bytes);
});

test('migration refuses changed local sources and mismatched existing objects', async t => {
  const f = await fixture(t);
  const manifest = await migration.buildManifest({ root: f.root, namespace: 'course-media' });
  await fs.writeFile(f.source, 'changed after manifest');
  await assert.rejects(migration.migrateManifest({ root: f.root, manifest, namespace: 'course-media', store: fakeS3() }), { code: 'OBJECT_MIGRATION_SOURCE_MISMATCH' });
  const fresh = await fixture(t);
  const freshManifest = await migration.buildManifest({ root: fresh.root, namespace: 'course-media' });
  const store = fakeS3();
  store.objects.set(key, { bytes: Buffer.from('wrong'), sha256: '0'.repeat(64) });
  await assert.rejects(migration.migrateManifest({ root: fresh.root, manifest: freshManifest, namespace: 'course-media', store }), { code: 'OBJECT_MIGRATION_TARGET_MISMATCH' });
});

test('CLI requires the shared lock and S3 driver before applying a manifest', async t => {
  const f = await fixture(t);
  const manifestPath = path.join(f.external, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(await migration.buildManifest({ root: f.root, namespace: 'course-media' })));
  const base = ['--namespace', 'course-media', '--root', f.root, '--manifest', manifestPath, '--apply'];
  const wrapperEnv = { SALEMAX_DEPLOY_LOCK_HELD: '1', SALEMAX_ACTIVE_RELEASE_BEFORE: '/opt/salemax/releases/test', SALEMAX_OBJECT_STORAGE_DRIVER: 's3' };
  await assert.rejects(cli.main(base, { ...wrapperEnv, SALEMAX_DEPLOY_LOCK_HELD: '0' }), /shared production deployment lock/);
  await assert.rejects(cli.main(base, { ...wrapperEnv, SALEMAX_ACTIVE_RELEASE_BEFORE: '' }, { lockHeld: () => true }), /outside the production release lock wrapper/);
  await assert.rejects(cli.main(base, wrapperEnv, { lockHeld: () => false }), /shared OS-level flock is not held/);
  await assert.rejects(cli.main(base, { ...wrapperEnv, SALEMAX_OBJECT_STORAGE_DRIVER: 'local' }, { lockHeld: () => true }), /Select the S3 storage driver/);
  assert.equal(cli.sharedLockHeld(() => ({ status: 75 }), manifestPath), true);
  assert.equal(cli.sharedLockHeld(() => ({ status: 0 }), manifestPath), false);
  assert.equal(cli.sharedLockHeld(() => { throw Error('probe must not run for missing lock'); }, path.join(f.external, 'missing-lock')), false);
  await fs.chmod(manifestPath, 0o644);
  await assert.rejects(cli.main(base, wrapperEnv, { lockHeld: () => true }), /mode-0600/);
  await fs.chmod(manifestPath, 0o600);
  await assert.rejects(cli.main(['--namespace', 'course-media', '--root', f.root, '--manifest-out', path.resolve(__dirname, '../manifest.json')], {}), /outside the source checkout/);
});

test('manifest generation writes a new restrictive external file', async t => {
  const f = await fixture(t);
  const output = path.join(f.external, 'new-manifest.json');
  const result = await cli.main(['--namespace', 'course-media', '--root', f.root, '--manifest-out', output], {});
  const stat = await fs.stat(output);
  assert.equal(result.objects.length, 1);
  assert.equal(stat.mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await fs.readFile(output, 'utf8')), result);
});
