'use strict';
const fs=require('node:fs'),path=require('node:path');const [target,source]=process.argv.slice(2);
if(!target||!source||path.resolve(target)===path.resolve(source))throw Error('DISTINCT_TARGET_AND_SOURCE_REQUIRED');
const files=['modules/platform/chatbot-runtime-access.js','modules/platform/chatbot-runtime.js'];
for(const rel of files){const dest=path.join(target,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(source,rel),dest);}
console.log(JSON.stringify({runtimeFiles:files,migrations:[]}));
