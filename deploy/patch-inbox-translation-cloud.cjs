'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2] || '/app';
const file = path.join(root, 'client/public/index.html');
const before = '/inbox-translation.js?v=20261026-message-translate-toggle2';
const after = '/inbox-translation.js?v=20261026-message-translate-cloud1';
const source = fs.readFileSync(file, 'utf8');
const count = source.split(before).length - 1;
if (count !== 1) throw new Error(`INBOX_TRANSLATION_CLOUD_PATCH_MISMATCH:client/public/index.html:${count}`);
fs.writeFileSync(file, source.replace(before, after));
