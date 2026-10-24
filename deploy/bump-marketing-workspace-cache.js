const fs = require('node:fs');
const path = process.argv[2];
if (!path) throw new Error('Expected the active public index.html path');
let html = fs.readFileSync(path, 'utf8');
for (const [asset, version] of [
  ['marketing-workspace.css', '20261024-campaign-theme1'],
  ['marketing-workspace.js', '20261024-campaign-theme1'],
]) {
  const reference = new RegExp(`/${asset.replace('.', '\\.')}\\?v=[^"']+`, 'g');
  const matches = html.match(reference) || [];
  if (matches.length !== 1) {
    throw new Error(`Expected one ${asset} reference, found ${matches.length}`);
  }
  html = html.replace(reference, `/${asset}?v=${version}`);
}
fs.writeFileSync(path, html);
