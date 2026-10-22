'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const logos = require('../modules/platform/tenant-crm-logo-media');

const tenantId = '11111111-1111-4111-8111-111111111111';
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '7network-crm-logo-storage-'));
  const incoming = await fs.mkdtemp(path.join(os.tmpdir(), '7network-crm-logo-upload-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(incoming, { recursive: true, force: true }); });
  const tempFilePath = path.join(incoming, 'upload.tmp');
  await fs.writeFile(tempFilePath, png);
  return { root, tempFilePath, file: { tempFilePath, size: png.length, mimetype: 'image/png', truncated: false } };
}

test('tenant CRM logos persist privately in local storage and retain the authorized URL contract', async t => {
  const f = await fixture(t);
  const env = { SALEMAX_CRM_LOGO_ROOT: f.root, SALEMAX_TENANT_CRM_LOGOS_STORAGE_DRIVER: 'local' };
  const options = { env };
  const stored = await logos.store(f.file, tenantId, options);
  assert.match(stored.url, new RegExp(`^/api/crm/logos/${tenantId}/[0-9a-f-]{36}\\.png$`));
  assert.equal(await fs.stat(f.tempFilePath).then(() => true, () => false), false);
  const target = logos.managedPath(stored.url, tenantId, env);
  assert.ok(target.startsWith(f.root + path.sep));
  assert.deepEqual(await fs.readFile(target), png);
  assert.equal((await fs.stat(f.root)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(target)).mode & 0o777, 0o600);

  const opened = await logos.openManaged(stored.url, tenantId, options);
  const chunks = [];
  for await (const chunk of opened.body) chunks.push(chunk);
  assert.equal(opened.contentType, 'image/png');
  assert.equal(Buffer.concat(chunks).equals(png), true);
  assert.equal(await logos.openManaged(stored.url, '22222222-2222-4222-8222-222222222222', options), null);
  assert.equal(await logos.removeManaged(stored.url, tenantId, options), true);
  assert.equal(await fs.stat(target).then(() => true, () => false), false);
});

test('tenant CRM logo adapter uses its independent S3 namespace and streams private reads', async t => {
  const f = await fixture(t);
  const env = { SALEMAX_TENANT_CRM_LOGOS_STORAGE_DRIVER: 's3' };
  const objects = new Map();
  let configuredNamespace = null;
  const createStore = config => {
    configuredNamespace = config.namespace;
    return {
      driver: 's3',
      async putFile(key, sourcePath, metadata) { objects.set(key, { bytes: await fs.readFile(sourcePath), metadata }); },
      async openRead(key) { const item = objects.get(key); if (!item) throw Object.assign(Error('missing'), { code: 'STORED_OBJECT_NOT_FOUND' }); return { body: Readable.from([item.bytes]), contentLength: item.bytes.length }; },
      async remove(key) { objects.delete(key); }
    };
  };
  const options = { env, createStore };
  const stored = await logos.store(f.file, tenantId, options);
  assert.equal(configuredNamespace, 'tenant-crm-logos');
  assert.equal(logos.managedPath(stored.url, tenantId, env), null);
  const opened = await logos.openManaged(stored.url, tenantId, options);
  const chunks = [];
  for await (const chunk of opened.body) chunks.push(chunk);
  assert.equal(opened.contentType, 'image/png');
  assert.equal(Buffer.concat(chunks).equals(png), true);
  assert.equal(await logos.removeManaged(stored.url, tenantId, options), true);
});

test('invalid tenant CRM logo content is rejected and temporary upload is removed', async t => {
  const f = await fixture(t);
  const badPath = path.join(path.dirname(f.tempFilePath), 'bad.tmp');
  await fs.writeFile(badPath, 'not an image');
  const file = { ...f.file, tempFilePath: badPath, size: 12 };
  await assert.rejects(logos.store(file, tenantId, { env: { SALEMAX_CRM_LOGO_ROOT: f.root } }), { code: 'CRM_LOGO_SIGNATURE_INVALID', status: 415 });
  assert.equal(await fs.stat(badPath).then(() => true, () => false), false);
});
