'use strict';
const fs=require('node:fs'),path=require('node:path');
const [target,source]=process.argv.slice(2);if(!target||!source||path.resolve(target)===path.resolve(source))throw Error('DISTINCT_TARGET_AND_SOURCE_REQUIRED');
const files=['modules/platform/lead-workspace-contract.js','routes/pipeline.js','client/public/pipeline/workspace-fields.js','client/public/pipeline/pipeline.js'];
const htmlPath=path.join(target,'client/public/pipeline/index.html');let html=fs.readFileSync(htmlPath,'utf8');
if(html.includes('/pipeline/workspace-fields.js'))throw Error('WORKSPACE_LOADER_EXISTS');
const anchor=/<script[^>]+src="\/pipeline\/pipeline\.js(?:\?[^"<>]+)?"[^>]*><\/script>/g;
if((html.match(anchor)||[]).length!==1)throw Error('AMBIGUOUS_PIPELINE_LOADER');
html=html.replace(anchor,match=>'<script src="/pipeline/workspace-fields.js?v=20261020-category1"></script>'+match).replace(/\/pipeline\/pipeline\.js(?:\?[^"\s<>]+)?/g,'/pipeline/pipeline.js?v=20261020-category1');
fs.writeFileSync(htmlPath,html);
for(const rel of files){const dst=path.join(target,rel);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(path.join(source,rel),dst);}
console.log(JSON.stringify({runtimeFiles:[...files,'client/public/pipeline/index.html'],migrations:[]}));
