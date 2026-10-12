'use strict';

const fs=require('node:fs');
const file=process.argv[2];
if(!file){process.stderr.write('Usage: node scripts/bump-training-students-asset.cjs <training-courses.js>\n');process.exit(2);}
const source=fs.readFileSync(file,'utf8'),pattern=/training-students\.js\?v=([^'"\s]+)/g,matches=[...source.matchAll(pattern)];
if(matches.length!==1)throw new Error(`Expected one training-students script reference, found ${matches.length}`);
const target='20261012-trainer-picker1';
if(matches[0][1]===target)process.exit(0);
const updated=source.replace(pattern,`training-students.js?v=${target}`);
fs.writeFileSync(file,updated,'utf8');
