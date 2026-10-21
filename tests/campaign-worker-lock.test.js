'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { campaignLockName, acquireCampaignWorkerLock } = require('../modules/platform/campaign-worker-lock');

function fakePool() {
  const locks = new Map();
  let nextConnectionId = 100;
  return {
    locks,
    async getConnection() {
      const id = nextConnectionId++;
      let released = false;
      return {
        async query(sql, args = []) {
          if (released) throw Object.assign(new Error('connection released'), { code: 'CONNECTION_RELEASED' });
          const name = args[0];
          if (sql.includes('GET_LOCK')) {
            if (locks.has(name)) return [[{ acquired: 0 }], []];
            locks.set(name, id);
            return [[{ acquired: 1 }], []];
          }
          if (sql.includes('CONNECTION_ID')) return [[{ connectionId: id }], []];
          if (sql.includes('IS_USED_LOCK')) return [[{ ownerConnectionId: locks.get(name) ?? null }], []];
          if (sql.includes('RELEASE_LOCK')) {
            const owned = locks.get(name) === id;
            if (owned) locks.delete(name);
            return [[{ released: owned ? 1 : 0 }], []];
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() { released = true; },
        destroy() { released = true; for (const [name, owner] of locks) if (owner === id) locks.delete(name); },
      };
    },
  };
}

test('campaign lock names are tenant-specific, opaque, and within MariaDB limits', () => {
  const a = campaignLockName('owner-a', 'campaign-1');
  const b = campaignLockName('owner-b', 'campaign-1');
  assert.notEqual(a, b);
  assert.doesNotMatch(a, /owner-a|campaign-1/);
  assert.ok(a.length <= 64);
});

test('independent sessions cannot acquire the same tenant campaign lock concurrently', async () => {
  const pool = fakePool();
  const first = await acquireCampaignWorkerLock(pool, 'owner-a', 'campaign-1');
  assert.ok(first);
  await first.assertHeld();
  assert.equal(await acquireCampaignWorkerLock(pool, 'owner-a', 'campaign-1'), null);
  const otherTenant = await acquireCampaignWorkerLock(pool, 'owner-b', 'campaign-1');
  assert.ok(otherTenant);
  await otherTenant.assertHeld();
  await first.release();
  const replacement = await acquireCampaignWorkerLock(pool, 'owner-a', 'campaign-1');
  assert.ok(replacement);
  await Promise.all([otherTenant.release(), replacement.release()]);
});

test('worker stops when its database session no longer owns the campaign lock', async () => {
  const pool = fakePool();
  const lease = await acquireCampaignWorkerLock(pool, 'owner-a', 'campaign-1');
  pool.locks.delete(lease.name);
  await assert.rejects(lease.assertHeld(), { code: 'CAMPAIGN_LOCK_LOST' });
  await lease.release();
});

test('campaign lock fails closed when owner identity is absent', async () => {
  const pool = fakePool();
  await assert.rejects(acquireCampaignWorkerLock(pool, '', 'campaign-1'), { code: 'CAMPAIGN_OWNER_REQUIRED' });
});
