'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveServiceImages, assertSharedLockContext, inspectPinnedImages, verifyRunningContainers } = require('../deploy/verify-pinned-images.cjs');

const digest = (char) => `ghcr.io/ahammedsajal/salemax@sha256:${char.repeat(64)}`;

test('image pins resolve independent service digests and keep legacy common fallback', () => {
  const distinct = resolveServiceImages({
    SALEMAX_APP_IMAGE_REF: digest('a'),
    SALEMAX_REPORT_WORKER_IMAGE_REF: digest('b'),
    SALEMAX_RECRUITMENT_WORKER_IMAGE_REF: digest('c'),
    SALEMAX_APP_SOURCE_COMMIT: '1'.repeat(40),
    SALEMAX_REPORT_WORKER_SOURCE_COMMIT: '2'.repeat(40),
    SALEMAX_RECRUITMENT_WORKER_SOURCE_COMMIT: '3'.repeat(40),
  });
  assert.deepEqual(distinct.map(({ image }) => image), [digest('a'), digest('b'), digest('c')]);

  const legacy = resolveServiceImages({ SALEMAX_IMAGE_REF: digest('d'), SALEMAX_SOURCE_COMMIT: '4'.repeat(40) });
  assert.deepEqual(legacy.map(({ image }) => image), [digest('d'), digest('d'), digest('d')]);
});

test('image pin validation rejects missing values, mutable tags, and other registries', () => {
  assert.throws(() => resolveServiceImages({}), /SALEMAX_APP_IMAGE_REF or SALEMAX_IMAGE_REF is required/);
  assert.throws(() => resolveServiceImages({ SALEMAX_IMAGE_REF: digest('d') }), /SALEMAX_APP_SOURCE_COMMIT or SALEMAX_SOURCE_COMMIT/);
  assert.throws(() => resolveServiceImages({ SALEMAX_IMAGE_REF: 'salemax-app:latest', SALEMAX_SOURCE_COMMIT: '1'.repeat(40) }), /mutable tags are not deployable/);
  assert.throws(() => resolveServiceImages({ SALEMAX_IMAGE_REF: `ghcr.io/ahammedsajal/other@sha256:${'e'.repeat(64)}`, SALEMAX_SOURCE_COMMIT: '1'.repeat(40) }), /mutable tags are not deployable/);
});

test('image verification requires this wrapper invocation to hold the shared flock', () => {
  const lockStat = { dev: 8, ino: 1204 };
  const env = { SALEMAX_DEPLOY_LOCK_HELD: '1', SALEMAX_DEPLOY_LOCK_FD: '9' };
  const context = { env, lockPath: '/lock', fstat: () => lockStat, stat: () => lockStat };
  assert.equal(assertSharedLockContext({ ...context, lockProbe: () => ({ status: 0 }) }), true);
  assert.throws(() => assertSharedLockContext({ ...context, env: {} }), /with-production-lock\.sh/);
  assert.throws(() => assertSharedLockContext({ ...context, lockProbe: () => ({ status: 75 }) }), /not held by this wrapper invocation/);
  assert.throws(() => assertSharedLockContext({ ...context, fstat: () => ({ dev: 8, ino: 1205 }) }), /shared production lock inode/);
  assert.throws(() => assertSharedLockContext({ ...context, fstat: () => { throw new Error('closed'); } }), /descriptor 9/);
});

test('production lock context distinguishes the inherited flock from another process lock', t => {
  if (process.platform !== 'linux' || spawnSync('sh', ['-c', 'command -v flock >/dev/null 2>&1']).status !== 0) {
    return t.skip('Linux flock and inherited descriptors are required');
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '7network-lock-context-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const lockPath = path.join(root, 'production.lock');
  const helperPath = path.resolve(__dirname, '../deploy/production-lock-context.cjs');
  const script = `
    set -eu
    exec 9>>"$TEST_LOCK_PATH"
    flock -n 9
    export SALEMAX_DEPLOY_LOCK_HELD=1 SALEMAX_DEPLOY_LOCK_FD=9
    node -e 'const {assertSharedLockContext}=require(process.env.TEST_HELPER); assertSharedLockContext({lockPath:process.env.TEST_LOCK_PATH});'
    flock -u 9
    exec 8>>"$TEST_LOCK_PATH"
    flock -n 8
    node -e 'const {assertSharedLockContext}=require(process.env.TEST_HELPER); try { assertSharedLockContext({lockPath:process.env.TEST_LOCK_PATH}); process.exit(9); } catch (error) { if (!/not held by this wrapper invocation/.test(error.message)) throw error; }'
  `;
  const result = spawnSync('sh', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, TEST_LOCK_PATH: lockPath, TEST_HELPER: helperPath },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('image preflight checks the pulled image identity, ARM64 platform, and source revision label', () => {
  const image = [{ service: 'app', image: digest('f') }];
  image[0].expectedRevision = '2'.repeat(40);
  const inspect = (_command, args) => {
    assert.deepEqual(args.slice(0, 3), ['image', 'inspect', digest('f')]);
    return { status: 0, stdout: `sha256:${'1'.repeat(64)}|linux/arm64|${'2'.repeat(40)}\n` };
  };
  assert.deepEqual(inspectPinnedImages(image, inspect), [{
    service: 'app', image: digest('f'), imageId: `sha256:${'1'.repeat(64)}`, revision: '2'.repeat(40),
  }]);
  assert.throws(() => inspectPinnedImages(image, () => ({ status: 0, stdout: `sha256:${'1'.repeat(64)}|linux/amd64|${'2'.repeat(40)}\n` })), /expected linux\/arm64/);
  assert.throws(() => inspectPinnedImages(image, () => ({ status: 0, stdout: `sha256:${'1'.repeat(64)}|linux/arm64|unknown\n` })), /source revision label/);
  assert.throws(() => inspectPinnedImages([{ ...image[0], expectedRevision: '3'.repeat(40) }], inspect), /does not match expected/);
});

test('post-deploy verification matches every running app and worker to its configured digest', () => {
  const images = [
    { service: 'app', image: digest('a') },
    { service: 'report-worker', image: digest('b') },
    { service: 'recruitment-founder-notification-worker', image: digest('c') },
  ];
  images.forEach((item, index) => { item.expectedRevision = String(index + 1).repeat(40); });
  const inspected = images.map((item, index) => ({
    ...item, imageId: `sha256:${String(index + 1).repeat(64)}`, revision: String(index + 1).repeat(40),
  }));
  const commands = [];
  const run = (_command, args) => {
    commands.push(args);
    if (args[0] === 'ps') {
      const serviceFilter = args.filter((arg) => arg.startsWith('label=com.docker.compose.service='))[0];
      return { status: 0, stdout: `container-${serviceFilter.split('=').pop()}\n` };
    }
    const service = args[args.indexOf('inspect') + 1].replace('container-', '');
    const expected = images.find((item) => item.service === service);
    const record = inspected.find((item) => item.service === service);
    return { status: 0, stdout: `${expected.image}|${record.imageId}\n` };
  };
  assert.deepEqual(verifyRunningContainers(images, inspected, run).map(({ service }) => service), images.map(({ service }) => service));
  assert.equal(commands.filter((args) => args[0] === 'ps').length, 3);
  assert.throws(() => verifyRunningContainers(images, inspected, () => ({ status: 0, stdout: '' })), /no running container/);
  assert.throws(() => verifyRunningContainers(images, inspected, (_command, args) => {
    if (args[0] === 'ps') {
      const serviceFilter = args.filter((arg) => arg.startsWith('label=com.docker.compose.service='))[0];
      return { status: 0, stdout: `container-${serviceFilter.split('=').pop()}\n` };
    }
    return { status: 0, stdout: `${digest('9')}|sha256:${'1'.repeat(64)}\n` };
  }), /requested .* expected the pinned digest/);
});
