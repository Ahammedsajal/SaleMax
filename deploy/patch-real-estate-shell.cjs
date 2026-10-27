'use strict';
const fs=require('node:fs');
const file=process.argv[2];
if(!file)throw Error('SHELL_PATH_REQUIRED');
let source=fs.readFileSync(file,'utf8');
for(const [before,after] of [
  ['training-sidebar.js?v=20261026-mobile-lifecycle1','training-sidebar.js?v=20261027-real-estate1'],
  ['pipeline-entry.js?v=20261026-mobile-dashboard-frame1','pipeline-entry.js?v=20261027-real-estate1'],
]){
  if(source.includes(after))continue;
  if(!source.includes(before)||source.indexOf(before)!==source.lastIndexOf(before))throw Error(`REAL_ESTATE_SHELL_ANCHOR:${before}`);
  source=source.replace(before,after);
}
fs.writeFileSync(file,source);
