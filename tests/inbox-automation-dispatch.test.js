'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dispatch } = require('../helper/inbox/automation-dispatch');

function harness(overrides = {}) {
  const calls = [];
  return {
    calls,
    input: {
      uid: 'business-a', message: { route: 'INCOMING', msg: 'Apply' }, user: { uid: 'business-a' },
      sessionId: 'qr-session', configuredSessionId: 'external-channel', origin: 'qr', chatId: 'chat-a', db: {},
      reconcileConversation: async () => ({ routed: false }),
      processWebhook: async () => calls.push('legacy-flow'),
      runConfiguredBot: async () => ({ handled: false }),
      processAutomation: async payload => calls.push(['legacy-automation', payload.sessionId]),
      notifyBotSent: async () => calls.push('notify'),
      logger: { warn: (...args) => calls.push(['warning', ...args]) },
      ...overrides,
    },
  };
}

test('keyword-routed incoming QR enquiries wait for the assigned human without bot or flow replies', async () => {
  const h = harness({ reconcileConversation: async (_db, scope) => {
    assert.deepEqual(scope, { uid: 'business-a', chatId: 'chat-a' });
    return { routed: true, agentId: 9 };
  }});
  const result = await dispatch(h.input);
  assert.equal(result.routed, true);
  assert.deepEqual(h.calls, []);
});

test('unrouted messages preserve legacy flow and automation behavior with the original session id', async () => {
  const h = harness();
  const result = await dispatch(h.input);
  assert.equal(result.routed, false);
  assert.deepEqual(h.calls, ['legacy-flow', ['legacy-automation', 'qr-session']]);
});

test('opening-route reconciliation runs only for incoming QR and Meta messages', async () => {
  for (const input of [
    { origin: 'qr', message: { route: 'OUTGOING' } },
    { origin: 'telegram', message: { route: 'INCOMING' } },
    { origin: 'meta', message: { route: 'OUTGOING' } },
  ]) {
    let reconciled = false;
    const h = harness({ ...input, reconcileConversation: async () => { reconciled = true; return { routed: true }; } });
    await dispatch(h.input);
    assert.equal(reconciled, false);
    assert.ok(h.calls.includes('legacy-flow'));
  }
});

test('reconciliation failure preserves existing automated behavior and logs only a safe code', async () => {
  const h = harness({ reconcileConversation: async () => { throw Object.assign(new Error('private message text'), { code: 'DB_UNAVAILABLE' }); } });
  await dispatch(h.input);
  assert.ok(h.calls.includes('legacy-flow'));
  assert.ok(h.calls.some(call => Array.isArray(call) && call[0] === 'warning' && call.includes('DB_UNAVAILABLE')));
  assert.ok(!JSON.stringify(h.calls).includes('private message text'));
});

test('a handled configured bot suppresses duplicate legacy automation but keeps flow hooks', async () => {
  const h = harness({ runConfiguredBot: async options => {
    assert.equal(options.sessionId, 'external-channel');
    return { handled: true, sent: true };
  }});
  await dispatch(h.input);
  assert.ok(h.calls.includes('legacy-flow'));
  assert.ok(h.calls.includes('notify'));
  assert.equal(h.calls.some(call => Array.isArray(call) && call[0] === 'legacy-automation'), false);
});

test('configured bot failure logs a safe code and falls back to the legacy automation', async () => {
  const h = harness({ runConfiguredBot: async () => { throw Object.assign(new Error('private message text'), { code: 'BOT_SCHEMA_UNAVAILABLE' }); } });
  await dispatch(h.input);
  assert.ok(h.calls.some(call => Array.isArray(call) && call[0] === 'legacy-automation'));
  assert.ok(!JSON.stringify(h.calls).includes('private message text'));
});
