'use strict';
const fs=require('node:fs'),path=require('node:path');const [target,source]=process.argv.slice(2);
if(!target||!source||path.resolve(target)===path.resolve(source))throw Error('DISTINCT_TARGET_AND_SOURCE_REQUIRED');
const files=['modules/platform/chatbot-capture-forms.js','modules/platform/chatbot-config.js','modules/platform/chatbot-domain-packs.js','modules/platform/chatbot-guide-preview.js','modules/platform/chatbot-router.js','modules/platform/chatbot-runtime.js','client/public/chatbot-admin.js','client/public/training-sidebar.js'];
const document=path.join(target,'client/public/index.html');let html=fs.readFileSync(document,'utf8');
for(const asset of ['chatbot-admin.js','training-sidebar.js']){const regex=new RegExp('/'+asset.replaceAll('.','\\.')+'(?:\\?[^"\\s<>]+)?','g');if((html.match(regex)||[]).length!==1)throw Error('AMBIGUOUS_LOADER:'+asset);html=html.replace(regex,'/'+asset+'?v=20261020-bot-forms1');}
fs.writeFileSync(document,html);
for(const rel of files){const dest=path.join(target,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(source,rel),dest);}
console.log(JSON.stringify({runtimeFiles:[...files,'client/public/index.html'],migrations:[]}));
