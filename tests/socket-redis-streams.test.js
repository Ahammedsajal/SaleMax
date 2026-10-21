'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { configureSocketRedisStreams } = require('../modules/platform/socket-redis-streams');

test('cluster adapter remains optional for the existing single-process topology', async () => {
  const adapter = configureSocketRedisStreams({ adapter() {} }, {});
  assert.equal(adapter.enabled, false);
  await adapter.ready;
  await adapter.close();
});

test('an explicitly clustered process refuses to start without its shared adapter URL', () => {
  assert.throws(
    () => configureSocketRedisStreams({ adapter() {} }, { SOCKET_IO_CLUSTER_REQUIRED: 'true' }),
    { code: 'SOCKET_IO_REDIS_URL_REQUIRED' },
  );
});

test('Redis adapter namespaces reject unsafe or oversized identifiers before connecting', () => {
  assert.throws(
    () => configureSocketRedisStreams({ adapter() {} }, { SOCKET_IO_REDIS_NAMESPACE: 'invalid namespace' }),
    { code: 'SOCKET_IO_REDIS_NAMESPACE_INVALID' },
  );
  assert.throws(
    () => configureSocketRedisStreams({ adapter() {} }, { SOCKET_IO_REDIS_NAMESPACE: 'x'.repeat(49) }),
    { code: 'SOCKET_IO_REDIS_NAMESPACE_INVALID' },
  );
});

test('cluster mode installs the namespaced recovery-capable stream adapter before readiness', async () => {
  const calls = [];
  const client = new EventEmitter();
  client.isOpen = true;
  client.connect = async () => { calls.push('connected'); };
  client.quit = async () => { calls.push('closed'); client.isOpen = false; };
  const io = { adapter(adapter) { calls.push(adapter); } };
  const adapter = configureSocketRedisStreams(io, {
    SOCKET_IO_REDIS_URL: 'redis://redis-user:test-secret@127.0.0.1:6379/4',
    SOCKET_IO_REDIS_NAMESPACE: 'crm-test-a91c',
    SOCKET_IO_CLUSTER_REQUIRED: 'true',
  }, {
    createClient(options) { calls.push(options); return client; },
    createAdapter(redisClient, options) { calls.push(options); return { redisClient }; },
  });
  await adapter.ready;
  assert.equal(adapter.enabled, true);
  assert.deepEqual(calls[1], {
    streamName: 'crm-test-a91c:socket:events',
    channelPrefix: 'crm-test-a91c:socket:channel:',
    sessionKeyPrefix: 'crm-test-a91c:sio:session:',
    maxLen: 10000,
  });
  assert.ok(calls.indexOf('connected') > 0);
  await adapter.close();
  assert.ok(!calls.some(value => typeof value === 'string' && value.includes('test-secret')));
});
