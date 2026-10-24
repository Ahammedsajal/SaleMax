'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const objectStorage = require('./object-storage');

const NAMESPACE = 'tenant-crm-logos';
const MAX_LOGO_BYTES=5*1024*1024;
const DEFAULT_ROOT = path.resolve(__dirname, '../../database/local-runtime/crm-tenant-logos');
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const TYPES = {
  'image/jpeg': { ext: 'jpg', ok: bytes => bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 },
  'image/png': { ext: 'png', ok: bytes => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  'image/webp': { ext: 'webp', ok: bytes => bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' }
};
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };

function rootFor(env = process.env) {
  return path.resolve(env.SALEMAX_CRM_LOGO_ROOT || DEFAULT_ROOT);
}

function createStorage({ env = process.env, root, createStore = objectStorage.createStore, sdk, client } = {}) {
  const selectedDriver = objectStorage.driver(env, NAMESPACE);
  return createStore({
    env,
    namespace: NAMESPACE,
    root: selectedDriver === 'local' ? path.resolve(root || rootFor(env)) : undefined,
    ...(sdk ? { sdk } : {}),
    ...(client ? { client } : {})
  });
}

function managedKey(url, tenantId) {
  if (typeof url !== 'string' || typeof tenantId !== 'string' || !new RegExp(`^${UUID}$`, 'i').test(tenantId)) return null;
  const match = url.match(new RegExp(`^/api/crm/logos/(${UUID})/(${UUID})\\.(jpg|png|webp)$`, 'i'));
  if (!match || match[1].toLowerCase() !== tenantId.toLowerCase()) return null;
  return `${match[1]}/${match[2]}.${match[3].toLowerCase()}`;
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function store(file, tenantId, options = {}) {
  try {
    if (typeof tenantId !== 'string' || !new RegExp(`^${UUID}$`, 'i').test(tenantId)) fail('INVALID_TENANT_ID');
    if (!file || file.truncated || !Number.isSafeInteger(file.size) || file.size < 8 || file.size > MAX_LOGO_BYTES) fail('CRM_LOGO_TOO_LARGE', 413);
    const type = TYPES[String(file.mimetype || '').toLowerCase()];
    if (!type) fail('CRM_LOGO_TYPE_NOT_ALLOWED', 415);
    if (typeof file.tempFilePath !== 'string' || !path.isAbsolute(file.tempFilePath)) fail('CRM_LOGO_STORAGE_UNAVAILABLE', 503);
    let handle;
    try { handle = await fsp.open(file.tempFilePath, 'r'); }
    catch { fail('CRM_LOGO_STORAGE_UNAVAILABLE', 503); }
    try {
      const header = Buffer.alloc(12);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (!type.ok(header.subarray(0, bytesRead))) fail('CRM_LOGO_SIGNATURE_INVALID', 415);
    } finally { await handle.close(); }

    const tenant = tenantId.toLowerCase();
    const filename = `${crypto.randomUUID()}.${type.ext}`;
    const key = `${tenant}/${filename}`;
    const stat = await fsp.lstat(file.tempFilePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size) fail('CRM_LOGO_STORAGE_UNAVAILABLE', 503);
    const storage = createStorage(options);
    await storage.putFile(key, file.tempFilePath, {
      contentLength: file.size,
      contentType: String(file.mimetype).toLowerCase(),
      sha256: await sha256File(file.tempFilePath)
    });
    return { url: `/api/crm/logos/${tenant}/${filename}`, key };
  } catch (error) {
    if (['INVALID_TENANT_ID', 'CRM_LOGO_TOO_LARGE', 'CRM_LOGO_TYPE_NOT_ALLOWED', 'CRM_LOGO_SIGNATURE_INVALID', 'CRM_LOGO_STORAGE_UNAVAILABLE'].includes(error.code)) throw error;
    fail('CRM_LOGO_STORAGE_UNAVAILABLE', 503);
  } finally {
    if (typeof file?.tempFilePath === 'string' && path.isAbsolute(file.tempFilePath)) await fsp.rm(file.tempFilePath, { force: true }).catch(() => {});
  }
}

async function openManaged(url, tenantId, options = {}) {
  const key = managedKey(url, tenantId);
  if (!key) return null;
  const contentType = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[path.extname(key).slice(1)];
  if (!contentType) return null;
  const storage = createStorage(options);
  const opened = await storage.openRead(key);
  const body = opened?.body;
  const contentLength = opened?.contentLength;
  if (!body || typeof body[Symbol.asyncIterator] !== 'function' || !Number.isSafeInteger(contentLength) || contentLength < 8) {
    body?.destroy?.();
    fail('CRM_LOGO_STORAGE_UNAVAILABLE', 503);
  }
  if (contentLength > MAX_LOGO_BYTES) {
    body.destroy?.();
    fail('STORED_OBJECT_TOO_LARGE', 413);
  }
  return { ...opened, key, contentType };
}

function managedPath(url, tenantId, env = process.env) {
  const key = managedKey(url, tenantId);
  if (!key || objectStorage.driver(env, NAMESPACE) !== 'local') return null;
  const root = rootFor(env);
  const target = path.resolve(root, ...key.split('/'));
  return target.startsWith(root + path.sep) ? target : null;
}

async function removeManaged(url, tenantId, options = {}) {
  const key = managedKey(url, tenantId);
  if (!key) return false;
  try { await createStorage(options).remove(key); }
  catch { return false; }
  return true;
}

module.exports = { MAX_LOGO_BYTES, NAMESPACE, createStorage, managedKey, store, openManaged, removeManaged, managedPath };
