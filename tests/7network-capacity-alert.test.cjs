'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '../deploy/7network-capacity-alert.sh');
const service = fs.readFileSync(path.resolve(__dirname, '../deploy/7network-capacity-alert.service'), 'utf8');
const timer = fs.readFileSync(path.resolve(__dirname, '../deploy/7network-capacity-alert.timer'), 'utf8');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '7network-capacity-'));
  const bin = path.join(root, 'bin');
  const state = path.join(root, 'state');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'df'), `#!/bin/sh
case "$*" in
  *itotal*) printf 'Filesystem Inodes IUsed IFree IUse%%\\n/dev/fake %s\\n' "$TEST_INODE_LINE" ;;
  *) printf 'Filesystem 1B-blocks Used Available Use%%\\n/dev/fake %s\\n' "$TEST_DISK_LINE" ;;
esac
`);
  fs.writeFileSync(path.join(bin, 'du'), `#!/bin/sh
printf '%s %s\\n' "$TEST_RELEASE_BYTES" "$TEST_RELEASE_PATH"
`);
  fs.writeFileSync(path.join(bin, 'flock'), '#!/bin/sh\nexit 0\n');
  fs.writeFileSync(path.join(bin, 'timeout'), '#!/bin/sh\nshift\nexec "$@"\n');
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
if [ "$1" = image ] && [ "$2" = ls ]; then
  printf 'id-image-a\\nid-image-b\\nid-image-a\\n'
  exit 0
fi
if [ "$1" = image ] && [ "$2" = inspect ]; then
  printf '%s\\n%s\\n' "$TEST_IMAGE_SIZE" "$TEST_IMAGE_SIZE"
  exit 0
fi
if [ "$1" = ps ]; then
  service=
  for arg do case "$arg" in label=com.docker.compose.service=*) service="${'${'}arg##*=}" ;; esac; done
  case ",${'${'}TEST_DOCKER_MISSING:-}," in *",${'${'}service},"*) exit 0 ;; esac
  printf 'id-%s\\n' "$service"
  exit 0
fi
if [ "$1" = inspect ]; then
  for arg do id="$arg"; done
  service="${'${'}id#id-}"
  status=none
  [ "$service" != app ] || status="${'${'}TEST_DOCKER_APP_HEALTH:-healthy}"
  [ "$service" != db ] || status="${'${'}TEST_DOCKER_DB_HEALTH:-healthy}"
  printf 'true|%s\\n' "$status"
  exit 0
fi
exit 1
`);
  fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/sh
payload=
while [ "$#" -gt 0 ]; do
  if [ "$1" = --data-binary ]; then shift; payload="$1"; fi
  shift
done
printf '%s\\n' "$payload" >> "$TEST_CURL_LOG"
[ "${'${'}TEST_CURL_FAIL:-0}" != 1 ] || exit 22
printf '%s' "${'${'}TEST_HTTP_CODE:-200}"
`);
  for (const name of ['df', 'du', 'flock', 'timeout', 'docker', 'curl']) fs.chmodSync(path.join(bin, name), 0o755);
  const releases = path.join(root, 'releases');
  fs.mkdirSync(releases);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH || '/usr/bin:/bin'}`,
    SALEMAX_CAPACITY_STATE_DIR: state,
    SALEMAX_CAPACITY_PATH: '/',
    SALEMAX_RELEASES_PATH: releases,
    SALEMAX_RELEASE_GROWTH_WARNING_BYTES: '1000000000',
    SALEMAX_RELEASE_GROWTH_CRITICAL_BYTES: '5000000000',
    SALEMAX_IMAGE_GROWTH_WARNING_BYTES: '1000000000',
    SALEMAX_IMAGE_GROWTH_CRITICAL_BYTES: '5000000000',
    TEST_RELEASE_BYTES: '10000000000',
    TEST_RELEASE_PATH: releases,
    TEST_IMAGE_SIZE: '500000000',
    TEST_DISK_LINE: '100000000000 1000000000 99000000000 1%',
    TEST_INODE_LINE: '1000000 1000 999000 1%',
    TEST_DOCKER_MISSING: '',
    TEST_DOCKER_APP_HEALTH: 'healthy',
    TEST_DOCKER_DB_HEALTH: 'healthy',
    TEST_CURL_LOG: path.join(root, 'payloads.log'),
    SALEMAX_CAPACITY_ALERT_WEBHOOK_URL: 'https://alerts.example.invalid/hook'
  };
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { env, state, payloadLog: env.TEST_CURL_LOG };
}

function run(env) {
  return spawnSync('/bin/bash', [script], { encoding: 'utf8', env });
}

test('systemd monitor runs every five minutes with bounded writable state and an external secret file', () => {
  assert.match(service, /^EnvironmentFile=-\/opt\/salemax\/shared\/ops-alerts\.env$/m);
  assert.match(service, /^StateDirectory=7network-ops$/m);
  assert.match(service, /^ReadWritePaths=\/var\/lib\/7network-ops$/m);
  assert.match(service, /^ExecStart=\/opt\/salemax\/current\/deploy\/7network-capacity-alert\.sh$/m);
  assert.match(service, /^NoNewPrivileges=true$/m);
  assert.match(service, /^ProtectSystem=strict$/m);
  assert.match(timer, /^OnUnitActiveSec=5min$/m);
  assert.match(timer, /^Persistent=true$/m);
});

test('healthy disk and inode usage does not send an alert', t => {
  const f = fixture(t);
  const result = run(f.env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(f.payloadLog), false);
  assert.equal(fs.existsSync(path.join(f.state, 'last-severity')), false);
});

test('disk critical transition sends once and deduplicates repeated checks', t => {
  const f = fixture(t);
  f.env.TEST_DISK_LINE = '100000000000 95000000000 5000000000 95%';
  const first = run(f.env);
  const second = run(f.env);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.match(fs.readFileSync(f.payloadLog, 'utf8'), /capacity critical/);
  assert.equal(fs.readFileSync(f.payloadLog, 'utf8').trim().split('\n').length, 1);
  assert.equal(fs.readFileSync(path.join(f.state, 'last-severity'), 'utf8').trim(), 'critical|none|none|none');
});

test('inode thresholds and low-free-space thresholds can raise the alert level', t => {
  const f = fixture(t);
  f.env.TEST_INODE_LINE = '1000000 860000 140000 86%';
  let result = run(f.env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(f.payloadLog, 'utf8'), /capacity urgent/);

  f.env.TEST_INODE_LINE = '1000000 1000 999000 1%';
  f.env.TEST_DISK_LINE = '100000000000 1000000000 4000000000 1%';
  result = run(f.env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(f.payloadLog, 'utf8'), /capacity warning/);
});

test('recovery is reported after an alert clears', t => {
  const f = fixture(t);
  f.env.TEST_DISK_LINE = '100000000000 85000000000 15000000000 85%';
  assert.equal(run(f.env).status, 0);
  f.env.TEST_DISK_LINE = '100000000000 1000000000 99000000000 1%';
  assert.equal(run(f.env).status, 0);
  const payloads = fs.readFileSync(f.payloadLog, 'utf8').trim().split('\n');
  assert.equal(payloads.length, 2);
  assert.match(payloads[1], /capacity and service health recovered/);
  assert.equal(fs.readFileSync(path.join(f.state, 'last-severity'), 'utf8').trim(), 'normal|none|none|none');
});

test('delivery failure does not mark the alert as delivered', t => {
  const f = fixture(t);
  f.env.TEST_DISK_LINE = '100000000000 95000000000 5000000000 95%';
  f.env.TEST_CURL_FAIL = '1';
  assert.notEqual(run(f.env).status, 0);
  assert.equal(fs.existsSync(path.join(f.state, 'last-severity')), false);
  f.env.TEST_CURL_FAIL = '0';
  assert.equal(run(f.env).status, 0);
  assert.equal(fs.readFileSync(path.join(f.state, 'last-severity'), 'utf8').trim(), 'critical|none|none|none');
});

test('non-2xx webhook responses do not advance alert state', t => {
  const f = fixture(t);
  f.env.TEST_DISK_LINE = '100000000000 95000000000 5000000000 95%';
  f.env.TEST_HTTP_CODE = '302';
  const result = run(f.env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /returned HTTP 302/);
  assert.equal(fs.existsSync(path.join(f.state, 'last-severity')), false);
});

test('unsafe or missing webhook configuration fails closed when an alert is due', t => {
  const f = fixture(t);
  f.env.TEST_INODE_LINE = '1000000 910000 90000 91%';
  f.env.SALEMAX_CAPACITY_ALERT_WEBHOOK_URL = 'http://alerts.example.invalid/hook';
  const result = run(f.env);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /HTTPS alert webhook is not configured/);
  assert.equal(fs.existsSync(path.join(f.state, 'last-severity')), false);
});

test('missing and unhealthy app or database services raise critical alerts', t => {
  const f = fixture(t);
  f.env.TEST_DOCKER_APP_HEALTH = 'unhealthy';
  f.env.TEST_DOCKER_MISSING = 'recruitment-founder-notification-worker';
  const result = run(f.env);
  assert.equal(result.status, 0, result.stderr);
  const payload = fs.readFileSync(f.payloadLog, 'utf8');
  assert.match(payload, /capacity critical/);
  assert.match(payload, /unhealthy or missing services: app,recruitment-founder-notification-worker/);
  assert.equal(
    fs.readFileSync(path.join(f.state, 'last-severity'), 'utf8').trim(),
    'critical|app,recruitment-founder-notification-worker|none|none'
  );
});

test('service failure changes alert state and recovery is sent after services return', t => {
  const f = fixture(t);
  f.env.TEST_DOCKER_MISSING = 'report-worker';
  assert.equal(run(f.env).status, 0);
  f.env.TEST_DOCKER_MISSING = '';
  assert.equal(run(f.env).status, 0);
  const payloads = fs.readFileSync(f.payloadLog, 'utf8').trim().split('\n');
  assert.equal(payloads.length, 2);
  assert.match(payloads[0], /report-worker/);
  assert.match(payloads[1], /capacity and service health recovered/);
  assert.equal(fs.readFileSync(path.join(f.state, 'last-severity'), 'utf8').trim(), 'normal|none|none|none');
});

test('service recovery is reported even when disk capacity remains critical', t => {
  const f = fixture(t);
  f.env.TEST_DISK_LINE = '100000000000 95000000000 5000000000 95%';
  f.env.TEST_DOCKER_MISSING = 'report-worker';
  assert.equal(run(f.env).status, 0);
  f.env.TEST_DOCKER_MISSING = '';
  assert.equal(run(f.env).status, 0);
  const payloads = fs.readFileSync(f.payloadLog, 'utf8').trim().split('\n');
  assert.equal(payloads.length, 2);
  assert.match(payloads[1], /Service health recovered; capacity remains critical/);
  assert.equal(fs.readFileSync(path.join(f.state, 'last-severity'), 'utf8').trim(), 'critical|none|none|none');
});

test('legacy severity-only state migrates without sending a duplicate alert', t => {
  const f = fixture(t);
  fs.mkdirSync(f.state, { recursive: true });
  fs.writeFileSync(path.join(f.state, 'last-severity'), 'critical\n');
  f.env.TEST_DISK_LINE = '100000000000 95000000000 5000000000 95%';
  const result = run(f.env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(f.payloadLog), false);
});

test('release growth establishes a baseline, alerts at warning and critical levels, deduplicates, and resets after shrink', t => {
  const f = fixture(t);
  assert.equal(run(f.env).status, 0);
  const baselineFile = path.join(f.state, 'releases-baseline-bytes');
  assert.equal(fs.readFileSync(baselineFile, 'utf8').trim(), '10000000000');
  assert.equal(fs.existsSync(f.payloadLog), false);

  f.env.TEST_RELEASE_BYTES = '11500000000';
  assert.equal(run(f.env).status, 0);
  assert.match(fs.readFileSync(f.payloadLog, 'utf8'), /Release tree growth warning: 1500000000 bytes over baseline/);
  assert.equal(run(f.env).status, 0);
  assert.equal(fs.readFileSync(f.payloadLog, 'utf8').trim().split('\n').length, 1);

  f.env.TEST_RELEASE_BYTES = '16000000000';
  assert.equal(run(f.env).status, 0);
  assert.match(fs.readFileSync(f.payloadLog, 'utf8'), /capacity critical/);
  assert.match(fs.readFileSync(f.payloadLog, 'utf8'), /Release tree growth critical: 6000000000 bytes over baseline/);

  f.env.TEST_RELEASE_BYTES = '9000000000';
  assert.equal(run(f.env).status, 0);
  assert.equal(fs.readFileSync(baselineFile, 'utf8').trim(), '9000000000');
  assert.match(fs.readFileSync(f.payloadLog, 'utf8'), /Release tree growth returned below threshold/);
  assert.equal(fs.readFileSync(path.join(f.state, 'last-severity'), 'utf8').trim(), 'normal|none|none|none');
});

test('Docker image virtual-size growth establishes a baseline, alerts once, escalates, and resets after shrink', t => {
  const f = fixture(t);
  assert.equal(run(f.env).status, 0);
  const baselineFile = path.join(f.state, 'docker-image-baseline-bytes');
  assert.equal(fs.readFileSync(baselineFile, 'utf8').trim(), '1000000000');
  assert.equal(fs.existsSync(f.payloadLog), false);

  f.env.TEST_IMAGE_SIZE = '1250000000';
  assert.equal(run(f.env).status, 0);
  assert.match(fs.readFileSync(f.payloadLog, 'utf8'), /Docker image virtual-size growth warning: 1500000000 bytes over baseline/);
  assert.match(fs.readFileSync(f.payloadLog, 'utf8'), /shared layers may be counted more than once/);
  assert.equal(run(f.env).status, 0);
  assert.equal(fs.readFileSync(f.payloadLog, 'utf8').trim().split('\n').length, 1);

  f.env.TEST_IMAGE_SIZE = '3000000000';
  assert.equal(run(f.env).status, 0);
  assert.match(fs.readFileSync(f.payloadLog, 'utf8'), /Docker image virtual-size growth critical: 5000000000 bytes over baseline/);

  f.env.TEST_IMAGE_SIZE = '250000000';
  assert.equal(run(f.env).status, 0);
  assert.equal(fs.readFileSync(baselineFile, 'utf8').trim(), '500000000');
  assert.match(fs.readFileSync(f.payloadLog, 'utf8'), /Docker image growth returned below threshold/);
  assert.equal(fs.readFileSync(path.join(f.state, 'last-severity'), 'utf8').trim(), 'normal|none|none|none');
});

test('invalid release growth thresholds fail before monitor state is changed', t => {
  const f = fixture(t);
  f.env.SALEMAX_RELEASE_GROWTH_WARNING_BYTES = '0';
  const result = run(f.env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /thresholds must be positive integers/);
  assert.equal(fs.existsSync(path.join(f.state, 'last-severity')), false);
});
