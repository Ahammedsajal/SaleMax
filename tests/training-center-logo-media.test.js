'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { store, removeManaged, MAX_LOGO_BYTES } = require('../modules/platform/training-center-logo-media');

const tenantId = 'c35cde78-465d-4c8e-a4b1-e7e7f3a8a417';

async function uploadFile({ mime = 'image/png', bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'salemax-logo-test-'));
  const tempFilePath = path.join(dir, 'logo.upload');
  await fs.writeFile(tempFilePath, bytes);
  return {
    tempFilePath,
    dir,
    mimetype: mime,
    size: bytes.length,
    truncated: false,
    async mv(destination) { await fs.copyFile(tempFilePath, destination); },
  };
}

test('training-center logo upload stores signed image files under tenant-scoped public media', async () => {
  const file = await uploadFile();
  let stored;
  try {
    stored = await store(file, tenantId);
    assert.match(stored.url, new RegExp(`^/media/training-center-logos/${tenantId}/[0-9a-f-]{36}\\.png$`));
    assert.equal((await fs.stat(stored.path)).size, file.size);
    await removeManaged(stored.url, 'b4a877e3-9ac7-467d-9a82-b944e95f0578');
    assert.equal(await fs.stat(stored.path).then(() => true), true);
    await removeManaged(stored.url, tenantId);
    await assert.rejects(fs.access(stored.path), { code: 'ENOENT' });
  } finally {
    await fs.rm(file.dir, { recursive: true, force: true });
    await fs.rm(path.dirname(stored?.path || path.join(__dirname, '../client/public/media/training-center-logos', tenantId, 'unused')), { recursive: true, force: true });
  }
});

test('training-center logo uploads reject unsupported MIME types and mismatched signatures', async () => {
  const unsupported = await uploadFile({ mime: 'image/svg+xml' });
  const forged = await uploadFile({ bytes: Buffer.from('not a png') });
  try {
    await assert.rejects(store(unsupported, tenantId), { code: 'TRAINING_LOGO_TYPE_NOT_ALLOWED' });
    await assert.rejects(store(forged, tenantId), { code: 'TRAINING_LOGO_SIGNATURE_INVALID' });
  } finally {
    await Promise.all([fs.rm(unsupported.dir, { recursive: true, force: true }), fs.rm(forged.dir, { recursive: true, force: true })]);
  }
});

test('training-center logo uploads enforce tenant IDs and the five-megabyte bound', async () => {
  const file = await uploadFile();
  try {
    await assert.rejects(store(file, '../other-tenant'), { code: 'INVALID_TENANT_ID' });
    await assert.rejects(store({ ...file, size: MAX_LOGO_BYTES + 1 }, tenantId), { code: 'TRAINING_LOGO_TOO_LARGE' });
  } finally {
    await fs.rm(file.dir, { recursive: true, force: true });
  }
});
