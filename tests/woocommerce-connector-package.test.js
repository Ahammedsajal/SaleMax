'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {test} = require('node:test');
const {crc32, zipArchive, buildConnectorArchive} = require('../modules/platform/woocommerce-connector-package');

test('WooCommerce connector package is a deterministic ZIP containing tracked source', () => {
  const first = buildConnectorArchive();
  const second = buildConnectorArchive();
  assert.deepEqual(first, second);
  assert.equal(first.readUInt32LE(0), 0x04034b50);
  assert.equal(first.readUInt32LE(first.length - 22), 0x06054b50);
  const filenameLength = first.readUInt16LE(26);
  const payloadLength = first.readUInt32LE(22);
  const name = first.subarray(30, 30 + filenameLength).toString('utf8');
  const payload = first.subarray(30 + filenameLength, 30 + filenameLength + payloadLength);
  assert.equal(name, '7network-retail-connector/7network-connector.php');
  assert.equal(first.readUInt32LE(14), crc32(payload));
  assert.match(payload.toString('utf8'), /Plugin Name: 7Network Retail Connector/);
  assert.match(payload.toString('utf8'), /woocommerce_after_order_notes/);
  assert.doesNotMatch(payload.toString('utf8'), /woocommerce_blocks_checkout_order_processed/);
  const readme = fs.readFileSync(path.resolve(__dirname, '../integrations/woocommerce/7network-retail-connector/README.txt'), 'utf8');
  assert.match(readme, /Checkout Blocks are not supported/);
});

test('ZIP builder rejects unsafe paths and writes a valid entry checksum', () => {
  assert.throws(() => zipArchive([{name: '../escape.php', data: 'x'}]), /INVALID_ZIP_PATH/);
  assert.throws(() => zipArchive([{name: 'folder\\escape.php', data: 'x'}]), /INVALID_ZIP_PATH/);
  const archive = zipArchive([{name: 'safe.txt', data: Buffer.from('hello')}]);
  assert.equal(archive.readUInt32LE(14), crc32(Buffer.from('hello')));
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
});
