'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runWithTurnLock } = require('../modules/platform/chatbot-turn-lock');

test('serializes one follow-up and hands off when more messages arrive during a burst', async () => {
  let held = false;
  const pool = { async getConnection() { return {
    async query(sql) {
      if (sql.includes('GET_LOCK')) {
        if (held) return [[{ acquired: 0 }]];
        held = true; return [[{ acquired: 1 }]];
      }
      if (sql.includes('RELEASE_LOCK')) { held = false; return [[{ released: 1 }]]; }
      throw new Error(`Unexpected SQL: ${sql}`);
    }, release() {},
  }; } };
  const args = { pool, uid: 'owner', origin: 'meta', channelRef: 'number', chatId: 'chat' };
  let releaseFirst;
  let overflowHandoffs = 0;
  const first = runWithTurnLock(args, () => new Promise(resolve => { releaseFirst = resolve; }));
  while (!releaseFirst) await new Promise(resolve => setImmediate(resolve));
  const second = runWithTurnLock(args, async () => 'one-follow-up', { onOverflow: async () => { overflowHandoffs++; } });
  await new Promise(resolve => setImmediate(resolve));
  const third = await runWithTurnLock(args, async () => 'must-not-run', { onOverflow: async () => { overflowHandoffs++; } });
  assert.equal(third.acquired, false);
  assert.equal(third.overflowed, true);
  releaseFirst('opening');
  assert.deepEqual(await first, { acquired: true, value: 'opening' });
  assert.deepEqual(await second, { acquired: true, value: 'one-follow-up' });
  assert.equal(overflowHandoffs, 1);
});
