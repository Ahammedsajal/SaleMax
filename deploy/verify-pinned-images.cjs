'use strict';

const { spawnSync } = require('node:child_process');

const IMAGE_PREFIX = 'ghcr.io/ahammedsajal/salemax@sha256:';
const SHARED_LOCK_PATH = '/opt/salemax/shared/7network-production-deploy.lock';
const DIGEST_IMAGE = /^ghcr\.io\/ahammedsajal\/salemax@sha256:[a-f0-9]{64}$/;
const SERVICES = [
  ['app', 'SALEMAX_APP_IMAGE_REF', 'SALEMAX_APP_SOURCE_COMMIT'],
  ['report-worker', 'SALEMAX_REPORT_WORKER_IMAGE_REF', 'SALEMAX_REPORT_WORKER_SOURCE_COMMIT'],
  ['recruitment-founder-notification-worker', 'SALEMAX_RECRUITMENT_WORKER_IMAGE_REF', 'SALEMAX_RECRUITMENT_WORKER_SOURCE_COMMIT'],
];

function resolveServiceImages(env = process.env) {
  return SERVICES.map(([service, variable, sourceVariable]) => {
    const image = env[variable] || env.SALEMAX_IMAGE_REF;
    if (!image) throw new Error(`${variable} or SALEMAX_IMAGE_REF is required`);
    if (!DIGEST_IMAGE.test(image)) {
      throw new Error(`${variable} must be ${IMAGE_PREFIX}<64 lowercase hex characters>; mutable tags are not deployable`);
    }
    const expectedRevision = env[sourceVariable] || env.SALEMAX_SOURCE_COMMIT;
    if (!/^[a-f0-9]{40}$/.test(expectedRevision || '')) {
      throw new Error(`${sourceVariable} or SALEMAX_SOURCE_COMMIT must name the expected 40-character source commit`);
    }
    return { service, variable, sourceVariable, image, expectedRevision };
  });
}

function assertSharedLockContext(env = process.env, fstat = require('node:fs').fstatSync, stat = require('node:fs').statSync) {
  if (env.SALEMAX_DEPLOY_LOCK_HELD !== '1') {
    throw new Error(`Run this preflight inside /opt/salemax/shared/with-production-lock.sh`);
  }

  let inherited;
  let shared;
  try {
    inherited = fstat(9);
    shared = stat(SHARED_LOCK_PATH);
  } catch {
    throw new Error('The shared production lock descriptor 9 is not inherited by this process');
  }
  if (inherited.dev !== shared.dev || inherited.ino !== shared.ino) {
    throw new Error('Descriptor 9 does not reference the shared production lock inode');
  }
  return true;
}

function inspectPinnedImages(images, run = spawnSync) {
  return images.map(({ service, image, expectedRevision }) => {
    const result = run('docker', [
      'image', 'inspect', image,
      '--format', '{{.Id}}|{{.Os}}/{{.Architecture}}|{{index .Config.Labels "org.opencontainers.image.revision"}}',
    ], { encoding: 'utf8' });

    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${service}: pinned image is not present locally; pull the exact digest first`);

    const [imageId, platform, revision] = result.stdout.trim().split('|');
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId || '')) throw new Error(`${service}: Docker returned an invalid image ID`);
    if (platform !== 'linux/arm64') throw new Error(`${service}: expected linux/arm64, got ${platform || 'unknown'}`);
    if (!/^[a-f0-9]{40}$/.test(revision || '')) throw new Error(`${service}: image source revision label is missing or invalid`);
    if (revision !== expectedRevision) throw new Error(`${service}: image source revision ${revision} does not match expected ${expectedRevision}`);
    return { service, image, imageId, revision };
  });
}

function verifyRunningContainers(images, inspected, run = spawnSync) {
  const imageByService = new Map(inspected.map((item) => [item.service, item]));
  const running = [];
  for (const { service, image } of images) {
    const list = run('docker', [
      'ps', '-q',
      '--filter', 'label=com.docker.compose.project=salemax',
      '--filter', `label=com.docker.compose.service=${service}`,
    ], { encoding: 'utf8' });
    if (list.error) throw list.error;
    if (list.status !== 0) throw new Error(`${service}: unable to list running containers`);
    const containers = list.stdout.trim().split(/\s+/).filter(Boolean);
    if (containers.length === 0) throw new Error(`${service}: no running container found`);

    for (const containerId of containers) {
      const result = run('docker', [
        'inspect', containerId,
        '--format', '{{.Config.Image}}|{{.Image}}',
      ], { encoding: 'utf8' });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`${service}: unable to inspect container ${containerId}`);
      const [requested, imageId] = result.stdout.trim().split('|');
      const expected = imageByService.get(service);
      if (requested !== image) throw new Error(`${service}: container ${containerId} requested ${requested}; expected the pinned digest`);
      if (imageId !== expected.imageId) throw new Error(`${service}: container ${containerId} image ID differs from the pinned digest`);
      running.push({ service, containerId, image, imageId, revision: expected.revision });
    }
  }
  return running;
}

function main() {
  assertSharedLockContext();

  const images = resolveServiceImages();
  const inspected = inspectPinnedImages(images);
  const runningMode = process.argv.includes('--running');
  const rows = runningMode ? verifyRunningContainers(images, inspected) : inspected;
  for (const item of rows) {
    const identity = runningMode ? item.containerId : 'not-checked';
    process.stdout.write(`${item.service}\t${item.image}\t${item.imageId}\t${item.revision}\t${identity}\n`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { resolveServiceImages, assertSharedLockContext, inspectPinnedImages, verifyRunningContainers };
