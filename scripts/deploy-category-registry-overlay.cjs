'use strict';
// Run against a COPY of the currently resolved release. Never rebuild the
// generated frontend or substitute an older local application tree.
const fs=require('node:fs'),path=require('node:path');
const [target,source]=process.argv.slice(2);
if(!target||!source||path.resolve(target)===path.resolve(source))throw Error('DISTINCT_TARGET_AND_SOURCE_REQUIRED');
const files=['modules/platform/category-registry.js','modules/platform/categories.js','modules/platform/business-provisioning.js','modules/platform/catalogue-bridge.js','modules/platform/existing-business-router.js','modules/platform/existing-catalogue-router.js','client/public/admin-plan-contracts.js','client/public/admin-user-plans.js'];
const index=path.join(target,'client/public/index.html');let html=fs.readFileSync(index,'utf8');
for(const name of ['admin-plan-contracts.js','admin-user-plans.js']){
 const pattern=new RegExp('/'+name.replaceAll('.','\\.')+'(?:\\?[^"\\s<>]+)?','g');
 if((html.match(pattern)||[]).length!==1)throw Error('AMBIGUOUS_LOADER:'+name);
 html=html.replace(pattern,'/'+name+'?v=20261020-category-registry1');
}
for(const file of files){const destination=path.join(target,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(source,file),destination);}
fs.writeFileSync(index,html);
console.log(JSON.stringify({runtimeFiles:[...files,'client/public/index.html'],migrations:[],generatedShell:'preserved except two reviewed cache references'}));
