'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_API_LOG_DELETE_IDS, normalizeApiLogIds } = require('../modules/platform/api-log-ids');

test('normalizes distinct positive legacy INT log IDs', () => {
  assert.deepEqual(normalizeApiLogIds([1, '02', 2, '2147483647']), [1, 2, 2147483647]);
});

test('rejects empty, oversized, malformed, out-of-range and injected log ID lists', () => {
  assert.equal(normalizeApiLogIds([]), null);
  assert.equal(normalizeApiLogIds(Array.from({ length: MAX_API_LOG_DELETE_IDS + 1 }, (_, i) => i + 1)), null);
  for (const value of [[0], [-1], [1.5], [2147483648], ['1,2'], ['1 OR 1=1'], [null], [{}], [true]]) {
    assert.equal(normalizeApiLogIds(value), null);
  }
});
