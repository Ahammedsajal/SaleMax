'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPollingWorker } = require('../scripts/polling-worker.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('shutdown waits for an active poll before closing its database pool', async () => {
  const poll = deferred();
  const events = [];
  const worker = createPollingWorker({
    tick: () => { events.push('tick'); return poll.promise; },
    intervalMs: 10,
    close: async () => { events.push('close'); },
  });
  worker.start();
  await new Promise(resolve => setImmediate(resolve));
  const stopping = worker.stop();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['tick']);
  poll.resolve();
  await stopping;
  assert.deepEqual(events, ['tick', 'close']);
});

test('shutdown is idempotent and does not start another poll', async () => {
  let ticks = 0;
  let closes = 0;
  const worker = createPollingWorker({
    tick: async () => { ticks += 1; }, intervalMs: 5,
    close: async () => { closes += 1; },
  });
  worker.start();
  await new Promise(resolve => setTimeout(resolve, 1));
  await Promise.all([worker.stop(), worker.stop()]);
  await new Promise(resolve => setTimeout(resolve, 12));
  assert.equal(ticks, 1);
  assert.equal(closes, 1);
});

test('shutdown before the first poll skips queued work and closes the pool', async () => {
  let ticks = 0;
  let closes = 0;
  const worker = createPollingWorker({
    tick: async () => { ticks += 1; }, intervalMs: 10,
    close: async () => { closes += 1; },
  });
  worker.start();
  await worker.stop();
  assert.equal(ticks, 0);
  assert.equal(closes, 1);
});

test('one-shot polling closes the pool after the poll completes', async () => {
  const events = [];
  const worker = createPollingWorker({
    tick: async () => { events.push('tick'); }, intervalMs: 10, once: true,
    close: async () => { events.push('close'); },
  });
  worker.start();
  await new Promise(resolve => setTimeout(resolve, 1));
  assert.deepEqual(events, ['tick', 'close']);
});

test('poll failures are reported and shutdown still closes the pool', async () => {
  const events = [];
  const worker = createPollingWorker({
    tick: async () => { throw new Error('expected'); }, intervalMs: 1000, once: true,
    onError: () => { events.push('error'); },
    close: async () => { events.push('close'); },
  });
  worker.start();
  await new Promise(resolve => setTimeout(resolve, 1));
  assert.deepEqual(events, ['error', 'close']);
});

test('polling worker rejects invalid configuration', () => {
  assert.throws(() => createPollingWorker({ tick() {}, intervalMs: 0, close() {} }),
    /INVALID_POLLING_WORKER_OPTIONS/);
});
