'use strict';
// Repair only the shell loader; preserve every deployed feature and generated bundle.
const fs = require('node:fs');
const path = require('node:path');
const [target, source] = process.argv.slice(2);
if (!target || !source || path.resolve(target) === path.resolve(source)) throw Error('DISTINCT_ROOTS_REQUIRED');
for (const name of ['template-placeholder-contract.js', 'meta-template-samples.js', 'campaign-placeholder-mapping.js', 'template-placeholders.css']) {
  if (!fs.existsSync(path.join(target, 'client/public', name))) throw Error('MISSING_EXISTING_PLACEHOLDER_ASSET: ' + name);
}
const modulePath = 'modules/web/meta-template-samples-shell.js';
fs.copyFileSync(path.join(source, modulePath), path.join(target, modulePath));
const indexPath = path.join(target, 'client/public/index.html');
const original = fs.readFileSync(indexPath, 'utf8');
if (!/<head(?:\s[^>]*)?>/i.test(original)) throw Error('SHELL_HEAD_REQUIRED');
const { injectMetaTemplateSamplesScript } = require(path.join(source, modulePath));
fs.writeFileSync(indexPath, injectMetaTemplateSamplesScript(original));
console.log('Campaign hooks installed before React across shell entry routes; existing assets preserved.');
