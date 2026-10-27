'use strict';

const fs = require('node:fs');
const path = require('node:path');

const target = process.argv[2] || '/opt/salemax/current/client/public/index.html';
const oldTag = '<script defer src="/tenant-storefront-settings.js?v=20261026-single-tenant-storefront1"></script>';
const newTag = '<script defer src="/tenant-storefront-settings.js?v=20261027-platform-url1"></script>';
const source = fs.readFileSync(target, 'utf8');
if (source.includes(newTag)) process.exit(0);
if (source.split(oldTag).length !== 2) {
  throw new Error('Expected exactly one current tenant storefront editor script tag');
}

const temporary = `${target}.${process.pid}.tmp`;
try {
  fs.writeFileSync(temporary, source.replace(oldTag, newTag), { mode: fs.statSync(target).mode });
  fs.renameSync(temporary, target);
} finally {
  try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
