'use strict';

function configureSocketRedisStreams(io, env = process.env, injectedDependencies = null) {
  const redisUrl = String(env.SOCKET_IO_REDIS_URL || '').trim();
  const namespace = String(env.SOCKET_IO_REDIS_NAMESPACE || '7network');
  if (!/^[a-z0-9:_-]{1,48}$/i.test(namespace)) {
    throw Object.assign(new Error('SOCKET_IO_REDIS_NAMESPACE_INVALID'), { code: 'SOCKET_IO_REDIS_NAMESPACE_INVALID' });
  }
  if (!redisUrl) {
    if (env.SOCKET_IO_CLUSTER_REQUIRED === 'true') {
      throw Object.assign(new Error('SOCKET_IO_REDIS_URL_REQUIRED'), { code: 'SOCKET_IO_REDIS_URL_REQUIRED' });
    }
    return { ready: Promise.resolve(), close: async () => {}, enabled: false };
  }

  const { createClient, createAdapter } = injectedDependencies || {
    ...require('redis'),
    ...require('@socket.io/redis-streams-adapter'),
  };
  const client = createClient({ url: redisUrl, socket: { connectTimeout: 5000 } });
  client.on('error', error => console.error('Socket.IO Redis Streams connection error:', error?.code || 'SOCKET_IO_REDIS_ERROR'));
  io.adapter(createAdapter(client, {
    streamName: `${namespace}:socket:events`,
    channelPrefix: `${namespace}:socket:channel:`,
    sessionKeyPrefix: `${namespace}:sio:session:`,
    maxLen: 10000,
  }));
  return {
    ready: client.connect(),
    enabled: true,
    close: async () => {
      if (!client.isOpen) return;
      try { await client.quit(); }
      catch { client.destroy(); }
    },
  };
}

module.exports = { configureSocketRedisStreams };
