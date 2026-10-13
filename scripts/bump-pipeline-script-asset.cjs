'use strict';

const fs=require('node:fs');
const file=process.argv[2];
if(!file){process.stderr.write('Usage: node scripts/bump-pipeline-script-asset.cjs <pipeline-index.html>\n');process.exit(2);}
const source=fs.readFileSync(file,'utf8'),pattern=/(pipeline\/pipeline\.js\?v=)([^'"\s]+)/g,matches=[...source.matchAll(pattern)];
if(matches.length!==1)throw new Error(`Expected one pipeline script reference, found ${matches.length}`);
const target='20261012-explicit-field-labels1';
if(matches[0][2]===target)process.exit(0);
fs.writeFileSync(file,source.replace(pattern,`$1${target}`),'utf8');
