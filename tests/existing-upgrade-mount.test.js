'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const test = require('node:test');
const { mountConfiguredUpgrade } = require('../modules/platform/mount-existing-upgrade');

test('existing plan, contract and staff routes fail closed while the upgrade is disabled', async t => {
  const previous = process.env.SALEMAX_PLATFORM_ENABLED;
  process.env.SALEMAX_PLATFORM_ENABLED = 'false';
  t.after(() => {
    if (previous === undefined) delete process.env.SALEMAX_PLATFORM_ENABLED;
    else process.env.SALEMAX_PLATFORM_ENABLED = previous;
  });

  const app = express();
  assert.equal(mountConfiguredUpgrade(app), false);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));

  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const route of [
    '/api/admin/platform-auth/me',
    '/api/admin/plan-contracts/context',
    '/api/admin/business-contracts/1/context',
    '/api/admin/business-contracts/1/provision-options',
    '/api/admin/business-contracts/1/provision-preview',
    '/api/admin/business-contracts/1/provision',
    '/api/admin/platform-access/staff',
    '/api/admin/staff-invitations/accept',
    '/api/user/business-auth/me',
    '/api/user/training/tasks',
    '/api/user/training/finance-policies/current',
  ]) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 503, route);
    assert.deepEqual(await response.json(), { code: 'PLATFORM_UPGRADE_NOT_ENABLED' }, route);
  }
});
