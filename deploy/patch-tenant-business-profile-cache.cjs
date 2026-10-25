'use strict';
const fs=require('node:fs');
const file=process.argv[2];
if(!file)throw new Error('Usage: node patch-tenant-business-profile-cache.cjs <client/public/index.html>');
let html=fs.readFileSync(file,'utf8');
const changes=[
 ['/training-sidebar.js?v=20261025-sales-business-settings-crm-appearance1','/training-sidebar.js?v=20270103-business-profile1'],
 ['/tenant-crm-appearance.js?v=20270102-admin-domains1','/tenant-crm-appearance.js?v=20270103-business-profile1']
];
for(const [previous,next] of changes){
 const count=html.split(previous).length-1;
 if(count===0&&html.includes(next))continue;
 if(count!==1)throw new Error(`Expected one cache reference for ${previous}; found ${count}`);
 html=html.replace(previous,next);
}
fs.writeFileSync(file,html);
