const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const dockerfile = fs.readFileSync(path.join(root, 'deploy/Dockerfile'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'deploy/compose.yml'), 'utf8');
const imageBuilder = path.join(root, 'deploy/build-image.sh');
const imageWorkflow = fs.readFileSync(path.join(root, '.github/workflows/7network-arm64-image.yml'), 'utf8');
const publishWorkflow = fs.readFileSync(path.join(root, '.github/workflows/7network-arm64-publish.yml'), 'utf8');
const lockScript = fs.readFileSync(path.join(root, 'deploy/with-production-lock.sh'), 'utf8');
const runtimeSmoke = fs.readFileSync(path.join(root, 'deploy/verify-container-runtime.cjs'), 'utf8');
const serverEntrypoints = ['app.js', 'server.js'].map((file) => fs.readFileSync(path.join(root, file), 'utf8'));

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

test('Compose accepts independently pinned app and worker images with a legacy common fallback', () => {
  assert.doesNotMatch(compose, /^\s+build:/m);
  const imageLines = compose.split('\n').filter((line) => /^\s+image:/.test(line) && line.includes('salemax-app:'));
  assert.equal(imageLines.length, 0);
  const digestLines = compose.split('\n').filter((line) => /^\s+image:/.test(line) && line.includes('SALEMAX_IMAGE_REF'));
  assert.equal(digestLines.length, 3);
  assert.match(digestLines[0], /SALEMAX_APP_IMAGE_REF/);
  assert.match(digestLines[1], /SALEMAX_REPORT_WORKER_IMAGE_REF/);
  assert.match(digestLines[2], /SALEMAX_RECRUITMENT_WORKER_IMAGE_REF/);
  for (const line of digestLines) assert.match(line, /SALEMAX_IMAGE_REF:\?/,
    'legacy common image ref fallback remains required and must itself be digest-pinned');
  assert.equal((compose.match(/pull_policy: never/g) ?? []).length, 3);
});

test('runtime Compose retains both current single-server worker services', () => {
  assert.match(compose, /^  report-worker:$/m);
  assert.match(compose, /^  recruitment-founder-notification-worker:$/m);
  assert.match(compose, /scripts\/training-report-worker\.cjs/);
  assert.match(compose, /scripts\/recruitment-founder-notification-worker\.cjs/);
});

test('app Compose service allows the bounded graceful shutdown to finish', () => {
  const appService = compose.split(/^  app:\n/m)[1]?.split(/^  report-worker:\n/m)[0];
  assert.ok(appService, 'app service exists');
  assert.match(appService, /^    init: true$/m);
  assert.match(appService, /^    stop_grace_period: 30s$/m);
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

test('ARM64 image CI is unprivileged and trusted publish accepts only its successful main push artifact', () => {
  assert.match(imageWorkflow, /platforms: linux\/arm64/);
  assert.match(imageWorkflow, /outputs: type=docker,dest=\/tmp\/7network-arm64-image\.tar/);
  assert.match(imageWorkflow, /VCS_REF=\$\{\{ github\.sha \}\}/);
  assert.match(imageWorkflow, /Report exact ARM64 image size and layers/);
  assert.match(imageWorkflow, /docker image inspect .*\.Id.*\.Size.*RootFS\.Layers/);
  assert.match(imageWorkflow, /tee -a "\$GITHUB_STEP_SUMMARY"/);
  assert.match(imageWorkflow, /node --test tests\/docker-image-contract\.test\.cjs tests\/deploy-image-pins\.test\.cjs tests\/graceful-shutdown\.test\.cjs tests\/7network-capacity-alert\.test\.cjs tests\/object-storage\.test\.cjs tests\/object-storage-migration\.test\.cjs tests\/training-payment-proofs\.test\.js tests\/recruitment-applications\.test\.js/);
  assert.match(imageWorkflow, /deploy\/verify-container-runtime\.cjs/);
  assert.match(imageWorkflow, /dst=\/app\/verify-container-runtime\.cjs,readonly/);
  assert.ok(imageWorkflow.includes('/app/verify-container-runtime.cjs'));
  assert.match(imageWorkflow, /actions\/upload-artifact@/);
  assert.doesNotMatch(imageWorkflow, /packages: write|docker\/login-action@|secrets\.GITHUB_TOKEN/,
    'pull request build must have no registry write credentials');
  assert.match(publishWorkflow, /workflow_run:/);
  assert.match(publishWorkflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(publishWorkflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(publishWorkflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(publishWorkflow, /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
  assert.match(publishWorkflow, /actions: read[\s\S]*packages: write/);
  assert.match(publishWorkflow, /actions\/download-artifact@/);
  assert.match(publishWorkflow, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(publishWorkflow, /secrets\.GITHUB_TOKEN/);
  assert.match(publishWorkflow, /sha-\$\{SOURCE_SHA\}-run-\$\{SOURCE_RUN_ID\}-\$\{SOURCE_RUN_ATTEMPT\}/);
  assert.match(publishWorkflow, /Refusing to replace existing registry tag/);
  assert.match(publishWorkflow, /Immutable deployment reference/);
  for (const workflow of [imageWorkflow, publishWorkflow]) {
    const pinnedActions = [...workflow.matchAll(/^\s+uses: ([^\s]+)$/gm)].map((match) => match[1]);
    assert.ok(pinnedActions.length > 0);
    for (const action of pinnedActions) assert.match(action, /@[a-f0-9]{40}$/);
  }
});

test('both Node server entrypoints use the bounded graceful shutdown coordinator', () => {
  for (const entrypoint of serverEntrypoints) {
    assert.match(entrypoint, /installGracefulShutdown\(\{/);
    assert.match(entrypoint, /io,/);
    assert.match(entrypoint, /timeoutMs: 25000/);
  }
});

test('production lock wrapper acquires the shared flock before re-resolving current', () => {
  assert.match(lockScript, /\/opt\/salemax\/shared\/7network-production-deploy\.lock/);
  assert.match(lockScript, /set -C; : > "\$LOCK_FILE"/);
  assert.match(lockScript, /\[ -L "\$LOCK_FILE" \]/);
  assert.match(lockScript, /\[ ! -f "\$LOCK_FILE" \]/);
  const acquire = lockScript.indexOf('flock -n -E 75 9');
  const resolve = lockScript.indexOf('readlink -f "$CURRENT_LINK"');
  assert.ok(acquire >= 0 && resolve > acquire);
  assert.match(lockScript, /export SALEMAX_ACTIVE_RELEASE_BEFORE=/);
  assert.match(lockScript, /export SALEMAX_DEPLOY_LOCK_HELD=1/);
  assert.match(lockScript, /cd "\$active_release"/);
  assert.match(lockScript, /if "\$@"; then/);
  assert.match(lockScript, /Another 7Network production operation holds the deployment lock/);
});

test('production lock wrapper holds the shared OS lock for its synchronous command', async (t) => {
  const hasFlock = spawnSync('sh', ['-c', 'command -v flock >/dev/null 2>&1'], { encoding: 'utf8' }).status === 0;
  if (!hasFlock) return t.skip('flock is unavailable on this host');

  const os = require('node:os');
  const { spawn } = require('node:child_process');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), '7network-lock-contract-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

  const releaseRoot = path.join(tempRoot, 'releases');
  const active = path.join(releaseRoot, 'release-a');
  const shared = path.join(tempRoot, 'shared');
  const current = path.join(tempRoot, 'current');
  const lockFile = path.join(shared, '7network-production-deploy.lock');
  fs.mkdirSync(active, { recursive: true });
  fs.mkdirSync(shared);
  fs.symlinkSync(active, current);

  const script = lockScript
    .replace('/opt/salemax/shared/7network-production-deploy.lock', lockFile)
    .replace('/opt/salemax/current', current)
    .replace('/opt/salemax/releases/', `${releaseRoot}/`);
  const isolatedScript = path.join(tempRoot, 'with-production-lock.sh');
  fs.writeFileSync(isolatedScript, script, { mode: 0o700 });

  const command = `
    test "$SALEMAX_DEPLOY_LOCK_HELD" = 1
    test "$SALEMAX_ACTIVE_RELEASE_BEFORE" = "${active}"
    test "$PWD" = "${active}"
    sleep 1
    if flock -n -E 75 "${lockFile}" true; then exit 90; else status=$?; fi
    test "$status" -eq 75
  `;
  const runWrapper = () => new Promise((resolve, reject) => {
    const child = spawn('sh', [isolatedScript, 'sh', '-c', command], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  const outcomes = await Promise.all([runWrapper(), runWrapper()]);
  assert.deepEqual(outcomes.map(({ code }) => code).sort((a, b) => a - b), [0, 75],
    outcomes.map(({ stderr, stdout }) => stderr || stdout).join('\n'));
  assert.match(outcomes.find(({ code }) => code === 0).stdout, /Production lock acquired/);
  assert.equal(fs.statSync(lockFile).mode & 0o777, 0o600);

  fs.unlinkSync(lockFile);
  const symlinkTarget = path.join(tempRoot, 'real-lock-target');
  fs.writeFileSync(symlinkTarget, '');
  fs.symlinkSync(symlinkTarget, lockFile);
  const symlinkAttempt = spawnSync('sh', [isolatedScript, 'true'], { encoding: 'utf8' });
  assert.equal(symlinkAttempt.status, 73, symlinkAttempt.stderr || symlinkAttempt.stdout);
  assert.match(symlinkAttempt.stderr, /must not be a symlink/);
});

test('ARM64 runtime smoke exercises all native packages and rejects root', () => {
  assert.match(runtimeSmoke, /process\.arch, 'arm64'/);
  assert.match(runtimeSmoke, /process\.getuid\?\.\(\), 0/);
  assert.match(runtimeSmoke, /require\('bcrypt'\)/);
  assert.match(runtimeSmoke, /require\('sharp'\)/);
  assert.match(runtimeSmoke, /require\('@roamhq\/wrtc'\)/);
  assert.match(runtimeSmoke, /process\.once\('SIGTERM'/);
  assert.match(runtimeSmoke, /probe-ready/);
  assert.match(runtimeSmoke, /graceful-signal-relay/);
  assert.match(runtimeSmoke, /require\('ffmpeg-static'\)/);
  assert.match(runtimeSmoke, /require\('@aws-sdk\/client-s3'\)/);
  assert.match(runtimeSmoke, /ffmpeg version/i);
});
