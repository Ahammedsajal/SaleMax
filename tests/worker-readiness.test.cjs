'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { markWorkerReady, isWorkerReady } = require('../scripts/worker-readiness.cjs');

test('worker readiness accepts only a fresh valid regular-file heartbeat', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '7network-worker-ready-'));
  const file = path.join(root, 'ready');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(isWorkerReady(file, { now: 1000, maxAgeMs: 500 }), false);
  markWorkerReady(file, 800);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(isWorkerReady(file, { now: 1000, maxAgeMs: 500 }), true);
  assert.equal(isWorkerReady(file, { now: 1301, maxAgeMs: 500 }), false);
  assert.equal(isWorkerReady(file, { now: 799, maxAgeMs: 500 }), false);
  fs.writeFileSync(file, 'not-a-timestamp\n');
  assert.equal(isWorkerReady(file, { now: 1000, maxAgeMs: 500 }), false);
  fs.writeFileSync(file, '1000'.repeat(9));
  assert.equal(isWorkerReady(file, { now: 1000, maxAgeMs: 500 }), false);
  fs.rmSync(file);
  fs.symlinkSync(path.join(root, 'target'), file);
  fs.writeFileSync(path.join(root, 'target'), '1000\n');
  assert.equal(isWorkerReady(file, { now: 1000, maxAgeMs: 500 }), false);
});

test('worker readiness rejects invalid paths and options', () => {
  assert.equal(isWorkerReady('relative', { now: 1000 }), false);
  assert.equal(isWorkerReady('/missing', { now: 1000, maxAgeMs: 0 }), false);
  assert.throws(() => markWorkerReady('relative', 1000), /INVALID_WORKER_READINESS_INPUT/);
});
