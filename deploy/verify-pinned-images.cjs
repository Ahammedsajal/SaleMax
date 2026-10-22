'use strict';

const { spawnSync } = require('node:child_process');
const { assertSharedLockContext } = require('./production-lock-context.cjs');

const IMAGE_PREFIX = 'ghcr.io/ahammedsajal/salemax@sha256:';
const DIGEST_IMAGE = /^ghcr\.io\/ahammedsajal\/salemax@sha256:[a-f0-9]{64}$/;
const DB_IMAGE_PREFIX = 'mariadb@sha256:';
const DB_IMAGE = /^mariadb@sha256:[a-f0-9]{64}$/;
const DB_IMAGE_DEFAULT = 'mariadb@sha256:70cc072b29b4a89ae07abb2d4da2c64678a7f2dfe092751bb51c87d67dc1338b';
const SERVICES = [
  { service: 'app', variable: 'SALEMAX_APP_IMAGE_REF', sourceVariable: 'SALEMAX_APP_SOURCE_COMMIT' },
  { service: 'report-worker', variable: 'SALEMAX_REPORT_WORKER_IMAGE_REF', sourceVariable: 'SALEMAX_REPORT_WORKER_SOURCE_COMMIT' },
  { service: 'recruitment-founder-notification-worker', variable: 'SALEMAX_RECRUITMENT_WORKER_IMAGE_REF', sourceVariable: 'SALEMAX_RECRUITMENT_WORKER_SOURCE_COMMIT' },
  { service: 'db', variable: 'SALEMAX_DB_IMAGE_REF', imageDefault: DB_IMAGE_DEFAULT, expectedVersion: '11.4.13' },
];

function resolveServiceImages(env = process.env) {
  return SERVICES.map(({ service, variable, sourceVariable, imageDefault, expectedVersion }) => {
    const image = env[variable] || (service === 'db' ? imageDefault : env.SALEMAX_IMAGE_REF);
    if (!image) throw new Error(`${variable} or SALEMAX_IMAGE_REF is required`);
    const allowedImage = service === 'db' ? DB_IMAGE : DIGEST_IMAGE;
    const imagePrefix = service === 'db' ? DB_IMAGE_PREFIX : IMAGE_PREFIX;
    if (!allowedImage.test(image)) {
      throw new Error(`${variable} must be ${imagePrefix}<64 lowercase hex characters>; mutable tags are not deployable`);
    }
    const expectedRevision = sourceVariable ? env[sourceVariable] || env.SALEMAX_SOURCE_COMMIT : null;
    if (sourceVariable && !/^[a-f0-9]{40}$/.test(expectedRevision || '')) {
      throw new Error(`${sourceVariable} or SALEMAX_SOURCE_COMMIT must name the expected 40-character source commit`);
    }
    return { service, variable, sourceVariable, image, expectedRevision, expectedVersion: expectedVersion || null };
  });
}

function inspectPinnedImages(images, run = spawnSync) {
  return images.map(({ service, image, expectedRevision, expectedVersion }) => {
    const result = run('docker', [
      'image', 'inspect', image,
      '--format', '{{.Id}}|{{.Os}}/{{.Architecture}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "org.opencontainers.image.version"}}',
    ], { encoding: 'utf8' });

    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${service}: pinned image is not present locally; pull the exact digest first`);

    const [imageId, platform, revision, version] = result.stdout.trim().split('|');
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId || '')) throw new Error(`${service}: Docker returned an invalid image ID`);
    if (platform !== 'linux/arm64') throw new Error(`${service}: expected linux/arm64, got ${platform || 'unknown'}`);
    if (expectedRevision) {
      if (!/^[a-f0-9]{40}$/.test(revision || '')) throw new Error(`${service}: image source revision label is missing or invalid`);
      if (revision !== expectedRevision) throw new Error(`${service}: image source revision ${revision} does not match expected ${expectedRevision}`);
    }
    if (expectedVersion && version !== expectedVersion) throw new Error(`${service}: image version ${version || 'unknown'} does not match expected ${expectedVersion}`);
    return { service, image, imageId, revision: expectedRevision ? revision : null, version: expectedVersion ? version : null };
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
    running.push({ service, containerId, image, imageId, revision: expected.revision, version: expected.version });
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
    process.stdout.write(`${item.service}\t${item.image}\t${item.imageId}\t${item.revision || item.version || 'external'}\t${identity}\n`);
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
