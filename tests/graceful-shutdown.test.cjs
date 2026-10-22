const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  createGracefulShutdownHandler,
  installGracefulShutdown,
} = require('../modules/platform/graceful-shutdown');

function createHarness() {
  const events = [];
  let handler;
  let deadlineCallback;
  const cleanupController = (registered) => { handler = registered; };
  cleanupController.uninstall = () => events.push('uninstall');
  const processRef = {
    pid: 4242,
    setTimeout(callback, delay) {
      events.push(`deadline:${delay}`);
      deadlineCallback = callback;
      return { callback };
    },
    clearTimeout() { events.push('clear_deadline'); },
    kill(pid, signal) { events.push(`signal:${pid}:${signal}`); },
  };
  return { events, cleanupController, processRef, get handler() { return handler; }, get deadlineCallback() { return deadlineCallback; } };
}

test('shutdown relays SIGTERM only after Socket.IO and application cleanup finish', async () => {
  const harness = createHarness();
  const io = { close(callback) { harness.events.push('io_close'); callback(); } };
  const cleanup = async () => { harness.events.push('cleanup_start'); await Promise.resolve(); harness.events.push('cleanup_done'); };

  installGracefulShutdown({
    io,
    cleanup,
    timeoutMs: 25000,
    processRef: harness.processRef,
    cleanupController: harness.cleanupController,
  });

  assert.equal(typeof harness.handler, 'function');
  assert.equal(harness.handler(null, 'SIGTERM'), false);
  assert.deepEqual(harness.events.slice(0, 2), ['uninstall', 'deadline:25000']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(harness.events.slice(2), [
    'io_close', 'cleanup_start', 'cleanup_done', 'clear_deadline', 'signal:4242:SIGTERM',
  ]);
});

test('shutdown still relays the signal when cleanup rejects', async () => {
  const harness = createHarness();
  const failures = [];
  const handler = createGracefulShutdownHandler({
    cleanup: async () => { throw new Error('cleanup failed'); },
    onError: (stage) => failures.push(stage),
    processRef: harness.processRef,
    cleanupController: harness.cleanupController,
  });

  assert.equal(handler(null, 'SIGINT'), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(failures, ['cleanup']);
  assert.equal(harness.events.at(-1), 'signal:4242:SIGINT');
});

test('hard deadline relays the signal when a socket close callback never arrives', () => {
  const harness = createHarness();
  const handler = createGracefulShutdownHandler({
    io: { close() {} },
    cleanup: () => harness.events.push('cleanup'),
    processRef: harness.processRef,
    cleanupController: harness.cleanupController,
  });

  assert.equal(handler(null, 'SIGTERM'), false);
  harness.deadlineCallback();
  assert.equal(harness.events.at(-1), 'signal:4242:SIGTERM');
});

test('shutdown deadline fits within the Compose app stop grace period', () => {
  assert.equal(DEFAULT_SHUTDOWN_TIMEOUT_MS, 25000);
});
