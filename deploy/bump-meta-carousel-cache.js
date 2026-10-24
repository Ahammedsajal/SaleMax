const fs = require('fs');
const path = process.argv[2];
if (!path) throw new Error('Expected the active public index.html path');
const html = fs.readFileSync(path, 'utf8');
const reference = /\/campaign-placeholder-mapping\.js\?v=[^"']+/g;
const matches = html.match(reference) || [];
if (matches.length !== 1) {
  throw new Error(`Expected one campaign mapping script reference, found ${matches.length}`);
}
const updated = html.replace(reference, '/campaign-placeholder-mapping.js?v=20261024-meta-image-upload3');
fs.writeFileSync(path, updated);
