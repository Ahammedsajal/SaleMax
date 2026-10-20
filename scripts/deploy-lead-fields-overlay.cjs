'use strict';
const fs=require('node:fs'),path=require('node:path');
const [target,source]=process.argv.slice(2);if(!target||!source||path.resolve(target)===path.resolve(source))throw Error('DISTINCT_TARGET_AND_SOURCE_REQUIRED');
const files=['modules/platform/lead-field-contract.js','modules/platform/lead-field-runtime.js','modules/platform/tenant-customization.js','helper/pipeline/leadPipeline.js','routes/pipeline.js','client/public/lead-field-editor.js','client/public/tenant-customization.js','client/public/pipeline/lead-fields.js','client/public/pipeline/pipeline.js'];
function addBefore(file,anchor,name){let html=fs.readFileSync(file,'utf8');if(html.includes('/'+name+'?'))throw Error('LEAD_FIELD_LOADER_EXISTS');const regex=new RegExp('<script[^>]+src="/'+anchor.replaceAll('.','\\.')+'(?:\\?[^"<>]+)?"[^>]*><\\/script>','g');if((html.match(regex)||[]).length!==1)throw Error('AMBIGUOUS_LOADER:'+anchor);html=html.replace(regex,match=>'<script src="/'+name+'?v=20261020-fields1"'+(file.endsWith('/public/index.html')?' defer':'')+'></script>'+match);const pattern=new RegExp('/'+anchor.replaceAll('.','\\.')+'(?:\\?[^"\\s<>]+)?','g');html=html.replace(pattern,'/'+anchor+'?v=20261020-fields1');fs.writeFileSync(file,html);}
// Validate and patch the current generated documents, never copy old local HTML.
addBefore(path.join(target,'client/public/index.html'),'tenant-customization.js','lead-field-editor.js');
addBefore(path.join(target,'client/public/pipeline/index.html'),'pipeline/pipeline.js','pipeline/lead-fields.js');
for(const file of files){const dest=path.join(target,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(source,file),dest);}
console.log(JSON.stringify({runtimeFiles:[...files,'client/public/index.html','client/public/pipeline/index.html'],migrations:[],schemaVersions:[1,2]}));
