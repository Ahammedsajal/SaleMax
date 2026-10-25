'use strict';
const fs=require('node:fs');
const file=process.argv[2];
if(!file)throw new Error('Usage: node patch-business-logo-sidebar-cache.cjs <production-index.html>');
let html=fs.readFileSync(file,'utf8');
for(const [oldRef,newRef] of [
 ['/training-sidebar.js?v=20270103-business-profile1','/training-sidebar.js?v=20270103-business-sidebar-logo1'],
 ['/tenant-crm-appearance.js?v=20270103-business-profile1','/tenant-crm-appearance.js?v=20270103-business-sidebar-logo1']
]){
 const count=html.split(oldRef).length-1;
 if(count===0&&html.includes(newRef))continue;
 if(count!==1)throw new Error(`Expected one production asset reference for ${oldRef}; found ${count}`);
 html=html.replace(oldRef,newRef);
}
fs.writeFileSync(file,html);
