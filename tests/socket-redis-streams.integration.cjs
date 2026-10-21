'use strict';

// Explicit opt-in only. Point this at a disposable local Redis instance; each
// Each run uses a random stream/channel/session namespace and synthetic ID.
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');
const { configureSocketRedisStreams } = require('../modules/platform/socket-redis-streams');
const { joinAccountRooms, emitToAccount } = require('../modules/platform/socket-account-rooms');

const syntheticUid = 'integration-only-owner';
const signalValue = 'cross-process-room-delivery';

async function worker() {
  const port = Number(process.env.SOCKET_IO_TEST_PORT);
  const server = http.createServer((request, response) => {
    if (request.url === '/emit') {
      emitToAccount(io, syntheticUid, 'integration_probe', { value: signalValue });
      response.writeHead(204).end();
      return;
    }
    response.writeHead(404).end();
  });
  const io = new Server(server, { connectionStateRecovery: { maxDisconnectionDuration: 30000, skipMiddlewares: false } });
  const adapter = configureSocketRedisStreams(io, process.env);
  io.on('connection', async (socket) => {
    await joinAccountRooms(socket, { uid: syntheticUid, isAgent: false });
    socket.emit('integration_joined');
  });
  await adapter.ready;
  server.listen(port, '127.0.0.1', () => process.stdout.write(`READY:${port}\n`));
  const close = async () => {
    await new Promise(resolve => io.close(resolve));
    await adapter.close().catch(() => {});
  };
  process.once('SIGTERM', () => close().finally(() => process.exit(0)));
  process.once('SIGINT', () => close().finally(() => process.exit(0)));
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitReady(child, port) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`SOCKET_IO_WORKER_START_TIMEOUT_${port}`)), 20000);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.includes(`READY:${port}`)) { clearTimeout(timeout); resolve(); }
    });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`SOCKET_IO_WORKER_EXIT_${port}_${code}_${output.slice(-300)}`)); });
  });
}

async function main() {
  if (process.argv[2] === '--worker') return worker();
  if (process.env.SOCKET_IO_CLUSTER_TEST_TARGET !== 'local-disposable') throw new Error('SET_SOCKET_IO_CLUSTER_TEST_TARGET_TO_LOCAL_DISPOSABLE');
  const redisUrl = String(process.env.SOCKET_IO_REDIS_URL || '');
  const parsed = new URL(redisUrl);
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname)) throw new Error('SOCKET_IO_CLUSTER_TEST_REDIS_MUST_BE_LOCAL');

  const namespace = `test-${require('node:crypto').randomBytes(8).toString('hex')}`;
  const ports = [await reservePort(), await reservePort()];
  const children = [];
  let client;
  try {
    for (const port of ports) {
      const child = spawn(process.execPath, [__filename, '--worker'], {
        env: { ...process.env, SOCKET_IO_CLUSTER_REQUIRED: 'true', SOCKET_IO_REDIS_NAMESPACE: namespace, SOCKET_IO_TEST_PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.push(child);
      await waitReady(child, port);
    }

    client = connect(`http://127.0.0.1:${ports[0]}`, { transports: ['websocket'], reconnection: false, timeout: 10000 });
    const connected = new Promise((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    const joined = new Promise((resolve, reject) => {
      client.once('integration_joined', resolve);
      setTimeout(() => reject(new Error('SOCKET_IO_TEST_ROOM_JOIN_TIMEOUT')), 5000);
    });
    await Promise.all([connected, joined]);

    const delivery = new Promise((resolve, reject) => {
      client.once('integration_probe', payload => payload?.value === signalValue ? resolve() : reject(new Error('SOCKET_IO_TEST_PAYLOAD_MISMATCH')));
      setTimeout(() => reject(new Error('SOCKET_IO_CROSS_PROCESS_BROADCAST_TIMEOUT')), 5000);
    });
    const response = await fetch(`http://127.0.0.1:${ports[1]}/emit`);
    if (response.status !== 204) throw new Error(`SOCKET_IO_EMIT_FIXTURE_STATUS_${response.status}`);
    await delivery;
    console.log(JSON.stringify({ workers: 2, accountRoomBroadcastDeliveredAcrossProcesses: true, namespaceIsolated: true }));
  } finally {
    client?.close();
    for (const child of children) child.kill('SIGTERM');
    await Promise.all(children.map(child => new Promise(resolve => child.once('exit', resolve))));
  }
}

main().catch(error => {
  console.error('Socket.IO Redis Streams integration failed:', error.code || error.message);
  process.exitCode = 1;
});
