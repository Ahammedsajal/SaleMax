const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('provider-disabled public hosting still requires secure platform authentication', () => {
  const names = ['SALEMAX_PLATFORM_ENABLED', 'SALEMAX_PLATFORM_KEY_BASE64', 'SALEMAX_PLATFORM_ORIGIN', 'LOCAL_ONLY_MODE'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const configPath = require.resolve('../database/config');
  const previousConfig = require.cache[configPath];
  require.cache[configPath] = { id: configPath, filename: configPath, loaded: true, exports: { promise: () => ({ getConnection() { assert.fail('No database access expected'); } }) } };
  try {
    process.env.SALEMAX_PLATFORM_ENABLED = 'true';
    process.env.SALEMAX_PLATFORM_KEY_BASE64 = Buffer.alloc(32, 7).toString('base64');
    process.env.LOCAL_ONLY_MODE = 'true';
    const { mountConfiguredUpgrade } = require('../modules/platform/mount-existing-upgrade');
    process.env.SALEMAX_PLATFORM_ORIGIN = 'https://crm.salemax.qa';
    assert.equal(mountConfiguredUpgrade(express()), true);
    process.env.SALEMAX_PLATFORM_ORIGIN = 'http://crm.salemax.qa';
    assert.throws(() => mountConfiguredUpgrade(express()), /AUTH_ORIGIN_INVALID/);
    process.env.SALEMAX_PLATFORM_ORIGIN = 'http://127.0.0.1:3010';
    assert.equal(mountConfiguredUpgrade(express()), true);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
  }
});
