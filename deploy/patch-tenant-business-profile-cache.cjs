'use strict';
const fs=require('node:fs');
const [file,sidebarFile,mountFile]=process.argv.slice(2);
if(!file)throw new Error('Usage: node patch-tenant-business-profile-cache.cjs <production-index.html> [production-training-sidebar.js] [production-mount-existing-upgrade.js]');
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
function replaceOne(filename,previous,next){
 if(!filename)return;
 let source=fs.readFileSync(filename,'utf8');
 const count=source.split(previous).length-1;
 if(count===0&&source.includes(next))return;
 if(count!==1)throw new Error(`Expected one production source anchor in ${filename}; found ${count}`);
 source=source.replace(previous,next);
 fs.writeFileSync(filename,source);
}
replaceOne(sidebarFile,"['settings','Business Settings','إعدادات الأعمال','crm-appearance']","['settings','Business Profile','ملف النشاط التجاري','crm-appearance']");
replaceOne(sidebarFile,"'Business Settings':'crm-appearance'","'Business Profile':'crm-appearance','Business Settings':'crm-appearance'");
replaceOne(mountFile,"  app.use(tenantCrmDomains.middleware(pool));\n","  app.use(tenantCrmDomains.middleware(pool));\n  app.use(require('./tenant-business-profile-shell').createTenantBusinessProfileShell({pool}));\n");
