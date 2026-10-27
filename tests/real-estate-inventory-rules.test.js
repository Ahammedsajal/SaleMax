'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../modules/platform/real-estate-inventory-rules');

test('unit availability removes an active listing from marketing', () => {
  assert.equal(rules.listingStateForUnit('available', 'active'), 'active');
  assert.equal(rules.listingStateForUnit('reserved', 'active'), 'reserved');
  assert.equal(rules.listingStateForUnit('rented', 'active'), 'rented');
  assert.equal(rules.listingStateForUnit('rented', 'reserved'), 'rented');
  assert.equal(rules.listingStateForUnit('unavailable', 'active'), 'paused');
});

test('unit changes do not reactivate or overwrite independently paused listings', () => {
  for (const unit of ['available', 'reserved', 'rented', 'unavailable']) {
    for (const listing of ['draft', 'review', 'paused', 'withdrawn', 'expired']) {
      assert.equal(rules.listingStateForUnit(unit, listing), listing);
    }
  }
});

test('activation is denied when the physical unit is not available', () => {
  assert.doesNotThrow(() => rules.assertListingCanActivate('available'));
  for (const state of ['reserved', 'rented', 'unavailable']) {
    assert.throws(() => rules.assertListingCanActivate(state), { code: 'UNIT_NOT_AVAILABLE' });
  }
  assert.throws(() => rules.assertListingCanActivate('invalid'), { code: 'INVALID_UNIT_STATUS' });
});
