'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const MEDIA_ROOT = path.resolve(__dirname, '../../client/public/media/training-center-logos');
const TYPES = Object.freeze({
  'image/jpeg': { extension: 'jpg', signature: bytes => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  'image/png': { extension: 'png', signature: bytes => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  'image/webp': { extension: 'webp', signature: bytes => bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' },
});

const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };

function validId(value) {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
}

async function ensureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('TRAINING_LOGO_STORAGE_UNAVAILABLE', 503);
}

async function store(file, tenantId) {
  if (!validId(tenantId)) fail('INVALID_TENANT_ID');
  if (!file || file.truncated) fail('TRAINING_LOGO_TOO_LARGE', 413);
  const mime = String(file.mimetype || '').toLowerCase();
  const type = TYPES[mime];
  if (!type) fail('TRAINING_LOGO_TYPE_NOT_ALLOWED', 415);
  if (!Number.isSafeInteger(file.size) || file.size < 8 || file.size > MAX_LOGO_BYTES) fail('TRAINING_LOGO_TOO_LARGE', 413);

  const handle = await fs.open(file.tempFilePath, 'r');
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (!type.signature(header.subarray(0, bytesRead))) fail('TRAINING_LOGO_SIGNATURE_INVALID', 415);
  } finally {
    await handle.close();
  }

  const directory = path.join(MEDIA_ROOT, tenantId);
  await ensureDirectory(MEDIA_ROOT);
  await ensureDirectory(directory);
  const filename = `${crypto.randomUUID()}.${type.extension}`;
  const target = path.join(directory, filename);
  try {
    await file.mv(target);
  } catch (_) {
    await fs.rm(target, { force: true }).catch(() => {});
    fail('TRAINING_LOGO_STORAGE_UNAVAILABLE', 503);
  }
  return { url: `/media/training-center-logos/${tenantId}/${filename}`, path: target };
}

async function removeManaged(url, tenantId) {
  if (!validId(tenantId) || typeof url !== 'string') return;
  const match = url.match(/^\/media\/training-center-logos\/([0-9a-f-]{36})\/([0-9a-f-]{36}\.(?:jpg|png|webp))$/i);
  if (!match || match[1].toLowerCase() !== tenantId.toLowerCase()) return;
  const target = path.resolve(MEDIA_ROOT, match[1], match[2]);
  if (!target.startsWith(MEDIA_ROOT + path.sep)) return;
  await fs.rm(target, { force: true }).catch(() => {});
}

module.exports = { MAX_LOGO_BYTES, store, removeManaged };
