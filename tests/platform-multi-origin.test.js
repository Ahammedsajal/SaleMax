'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const originPolicy = require('../modules/platform/request-origin');

test('platform writes accept only the canonical host and explicitly allowed host', () => {
  const previous = process.env.SALEMAX_PLATFORM_ALLOWED_ORIGINS;
  process.env.SALEMAX_PLATFORM_ALLOWED_ORIGINS = 'https://crm.salemax.qa,https://www.7network.live';
  const request = value => ({ get: name => name === 'Origin' ? value : undefined });
  try {
    assert.equal(originPolicy.matches(request('https://7network.live'), 'https://7network.live'), true);
    assert.equal(originPolicy.matches(request('https://crm.salemax.qa'), 'https://7network.live'), true);
    assert.equal(originPolicy.matches(request('https://www.7network.live'), 'https://7network.live'), true);
    assert.equal(originPolicy.matches(request('https://evil.invalid'), 'https://7network.live'), false);
    assert.equal(originPolicy.matches(request('http://crm.salemax.qa'), 'https://7network.live'), false);
    assert.equal(originPolicy.matches({ crmTenantDomain: { hostname: 'tenant.example' }, ...request('https://crm.salemax.qa') }, 'https://7network.live'), false);
    assert.equal(originPolicy.matches({ crmTenantDomain: { hostname: 'tenant.example' }, ...request('https://tenant.example') }, 'https://7network.live'), true);
  } finally {
    if (previous === undefined) delete process.env.SALEMAX_PLATFORM_ALLOWED_ORIGINS;
    else process.env.SALEMAX_PLATFORM_ALLOWED_ORIGINS = previous;
  }
});

test('public-site hostname matching recognizes both app domains without accepting lookalikes', () => {
  const previous = process.env.SALEMAX_PLATFORM_ALLOWED_ORIGINS;
  process.env.SALEMAX_PLATFORM_ALLOWED_ORIGINS = 'https://crm.salemax.qa,https://www.7network.live';
  try {
    assert.equal(originPolicy.matchesPlatformHost({ hostname: '7network.live' }, 'https://7network.live'), true);
    assert.equal(originPolicy.matchesPlatformHost({ hostname: 'crm.salemax.qa' }, 'https://7network.live'), true);
    assert.equal(originPolicy.matchesPlatformHost({ hostname: 'www.7network.live' }, 'https://7network.live'), true);
    assert.equal(originPolicy.matchesPlatformHost({ hostname: '7network.live.evil.invalid' }, 'https://7network.live'), false);
  } finally {
    if (previous === undefined) delete process.env.SALEMAX_PLATFORM_ALLOWED_ORIGINS;
    else process.env.SALEMAX_PLATFORM_ALLOWED_ORIGINS = previous;
  }
});
