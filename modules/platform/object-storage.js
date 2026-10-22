'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const clients = new Map();
const fail = (code, status = 503) => { throw Object.assign(new Error(code), { code, status }); };

function driver(env = process.env) {
  const value = String(env.SALEMAX_OBJECT_STORAGE_DRIVER || 'local').trim().toLowerCase();
  if (!['local', 's3'].includes(value)) fail('OBJECT_STORAGE_DRIVER_INVALID', 500);
  return value;
}

function safeSegment(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 180
    && value !== '.' && value !== '..' && /^[A-Za-z0-9._-]+$/.test(value);
}

function normalizeKey(namespace, key) {
  if (!safeSegment(namespace) || !/^[a-z][a-z0-9-]{0,50}$/.test(namespace)) fail('OBJECT_STORAGE_NAMESPACE_INVALID', 500);
  if (typeof key !== 'string' || key.length > 800 || key.startsWith('/') || key.includes('\\')) fail('OBJECT_STORAGE_KEY_INVALID', 400);
  const segments = key.split('/');
  if (!segments.length || segments.some(segment => !safeSegment(segment))) fail('OBJECT_STORAGE_KEY_INVALID', 400);
  return segments.join('/');
}

function s3Config(env = process.env) {
  const bucket = String(env.SALEMAX_S3_BUCKET || '').trim();
  const region = String(env.SALEMAX_S3_REGION || '').trim();
  const accessKeyId = String(env.SALEMAX_S3_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(env.SALEMAX_S3_SECRET_ACCESS_KEY || '');
  const sessionToken = String(env.SALEMAX_S3_SESSION_TOKEN || '').trim();
  const prefix = String(env.SALEMAX_S3_PREFIX || '7network').trim();
  const endpointValue = String(env.SALEMAX_S3_ENDPOINT || '').trim();
  const pathStyleValue = String(env.SALEMAX_S3_FORCE_PATH_STYLE || 'false').trim().toLowerCase();
  if (!bucket || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/.test(bucket)
      || !region || !/^[A-Za-z0-9-]{2,100}$/.test(region)
      || !accessKeyId || accessKeyId.length > 256
      || !secretAccessKey || secretAccessKey.length > 512) fail('OBJECT_STORAGE_NOT_CONFIGURED', 503);
  if (!['true', 'false'].includes(pathStyleValue)) fail('OBJECT_STORAGE_CONFIGURATION_INVALID', 503);
  if (!prefix || prefix.length > 180 || prefix.split('/').some(segment => !safeSegment(segment))) fail('OBJECT_STORAGE_CONFIGURATION_INVALID', 503);
  let endpoint;
  if (endpointValue) {
    try { endpoint = new URL(endpointValue); } catch { fail('OBJECT_STORAGE_CONFIGURATION_INVALID', 503); }
    const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if ((!localHost && endpoint.protocol !== 'https:') || (localHost && !['https:', 'http:'].includes(endpoint.protocol))
        || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) fail('OBJECT_STORAGE_CONFIGURATION_INVALID', 503);
    endpoint = endpoint.toString().replace(/\/$/, '');
  }
  return { bucket, region, accessKeyId, secretAccessKey, sessionToken, prefix, endpoint, forcePathStyle: pathStyleValue === 'true' };
}

function s3Client(config, sdk, injectedClient) {
  if (injectedClient) return { client: injectedClient, sdk };
  const aws = sdk || require('@aws-sdk/client-s3');
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
  if (!clients.has(fingerprint)) {
    clients.set(fingerprint, new aws.S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        ...(config.sessionToken ? { sessionToken: config.sessionToken } : {})
      },
      maxAttempts: 3
    }));
  }
  return { client: clients.get(fingerprint), sdk: aws };
}

function normalizeRemoteError(error) {
  const status = Number(error?.$metadata?.httpStatusCode || error?.statusCode || 0);
  if (status === 404 || ['NoSuchKey', 'NotFound', 'NoSuchBucket'].includes(error?.name)) {
    return Object.assign(new Error('Stored object was not found'), { code: 'STORED_OBJECT_NOT_FOUND', status: 404 });
  }
  return Object.assign(new Error('Object storage is unavailable'), { code: 'OBJECT_STORAGE_UNAVAILABLE', status: 503, cause: error });
}

function createStore({ env = process.env, namespace, root, sdk, client } = {}) {
  const selectedDriver = driver(env);
  if (!/^[a-z][a-z0-9-]{0,50}$/.test(namespace || '')) fail('OBJECT_STORAGE_NAMESPACE_INVALID', 500);
  const localRoot = root ? path.resolve(root) : null;
  if (selectedDriver === 'local' && (!localRoot || !path.isAbsolute(localRoot))) fail('OBJECT_STORAGE_ROOT_REQUIRED', 503);
  const config = selectedDriver === 's3' ? s3Config(env) : null;
  const remote = config ? s3Client(config, sdk, client) : null;

  function objectKey(key) {
    return `${config.prefix}/${namespace}/${normalizeKey(namespace, key)}`;
  }

  async function localPath(key, createParent = false) {
    if (!localRoot) fail('OBJECT_STORAGE_ROOT_REQUIRED', 503);
    const relative = normalizeKey(namespace, key);
    const destination = path.resolve(localRoot, relative);
    if (!destination.startsWith(localRoot + path.sep)) fail('OBJECT_STORAGE_KEY_INVALID', 400);
    if (createParent) await fsp.mkdir(localRoot, { recursive: true, mode: 0o700 });
    let rootStat;
    try { rootStat = await fsp.lstat(localRoot); } catch (error) { if (error.code === 'ENOENT') fail('STORED_OBJECT_NOT_FOUND', 404); throw error; }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('OBJECT_STORAGE_ROOT_UNSAFE', 503);
    const directories = relative.split('/').slice(0, -1);
    let current = localRoot;
    for (const segment of directories) {
      current = path.join(current, segment);
      if (createParent) await fsp.mkdir(current, { recursive: false, mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      let stat;
      try { stat = await fsp.lstat(current); } catch (error) { if (error.code === 'ENOENT') fail('STORED_OBJECT_NOT_FOUND', 404); throw error; }
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('OBJECT_STORAGE_PATH_UNSAFE', 503);
    }
    return destination;
  }

  async function head(key) {
    if (selectedDriver === 'local') {
      const filePath = await localPath(key);
      let stat;
      try { stat = await fsp.lstat(filePath); } catch (error) { if (error.code === 'ENOENT') fail('STORED_OBJECT_NOT_FOUND', 404); throw error; }
      if (!stat.isFile() || stat.isSymbolicLink()) fail('OBJECT_STORAGE_PATH_UNSAFE', 503);
      return { contentLength: stat.size, sha256: null, path: filePath };
    }
    try {
      const result = await remote.client.send(new remote.sdk.HeadObjectCommand({ Bucket: config.bucket, Key: objectKey(key) }));
      return { contentLength: Number(result.ContentLength), sha256: result.Metadata?.sha256 || null, etag: result.ETag || null };
    } catch (error) { throw normalizeRemoteError(error); }
  }

  async function putFile(key, sourcePath, { contentLength, contentType, sha256 } = {}) {
    normalizeKey(namespace, key);
    if (!Number.isSafeInteger(contentLength) || contentLength < 1 || !/^[a-f0-9]{64}$/i.test(sha256 || '')) fail('OBJECT_STORAGE_METADATA_INVALID', 400);
    const sourceStat = await fsp.lstat(sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size !== contentLength) fail('OBJECT_STORAGE_SOURCE_INVALID', 400);
    if (selectedDriver === 'local') {
      const destination = await localPath(key, true);
      const handle = await fsp.open(destination, 'wx', 0o600);
      try {
        for await (const chunk of fs.createReadStream(sourcePath)) await handle.writeFile(chunk);
        await handle.sync();
      } catch (error) {
        await fsp.rm(destination, { force: true }).catch(() => {});
        throw error;
      } finally { await handle.close(); }
      return { driver: 'local', key: normalizeKey(namespace, key), path: destination, contentLength };
    }
    try {
      await remote.client.send(new remote.sdk.PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey(key),
        Body: fs.createReadStream(sourcePath),
        ContentLength: contentLength,
        ContentType: contentType || 'application/octet-stream',
        Metadata: { sha256: sha256.toLowerCase() }
      }));
      return { driver: 's3', key: normalizeKey(namespace, key), contentLength };
    } catch (error) { throw normalizeRemoteError(error); }
  }

  async function putBuffer(key, bytes, { contentType, sha256 } = {}) {
    if (!Buffer.isBuffer(bytes) || !bytes.length) fail('OBJECT_STORAGE_SOURCE_INVALID', 400);
    const digest = sha256 || crypto.createHash('sha256').update(bytes).digest('hex');
    if (selectedDriver === 'local') {
      const destination = await localPath(key, true);
      const handle = await fsp.open(destination, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); }
      catch (error) { await fsp.rm(destination, { force: true }).catch(() => {}); throw error; }
      finally { await handle.close(); }
      return { driver: 'local', key: normalizeKey(namespace, key), path: destination, contentLength: bytes.length };
    }
    try {
      await remote.client.send(new remote.sdk.PutObjectCommand({ Bucket: config.bucket, Key: objectKey(key), Body: bytes,
        ContentLength: bytes.length, ContentType: contentType || 'application/octet-stream', Metadata: { sha256: digest.toLowerCase() } }));
      return { driver: 's3', key: normalizeKey(namespace, key), contentLength: bytes.length };
    } catch (error) { throw normalizeRemoteError(error); }
  }

  async function openRead(key, { range } = {}) {
    if (selectedDriver === 'local') {
      const filePath = await localPath(key);
      const stat = await fsp.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) fail('OBJECT_STORAGE_PATH_UNSAFE', 503);
      const options = range ? { start: range.start, end: range.end } : undefined;
      return { driver: 'local', path: filePath, body: fs.createReadStream(filePath, options), contentLength: range ? range.end - range.start + 1 : stat.size };
    }
    try {
      const result = await remote.client.send(new remote.sdk.GetObjectCommand({ Bucket: config.bucket, Key: objectKey(key), ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}) }));
      return { driver: 's3', body: result.Body, contentLength: Number(result.ContentLength), contentRange: result.ContentRange || null };
    } catch (error) { throw normalizeRemoteError(error); }
  }

  async function readBuffer(key, { maxBytes = Number.MAX_SAFE_INTEGER } = {}) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) fail('OBJECT_STORAGE_LIMIT_INVALID', 500);
    if (selectedDriver === 'local') {
      const filePath = await localPath(key);
      const stat = await fsp.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) fail('OBJECT_STORAGE_PATH_UNSAFE', 503);
      if (stat.size > maxBytes) fail('STORED_OBJECT_TOO_LARGE', 413);
      return fsp.readFile(filePath);
    }
    const opened = await openRead(key);
    if (opened.contentLength > maxBytes) { opened.body.destroy?.(); fail('STORED_OBJECT_TOO_LARGE', 413); }
    const chunks = [];
    let size = 0;
    for await (const chunk of opened.body) {
      size += chunk.length;
      if (size > maxBytes) { opened.body.destroy?.(); fail('STORED_OBJECT_TOO_LARGE', 413); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  }

  async function remove(key) {
    normalizeKey(namespace, key);
    if (selectedDriver === 'local') {
      const filePath = await localPath(key);
      await fsp.rm(filePath, { force: true });
      return;
    }
    try { await remote.client.send(new remote.sdk.DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey(key) })); }
    catch (error) { throw normalizeRemoteError(error); }
  }

  return { driver: selectedDriver, namespace, head, putFile, putBuffer, openRead, readBuffer, remove, localPath: key => localPath(key) };
}

module.exports = { createStore, driver, safeSegment, normalizeKey, s3Config };
