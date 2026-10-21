'use strict';
const fs=require('node:fs'),path=require('node:path');const [target,source]=process.argv.slice(2);
if(!target||!source||path.resolve(target)===path.resolve(source))throw Error('DISTINCT_TARGET_AND_SOURCE_REQUIRED');
const files=['modules/platform/categories.js','modules/platform/business-provisioning.js','modules/platform/existing-business-router.js','modules/platform/training-finance-router.js','client/public/admin-user-plans.js'];
const document=path.join(target,'client/public/index.html'),regex=/\/admin-user-plans\.js(?:\?[^"\s<>]+)?/g;let html=fs.readFileSync(document,'utf8');
if((html.match(regex)||[]).length!==1)throw Error('AMBIGUOUS_MANAGE_USERS_LOADER');
html=html.replace(regex,'/admin-user-plans.js?v=20261021-base-crm1');fs.writeFileSync(document,html);
for(const rel of files){const dest=path.join(target,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(source,rel),dest);}
console.log(JSON.stringify({runtimeFiles:[...files,'client/public/index.html'],migrations:[]}));
