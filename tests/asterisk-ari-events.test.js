'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const { AsteriskAriEvents, eventsUrl, safeEvent, APP_NAME } = require('../modules/platform/asterisk-ari-events');
const secrets = require('../modules/platform/asterisk-secrets');
const { createAriClient } = require('../modules/platform/asterisk-ari-client');
const { outboundAgentArgs, outboundGatewayArgs } = require('../modules/platform/asterisk-call-control');

test('ARI event WebSocket URL uses the configured ARI origin and app without query credentials', () => {
  const url = eventsUrl('https://pbx.example.com:8089/ari');
  assert.equal(url.toString(), `wss://pbx.example.com:8089/ari/events?app=${APP_NAME}&subscribeAll=false`);
  assert.equal(url.username, '');
  assert.equal(url.password, '');
});

test('ARI event parser accepts bounded event types and rejects malformed or binary frames', () => {
  assert.deepEqual(safeEvent(Buffer.from('{"type":"StasisStart","args":["inbound"]}')), { type: 'StasisStart', args: ['inbound'] });
  assert.equal(safeEvent(Buffer.from('{')), null);
  assert.equal(safeEvent(Buffer.from('{"type":"bad event"}')), null);
  assert.equal(safeEvent(Buffer.from('{"type":"StasisStart"}'), true), null);
});

test('outbound Stasis arguments accept only a scoped call, member, client type, and E.164 destination', () => {
  const callId=crypto.randomUUID(),membershipId=crypto.randomUUID();
  assert.deepEqual(outboundAgentArgs(['outbound-agent',callId,membershipId,'mobile','+97455550000']),
    {callId,membershipId,clientType:'mobile',destination:'+97455550000'});
  assert.equal(outboundAgentArgs(['outbound-agent',callId,membershipId,'mobile','55550000']),null);
  assert.deepEqual(outboundGatewayArgs(['outbound-gateway',callId]),{callId});
  assert.equal(outboundGatewayArgs(['outbound-gateway','another-call']),null);
});

test('ARI event client uses TLS validation, header authentication, singleton locking and event-only metadata', async () => {
  const oldKey = process.env.SALEMAX_PLATFORM_KEY_BASE64;
  const oldHosts = process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS;
  process.env.SALEMAX_PLATFORM_KEY_BASE64 = crypto.randomBytes(32).toString('base64');
  process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS = 'pbx.example.com';
  const credential = secrets.encrypt('test-password-that-is-long-enough');
  class FakeWebSocket extends EventEmitter {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor(url, options) { super(); this.url = url; this.options = options; this.readyState = 0; FakeWebSocket.instance = this; }
    close() { this.readyState = 3; this.emit('close'); }
  }
  const calls = [];
  let lockOwner = 11;
  const row = { ari_base_url: 'https://pbx.example.com:8089/ari', ari_username: 'salemax-events',
    credential_ciphertext: credential.ciphertext, credential_iv: credential.iv, credential_auth_tag: credential.authTag, enabled: 1, revision: 4 };
  const pool = {
    async getConnection() { return { async query(sql) { calls.push(sql); return [[sql.includes('IS_USED_LOCK') ? { connectionId: 11, lockConnectionId: lockOwner } : { connectionId: 11, acquired: 1 }]]; }, release() { calls.push('released'); } }; },
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM sx_platform_asterisk_config')) return [[row]];
      return [{ affectedRows: 1 }];
    },
  };
  let timeoutId = 0;
  const worker = new AsteriskAriEvents({ pool, WebSocketImpl: FakeWebSocket, workerId: 'test-ari-events',
    setIntervalImpl: () => 1, clearIntervalImpl() {}, setTimeoutImpl: () => ++timeoutId, clearTimeoutImpl() {}, random: () => 0.5 });
  const received = [];
  worker.on('ariEvent', event => received.push(event.type));
  try {
    assert.equal(await worker.start(), true);
    const socket = FakeWebSocket.instance;
    assert.ok(socket);
    assert.equal(new URL(socket.url).searchParams.get('app'), APP_NAME);
    assert.equal(socket.options.rejectUnauthorized, true);
    assert.equal(socket.options.headers.Authorization, `Basic ${Buffer.from('salemax-events:test-password-that-is-long-enough').toString('base64')}`);
    assert.equal(socket.url.includes('test-password'), false);
    socket.readyState = 1;
    socket.emit('open');
    socket.emit('message', Buffer.from('{"type":"StasisStart","args":["inbound"]}'), false);
    assert.deepEqual(received, ['StasisStart']);
    assert.ok(calls.some(call => typeof call === 'object' && call.sql.includes('events_received=events_received+1')));
    assert.ok(calls.some(call => typeof call === 'object' && call.sql.includes('INSERT INTO sx_platform_asterisk_runtime')));
    await worker.checkLock();
    lockOwner = 22;
    await worker.checkLock();
    assert.equal(worker.running, false);
    assert.equal(worker.lockLost, true);
  } finally {
    await worker.stop();
    if (oldKey === undefined) delete process.env.SALEMAX_PLATFORM_KEY_BASE64; else process.env.SALEMAX_PLATFORM_KEY_BASE64 = oldKey;
    if (oldHosts === undefined) delete process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS; else process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS = oldHosts;
  }
});

test('ARI call client restricts originated endpoints, app arguments, and transport destinations', async () => {
  const oldKey = process.env.SALEMAX_PLATFORM_KEY_BASE64;
  const oldHosts = process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS;
  process.env.SALEMAX_PLATFORM_KEY_BASE64 = crypto.randomBytes(32).toString('base64');
  process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS = 'pbx.example.com';
  const credential = secrets.encrypt('test-password-that-is-long-enough');
  const requests = [];
  let currentRevision = 4;
  const client = createAriClient({ ari_base_url: 'https://pbx.example.com:8089/ari', ari_username: 'salemax-events',
    credential_ciphertext: credential.ciphertext, credential_iv: credential.iv, credential_auth_tag: credential.authTag, enabled: 1, revision: currentRevision }, {
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      return { ok: true, status: 200, async text() { return JSON.stringify({ id: new URL(url).searchParams.get('channelId'), name: 'PJSIP/1201-00000001' }); } };
    },
    pool: { async query() { return [[{ enabled: 1, revision: currentRevision }]]; } },
  });
  try {
    const callChannelId = crypto.randomUUID();
    const agent = await client.originateAgent({ extension: '1201', clientType: 'mobile', channelId: callChannelId, appArgs: ['outbound-agent', callChannelId] });
    assert.equal(agent.id, callChannelId);
    const agentRequest = requests[0];
    assert.equal(agentRequest.url.pathname, '/ari/channels');
    assert.equal(agentRequest.url.searchParams.get('endpoint'), 'PJSIP/salemax-1201-mobile');
    assert.equal(agentRequest.url.searchParams.get('app'), APP_NAME);
    assert.equal(agentRequest.options.headers.Authorization, `Basic ${Buffer.from('salemax-events:test-password-that-is-long-enough').toString('base64')}`);
    assert.equal(agentRequest.options.redirect, 'error');

    const gatewayChannelId = crypto.randomUUID();
    await client.originateGateway({ destination: '+97455550000', channelNo: 3, channelId: gatewayChannelId, appArgs: ['outbound-gateway', gatewayChannelId] });
    assert.equal(requests[1].url.searchParams.get('endpoint'), 'PJSIP/9903+97455550000@salemax_dinstar_uc2000ve');
    await assert.rejects(client.originateAgent({ extension: '1201@evil', clientType: 'mobile', channelId: crypto.randomUUID(), appArgs: [] }), { code: 'INVALID_ARI_ORIGINATE' });
    await assert.rejects(client.originateGateway({ destination: '+97455550000', channelNo: 5, channelId: crypto.randomUUID(), appArgs: [] }), { code: 'INVALID_ARI_ORIGINATE' });
    await assert.rejects(client.originateAgent({ extension: '1201', clientType: 'mobile', channelId: crypto.randomUUID(), appArgs: ['bad,arg'] }), { code: 'INVALID_ARI_APP_ARGS' });
    currentRevision++;
    const requestCount = requests.length;
    await assert.rejects(client.answer(agent.id), { code: 'ASTERISK_CONFIG_CHANGED' });
    assert.equal(requests.length, requestCount);
  } finally {
    if (oldKey === undefined) delete process.env.SALEMAX_PLATFORM_KEY_BASE64; else process.env.SALEMAX_PLATFORM_KEY_BASE64 = oldKey;
    if (oldHosts === undefined) delete process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS; else process.env.SALEMAX_ASTERISK_ALLOWED_HOSTS = oldHosts;
  }
});
