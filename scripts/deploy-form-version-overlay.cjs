'use strict';
const fs=require('node:fs'),path=require('node:path');const [target,source]=process.argv.slice(2);
if(!target||!source||path.resolve(target)===path.resolve(source))throw Error('DISTINCT_TARGET_AND_SOURCE_REQUIRED');
const files=['modules/platform/form-submission-version.js','modules/platform/training-forms.js','modules/platform/training-form-router.js','routes/pipeline.js','client/public/training-public-form.js'];
const htmlPath=path.join(target,'client/public/training-form.html');let html=fs.readFileSync(htmlPath,'utf8');const pattern=/\/training-public-form\.js(?:\?[^"\s<>]+)?/g;if((html.match(pattern)||[]).length!==1)throw Error('AMBIGUOUS_PUBLIC_FORM_LOADER');html=html.replace(pattern,'/training-public-form.js?v=20261021-version1');
fs.writeFileSync(htmlPath,html);for(const rel of files){const dst=path.join(target,rel);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(path.join(source,rel),dst);}
console.log(JSON.stringify({runtimeFiles:[...files,'client/public/training-form.html'],migrations:[]}));
