'use strict';
// Apply only to a copied live release. Keep its generated bundle and all other
// production files, including fixes that have not reached an older checkout.
const fs=require('node:fs'),path=require('node:path');
const [target,source]=process.argv.slice(2);
if(!target||!source||path.resolve(target)===path.resolve(source))throw Error('DISTINCT_TARGET_AND_SOURCE_REQUIRED');
const files=['modules/platform/tenant-customization.js','modules/platform/tenant-customization-router.js','modules/platform/feature-contract.js','modules/platform/mount-existing-upgrade.js','client/public/tenant-customization.js','client/public/tenant-crm-appearance.js','client/public/training-sidebar.js','client/public/workspace-api.js','database/migrations/20261220_tenant_customization.sql'];
for(const file of files)if(!fs.lstatSync(path.join(source,file)).isFile())throw Error('REGULAR_SOURCE_FILE_REQUIRED:'+file);
const index=path.join(target,'client/public/index.html');let html=fs.readFileSync(index,'utf8');
if(html.includes('/tenant-customization.js'))throw Error('CUSTOMIZATION_LOADER_ALREADY_PRESENT');
const anchor=/<script[^>]+src="\/tenant-crm-appearance\.js(?:\?[^"<>]+)?"[^>]*><\/script>/g;
if((html.match(anchor)||[]).length!==1)throw Error('AMBIGUOUS_APPEARANCE_LOADER');
html=html.replace(anchor,match=>'<script defer src="/tenant-customization.js?v=20261020-config1"></script>'+match);
for(const name of ['workspace-api.js','training-sidebar.js','tenant-crm-appearance.js']){
 const pattern=new RegExp('/'+name.replaceAll('.','\\.')+'(?:\\?[^"\\s<>]+)?','g');
 if((html.match(pattern)||[]).length!==1)throw Error('AMBIGUOUS_LOADER:'+name);
 html=html.replace(pattern,'/'+name+'?v=20261020-config1');
}
for(const file of files){const destination=path.join(target,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(source,file),destination);}
fs.writeFileSync(index,html);
console.log(JSON.stringify({runtimeFiles:[...files,'client/public/index.html'],migrations:['20261220_tenant_customization.sql'],generatedShell:'preserved except reviewed customization loader references'}));
