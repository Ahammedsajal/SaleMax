'use strict';

const fs = require('node:fs');
const path = require('node:path');

const file = path.resolve(process.argv[2] || 'client/public/index.html');
const before = fs.readFileSync(file, 'utf8');
const nextVersion = '20261026-sidebar-visible-labels2';
const refs = [...before.matchAll(/(\/training-sidebar\.js\?v=)([A-Za-z0-9_-]+)/g)];

if (refs.length !== 1) throw new Error(`Expected one training-sidebar asset reference; found ${refs.length}`);
if (refs[0][2] === nextVersion) process.exit(0);

const ref = refs[0];
const after = before.slice(0, ref.index) + ref[1] + nextVersion + before.slice(ref.index + ref[0].length);
fs.writeFileSync(file, after);
