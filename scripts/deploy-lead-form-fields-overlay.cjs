'use strict';
const fs=require('node:fs'),path=require('node:path');const [target,source]=process.argv.slice(2);
if(!target||!source||path.resolve(target)===path.resolve(source))throw Error('DISTINCT_TARGET_AND_SOURCE_REQUIRED');
const files=['modules/platform/lead-form-fields.js','modules/platform/training-forms.js','modules/platform/training-form-router.js','helper/pipeline/leadPipeline.js','routes/pipeline.js','client/public/training-forms.js','client/public/training-public-form.js','client/public/pipeline/pipeline.js','client/public/lead-field-editor.js'];
const documents={'client/public/index.html':['training-forms.js','lead-field-editor.js'],'client/public/training-form.html':['training-public-form.js'],'client/public/pipeline/index.html':['pipeline/pipeline.js']};
const patches=[];for(const [rel,assets] of Object.entries(documents)){
 let html=fs.readFileSync(path.join(target,rel),'utf8');
 for(const asset of assets){const regex=new RegExp('/'+asset.replaceAll('.','\\.')+'(?:\\?[^"\\s<>]+)?','g');if((html.match(regex)||[]).length!==1)throw Error('AMBIGUOUS_ASSET_REFERENCE:'+asset);html=html.replace(regex,'/'+asset+'?v=20261020-form-fields1');}
 patches.push([rel,html]);
}
for(const [rel,html] of patches)fs.writeFileSync(path.join(target,rel),html);
for(const rel of files){const dst=path.join(target,rel);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(path.join(source,rel),dst);}
console.log(JSON.stringify({runtimeFiles:[...files,...Object.keys(documents)],migrations:[]}));
