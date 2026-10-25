'use strict';
const fs = require('node:fs');
const path = require('node:path');

const target = process.argv[2];
if (!target) throw new Error('Usage: node patch-tenant-domain-switcher-cache.cjs <client/public/index.html>');
const file = path.resolve(target);
let html = fs.readFileSync(file, 'utf8');
const previous = '/app-switcher.js?v=20261021-7network';
const next = '/app-switcher.js?v=20261025-tenant-domain1';
const count = html.split(previous).length - 1;
if (count === 0 && html.includes(next)) process.exit(0);
if (count !== 1) throw new Error(`Expected one existing app-switcher cache reference; found ${count}`);
html = html.replace(previous, next);
fs.writeFileSync(file, html);
