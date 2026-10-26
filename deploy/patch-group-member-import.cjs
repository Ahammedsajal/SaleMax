'use strict';
const fs = require('node:fs'), path = require('node:path');
const file = path.join(process.argv[2] || '/app', 'client/public/index.html');
const html = fs.readFileSync(file, 'utf8'), before = '/inbox-groups.js?v=20261026-native-groups10';
if (html.split(before).length !== 2) throw Error('UNEXPECTED_INBOX_GROUP_HOOK_REFERENCE');
fs.writeFileSync(file, html.replace(before, '/inbox-groups.js?v=20261026-native-groups11'));
