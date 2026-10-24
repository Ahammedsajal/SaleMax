const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  createGracefulShutdownHandler,
  installGracefulShutdown,
} = require('../modules/platform/graceful-shutdown');

function createHarness() {
  const events = [];
  let deadlineCallback;
  const processRef = new EventEmitter();
  processRef.pid = 4242;
  processRef.setTimeout = (callback, delay) => {
    events.push(`deadline:${delay}`);
    deadlineCallback = callback;
    return { callback };
  };
  processRef.clearTimeout = () => events.push('clear_deadline');
  processRef.kill = (pid, signal) => events.push(`signal:${pid}:${signal}`);
  return { events, processRef, get deadlineCallback() { return deadlineCallback; } };
}

test('shutdown relays SIGTERM only after Socket.IO and application cleanup finish', async () => {
  const harness = createHarness();
  const io = { close(callback) { harness.events.push('io_close'); callback(); } };
  const cleanup = async () => { harness.events.push('cleanup_start'); await Promise.resolve(); harness.events.push('cleanup_done'); };

  installGracefulShutdown({ io, cleanup, processRef: harness.processRef });
  assert.equal(harness.processRef.listenerCount('SIGTERM'), 1);
  harness.processRef.emit('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(harness.events, [
    'deadline:25000', 'io_close', 'cleanup_start', 'cleanup_done',
    'clear_deadline', 'signal:4242:SIGTERM',
  ]);
});

test('shutdown still relays the signal when cleanup rejects', async () => {
  const harness = createHarness();
  const failures = [];
  const handler = createGracefulShutdownHandler({
    cleanup: async () => { throw new Error('cleanup failed'); },
    onError: (stage) => failures.push(stage),
    processRef: harness.processRef,
  });

  await handler('SIGINT');
  assert.deepEqual(failures, ['cleanup']);
  assert.equal(harness.events.at(-1), 'signal:4242:SIGINT');
});

test('hard deadline relays the signal when a socket close callback never arrives', () => {
  const harness = createHarness();
  const handler = createGracefulShutdownHandler({
    io: { close() {} },
    cleanup: () => harness.events.push('cleanup'),
    processRef: harness.processRef,
  });

  void handler('SIGTERM');
  harness.deadlineCallback();
  assert.equal(harness.events.at(-1), 'signal:4242:SIGTERM');
});

test('shutdown deadline fits within the Compose app stop grace period', () => {
  assert.equal(DEFAULT_SHUTDOWN_TIMEOUT_MS, 25000);
});
