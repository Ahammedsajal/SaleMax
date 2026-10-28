'use strict';
const fs=require('node:fs');
const file=process.argv[2];
const html=fs.readFileSync(file,'utf8');
const matches=html.match(/\/workspace-api\.js\?v=[^"\s]+/g)||[];
if(matches.length!==1)throw Error('EXPECTED_ONE_WORKSPACE_CLIENT');
fs.writeFileSync(file,html.replace(matches[0],'/workspace-api.js?v=20261028-session-startup1'));
