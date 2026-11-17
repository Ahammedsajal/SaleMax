'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CRC_TABLE = Uint32Array.from({length: 256}, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipArchive(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 0xffff) throw new TypeError('INVALID_ZIP_ENTRIES');
  const localParts = [], centralParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = String(entry?.name || '');
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw new TypeError('INVALID_ZIP_PATH');
    const filename = Buffer.from(name, 'utf8'), data = Buffer.from(entry.data || []);
    if (filename.length > 0xffff || data.length > 0xffffffff) throw new RangeError('ZIP_ENTRY_TOO_LARGE');
    const checksum = crc32(data), local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, filename, data);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, filename);
    localOffset += local.length + filename.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  if (localOffset > 0xffffffff || centralDirectory.length > 0xffffffff) throw new RangeError('ZIP_ARCHIVE_TOO_LARGE');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function buildConnectorArchive(root = path.resolve(__dirname, '../../integrations/woocommerce/7network-retail-connector')) {
  const files = ['7network-connector.php', 'README.txt'];
  return zipArchive(files.map(filename => ({
    name: `7network-retail-connector/${filename}`,
    data: fs.readFileSync(path.join(root, filename)),
  })));
}

module.exports = {crc32, zipArchive, buildConnectorArchive};
