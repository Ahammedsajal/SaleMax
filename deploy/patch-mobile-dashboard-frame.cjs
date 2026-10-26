'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2] || '/app';
const file = path.join(root, 'client/public/index.html');
const version = '20261026-mobile-dashboard-frame1';
const html = fs.readFileSync(file, 'utf8');
const matches = [...html.matchAll(/pipeline-entry\.js\?v=[^"'\s]+/g)];
if (matches.length !== 1) throw new Error('EXPECTED_ONE_PIPELINE_ENTRY_CACHE_REFERENCE');
const updated = html.replace(matches[0][0], 'pipeline-entry.js?v=' + version);
fs.writeFileSync(file, updated);
