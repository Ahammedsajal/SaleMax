'use strict';
// Copy narrow, reviewed maintained inputs over the resolved release, preserving
// the generated frontend and all unrelated deployed modules.
const fs=require('node:fs'),path=require('node:path');
const [target,source]=process.argv.slice(2);if(!target||!source||path.resolve(target)===path.resolve(source))throw Error('DISTINCT_ROOTS_REQUIRED');
const files=['client/public/template-placeholder-contract.js','client/public/template-placeholders.css','client/public/campaign-placeholder-mapping.js','client/public/meta-template-samples.js','modules/web/meta-template-samples-shell.js','modules/platform/campaign-placeholder-validation.js','routes/broadcast.js','routes/user.js','loops/campaignBeta.js'];
for(const file of files){const dest=path.join(target,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(source,file),dest);}
const index=path.join(target,'client/public/index.html');let html=fs.readFileSync(index,'utf8');html=html.replace(/<script[^>]+src="\/(?:meta-template-samples|template-placeholder-contract|campaign-placeholder-mapping)\.js[^"<]*"[^>]*><\/script>/g,'');
html=html.replace(/<link[^>]+href="\/template-placeholders\.css[^"<]*"[^>]*>/g,'');
html=require(path.join(source,'modules/web/meta-template-samples-shell')).injectMetaTemplateSamplesScript(html);fs.writeFileSync(index,html);
console.log('Applied nine maintained inputs and existing-shell loader tags. No migration.');
