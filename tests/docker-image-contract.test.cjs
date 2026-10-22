const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dockerfile = fs.readFileSync(path.join(root, 'deploy/Dockerfile'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'deploy/compose.yml'), 'utf8');
const imageBuilder = path.join(root, 'deploy/build-image.sh');

test('Dockerfile uses the same digest-pinned Node base for build and runtime', () => {
  const base = dockerfile.match(/^ARG NODE_IMAGE=(.+)$/m)?.[1];
  assert.match(base ?? '', /^node:22\.23\.3-bookworm-slim@sha256:[a-f0-9]{64}$/);
  assert.deepEqual(
    [...dockerfile.matchAll(/^FROM (.+) AS (.+)$/gm)].map((match) => [match[1], match[2]]),
    [['${NODE_IMAGE}', 'build'], ['${NODE_IMAGE}', 'runtime']]
  );
});

test('compiler and source-control tools stay in the build stage only', () => {
  const build = dockerfile.split(/^FROM \$\{NODE_IMAGE\} AS runtime$/m)[0];
  const runtime = dockerfile.split(/^FROM \$\{NODE_IMAGE\} AS runtime$/m)[1];
  assert.ok(runtime, 'runtime stage exists');
  for (const tool of ['git', 'g++', 'make', 'python3']) {
    assert.ok(build.includes(`        ${tool} \\\n`));
    assert.ok(!runtime.includes(`        ${tool} \\\n`));
  }
  assert.match(runtime, /COPY --from=build --chown=node:node \/app \/app/);
  assert.match(runtime, /^USER node$/m);
});

test('Compose runs app and workers from one required prebuilt release tag', () => {
  assert.doesNotMatch(compose, /^\s+build:/m);
  const imageLines = compose.split('\n').filter((line) => /^\s+image:/.test(line) && line.includes('salemax-app:'));
  assert.equal(imageLines.length, 3);
  for (const line of imageLines) {
    assert.match(line, /salemax-app:\$\{SALEMAX_IMAGE_TAG:\?/);
  }
  assert.equal((compose.match(/pull_policy: never/g) ?? []).length, 3);
});

test('runtime Compose retains both current single-server worker services', () => {
  assert.match(compose, /^  report-worker:$/m);
  assert.match(compose, /^  recruitment-founder-notification-worker:$/m);
  assert.match(compose, /scripts\/training-report-worker\.cjs/);
  assert.match(compose, /scripts\/recruitment-founder-notification-worker\.cjs/);
});

test('image builder rejects mutable and invalid release tags before building', () => {
  for (const tag of ['latest', 'release:2', '../release', '-invalid']) {
    const result = spawnSync('sh', [imageBuilder, tag], { encoding: 'utf8' });
    assert.equal(result.status, 2, `tag ${tag} should be rejected`);
    assert.match(result.stderr, /Usage:/);
  }
  const invalidSha = spawnSync('sh', [imageBuilder, 'release-test', 'not-a-commit'], { encoding: 'utf8' });
  assert.equal(invalidSha.status, 2);
  assert.match(invalidSha.stderr, /40-character source commit SHA/);
});
