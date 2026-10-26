'use strict';
const fs = require('node:fs'), path = require('node:path');
const file = path.join(process.argv[2] || '/app', 'client/public/index.html');
const html = fs.readFileSync(file, 'utf8'), matches = html.match(/\/inbox-groups\.js\?v=[^"'\s]+/g) || [];
if (matches.length !== 1) throw Error('UNEXPECTED_INBOX_GROUP_HOOK_REFERENCE');
fs.writeFileSync(file, html.replace(matches[0], '/inbox-groups.js?v=20261026-native-groups12'));
