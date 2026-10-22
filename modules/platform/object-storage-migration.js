'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const objectStorage = require('./object-storage');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAMESPACES = new Set(['course-media', 'payment-proofs', 'recruitment-cvs']);
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };

function validateNamespace(namespace) {
  if (!NAMESPACES.has(namespace)) fail('OBJECT_MIGRATION_NAMESPACE_INVALID');
  return namespace;
}

function validateKey(namespace, key) {
  validateNamespace(namespace);
  const normalized = objectStorage.normalizeKey(namespace, key);
  const segments = normalized.split('/');
  if (segments.length < 3 || !UUID.test(segments[0])) fail('OBJECT_MIGRATION_KEY_INVALID');
  return { key: normalized, tenantId: segments[0] };
}

async function hashStream(stream) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of stream) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest('hex') };
}

async function inspectSource(root, key) {
  const resolvedRoot = path.resolve(root);
  if (!path.isAbsolute(root) || resolvedRoot === path.parse(resolvedRoot).root) fail('OBJECT_MIGRATION_ROOT_INVALID');
  const target = path.resolve(resolvedRoot, ...key.split('/'));
  if (!target.startsWith(resolvedRoot + path.sep)) fail('OBJECT_MIGRATION_KEY_INVALID');
  const rootStat = await fsp.lstat(resolvedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('OBJECT_MIGRATION_SOURCE_UNSAFE', 503);
  let current = resolvedRoot;
  const segments = key.split('/');
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    const stat = await fsp.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('OBJECT_MIGRATION_SOURCE_UNSAFE', 503);
  }
  const before = await fsp.lstat(target);
  if (!before.isFile() || before.isSymbolicLink()) fail('OBJECT_MIGRATION_SOURCE_UNSAFE', 503);
  const result = await hashStream(fs.createReadStream(target));
  const after = await fsp.lstat(target);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || result.bytes !== after.size) fail('OBJECT_MIGRATION_SOURCE_CHANGED', 409);
  return { path: target, bytes: result.bytes, sha256: result.sha256 };
}

async function buildManifest({ root, namespace }) {
  validateNamespace(namespace);
  const resolvedRoot = path.resolve(root || '');
  if (!root || !path.isAbsolute(root) || resolvedRoot === path.parse(resolvedRoot).root) fail('OBJECT_MIGRATION_ROOT_INVALID');
  const stat = await fsp.lstat(resolvedRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('OBJECT_MIGRATION_SOURCE_UNSAFE', 503);
  const objects = [];
  async function visit(directory) {
    const entries = (await fsp.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === '.tmp') continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail('OBJECT_MIGRATION_SOURCE_UNSAFE', 503);
      if (entry.isDirectory()) { await visit(fullPath); continue; }
      if (!entry.isFile()) fail('OBJECT_MIGRATION_SOURCE_UNSAFE', 503);
      const key = path.relative(resolvedRoot, fullPath).split(path.sep).join('/');
      const identity = validateKey(namespace, key);
      const inspected = await inspectSource(resolvedRoot, key);
      objects.push({ tenantId: identity.tenantId, key, bytes: inspected.bytes, sha256: inspected.sha256 });
    }
  }
  await visit(resolvedRoot);
  return { format: '7network-private-objects-v1', namespace, objects };
}

function validateManifest(manifest, namespace) {
  validateNamespace(namespace);
  if (!manifest || manifest.format !== '7network-private-objects-v1' || manifest.namespace !== namespace || !Array.isArray(manifest.objects)) fail('OBJECT_MIGRATION_MANIFEST_INVALID');
  const seen = new Set();
  for (const object of manifest.objects) {
    const identity = validateKey(namespace, object?.key);
    if (object.tenantId !== identity.tenantId || !Number.isSafeInteger(object.bytes) || object.bytes < 1 || !/^[a-f0-9]{64}$/i.test(object.sha256 || '') || seen.has(object.key)) fail('OBJECT_MIGRATION_MANIFEST_INVALID');
    seen.add(object.key);
  }
}

async function verifyRemote(store, object) {
  const head = await store.head(object.key);
  if (head.contentLength !== object.bytes || head.sha256 !== object.sha256) fail('OBJECT_MIGRATION_TARGET_MISMATCH', 409);
  const opened = await store.openRead(object.key);
  const digest = await hashStream(opened.body);
  if (digest.bytes !== object.bytes || digest.sha256 !== object.sha256) fail('OBJECT_MIGRATION_TARGET_MISMATCH', 409);
}

async function migrateManifest({ root, manifest, namespace, store, onProgress = () => {} }) {
  validateManifest(manifest, namespace);
  if (store?.driver !== 's3') fail('OBJECT_MIGRATION_REQUIRES_S3', 409);
  let copied = 0, alreadyPresent = 0, bytesCopied = 0;
  for (const object of manifest.objects) {
    const source = await inspectSource(root, object.key);
    if (source.bytes !== object.bytes || source.sha256 !== object.sha256) fail('OBJECT_MIGRATION_SOURCE_MISMATCH', 409);
    let exists = false;
    try { await store.head(object.key); exists = true; }
    catch (error) { if (error.code !== 'STORED_OBJECT_NOT_FOUND') throw error; }
    if (exists) {
      await verifyRemote(store, object);
      alreadyPresent++;
    } else {
      await store.putFile(object.key, source.path, { contentLength: object.bytes, contentType: 'application/octet-stream', sha256: object.sha256 });
      await verifyRemote(store, object);
      copied++;
      bytesCopied += object.bytes;
    }
    onProgress({ completed: copied + alreadyPresent, total: manifest.objects.length });
  }
  return { namespace, total: manifest.objects.length, copied, alreadyPresent, bytesCopied, sourceDeleted: false };
}

module.exports = { NAMESPACES, validateKey, buildManifest, validateManifest, migrateManifest, inspectSource };
