'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const objectStorage = require('../modules/platform/object-storage');

const S3_ENV = {
  SALEMAX_OBJECT_STORAGE_DRIVER: 's3',
  SALEMAX_S3_BUCKET: '7network-private-test',
  SALEMAX_S3_REGION: 'me-central-1',
  SALEMAX_S3_ACCESS_KEY_ID: 'synthetic-access-key',
  SALEMAX_S3_SECRET_ACCESS_KEY: 'synthetic-secret-key',
  SALEMAX_S3_ENDPOINT: 'https://objects.example.test',
  SALEMAX_S3_PREFIX: '7network/test'
};

function sdkFor(store) {
  const command = operation => class { constructor(input) { this.operation = operation; this.input = input; } };
  return {
    PutObjectCommand: command('put'), GetObjectCommand: command('get'),
    HeadObjectCommand: command('head'), DeleteObjectCommand: command('delete')
  };
}

test('local object storage writes privately, supports ranged reads, and removes only the requested key', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '7network-object-local-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = objectStorage.createStore({ env: {}, namespace: 'course-media', root });
  const tenant = crypto.randomUUID(), course = crypto.randomUUID(), media = crypto.randomUUID();
  const key = `${tenant}/${course}/${media}`;
  const bytes = Buffer.from('durable-course-media');
  const source = path.join(root, 'source.tmp');
  await fs.writeFile(source, bytes);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const stored = await store.putFile(key, source, { contentLength: bytes.length, contentType: 'application/pdf', sha256: digest });
  assert.equal(stored.driver, 'local');
  assert.equal((await store.head(key)).contentLength, bytes.length);
  assert.deepEqual(await store.readBuffer(key), bytes);
  const ranged = await store.openRead(key, { range: { start: 2, end: 5 } });
  const chunks = [];
  for await (const chunk of ranged.body) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), bytes.subarray(2, 6));
  await store.remove(key);
  await assert.rejects(store.head(key), { code: 'STORED_OBJECT_NOT_FOUND' });
});

test('local storage rejects traversal and symlink directories', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '7network-object-safe-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), '7network-object-outside-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }); });
  const store = objectStorage.createStore({ env: {}, namespace: 'course-media', root });
  await assert.rejects(store.head('../outside'), { code: 'OBJECT_STORAGE_KEY_INVALID' });
  await fs.symlink(outside, path.join(root, crypto.randomUUID()));
  const key = `${(await fs.readdir(root))[0]}/${crypto.randomUUID()}/${crypto.randomUUID()}`;
  await assert.rejects(store.putBuffer(key, Buffer.from('private'), { contentType: 'text/plain' }), { code: 'OBJECT_STORAGE_PATH_UNSAFE' });
});

test('S3-compatible storage streams uploads, records checksums, supports ranges, and never exposes public ACLs', async t => {
  const objects = new Map();
  const requests = [];
  const sdk = sdkFor(objects);
  const client = { async send(command) {
    requests.push(command);
    const { Bucket, Key } = command.input;
    assert.equal(Bucket, '7network-private-test');
    if (command.operation === 'put') {
      const chunks = [];
      for await (const chunk of command.input.Body) chunks.push(chunk);
      objects.set(Key, { bytes: Buffer.concat(chunks), metadata: command.input.Metadata, contentType: command.input.ContentType });
      return {};
    }
    if (command.operation === 'head') {
      const value = objects.get(Key);
      if (!value) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      return { ContentLength: value.bytes.length, Metadata: value.metadata, ETag: '"synthetic"' };
    }
    if (command.operation === 'get') {
      const value = objects.get(Key);
      if (!value) throw Object.assign(new Error('missing'), { $metadata: { httpStatusCode: 404 } });
      const match = /^bytes=(\d+)-(\d+)$/.exec(command.input.Range || '');
      const bytes = match ? value.bytes.subarray(Number(match[1]), Number(match[2]) + 1) : value.bytes;
      return { Body: Readable.from([bytes]), ContentLength: bytes.length, ContentRange: match ? `bytes ${match[1]}-${match[2]}/${value.bytes.length}` : undefined };
    }
    if (command.operation === 'delete') { objects.delete(Key); return {}; }
    throw Error(`unexpected operation ${command.operation}`);
  } };
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '7network-object-s3-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = objectStorage.createStore({ env: S3_ENV, namespace: 'course-media', root, sdk, client });
  const bytes = Buffer.from('0123456789');
  const source = path.join(root, 'source.tmp');
  await fs.writeFile(source, bytes);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const key = `${crypto.randomUUID()}/${crypto.randomUUID()}/${crypto.randomUUID()}`;
  assert.equal((await store.putFile(key, source, { contentLength: bytes.length, contentType: 'video/mp4', sha256: digest })).driver, 's3');
  const head = await store.head(key);
  assert.equal(head.contentLength, bytes.length);
  assert.equal(head.sha256, digest);
  assert.deepEqual(await store.readBuffer(key), bytes);
  await assert.rejects(store.readBuffer(key, { maxBytes: 4 }), { code: 'STORED_OBJECT_TOO_LARGE' });
  const ranged = await store.openRead(key, { range: { start: 3, end: 6 } });
  const chunks = [];
  for await (const chunk of ranged.body) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), bytes.subarray(3, 7));
  assert.equal(requests[0].input.Metadata.sha256, digest);
  assert.equal(Object.hasOwn(requests[0].input, 'ACL'), false);
  assert.match(requests.at(-1).input.Range, /^bytes=3-6$/);
  await store.remove(key);
  await assert.rejects(store.head(key), { code: 'STORED_OBJECT_NOT_FOUND' });
});

test('S3 configuration requires explicit credentials and rejects insecure remote endpoints', () => {
  assert.throws(() => objectStorage.createStore({ env: { SALEMAX_OBJECT_STORAGE_DRIVER: 's3' }, namespace: 'course-media' }), { code: 'OBJECT_STORAGE_NOT_CONFIGURED' });
  assert.throws(() => objectStorage.s3Config({ ...S3_ENV, SALEMAX_S3_ENDPOINT: 'http://objects.example.test' }), { code: 'OBJECT_STORAGE_CONFIGURATION_INVALID' });
  assert.equal(objectStorage.s3Config({ ...S3_ENV, SALEMAX_S3_ENDPOINT: 'http://localhost:9000' }).endpoint, 'http://localhost:9000');
});
