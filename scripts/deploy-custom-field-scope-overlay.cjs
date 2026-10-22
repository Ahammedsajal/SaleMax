'use strict';

// Overlay only the reviewed field-scope runtime files onto a copied release.
// This preserves production-only files and the generated React shell.
const fs=require('node:fs');
const path=require('node:path');
const [target,source]=process.argv.slice(2);
if(!target||!source||path.resolve(target)===path.resolve(source))throw Error('DISTINCT_TARGET_AND_SOURCE_REQUIRED');
const files=[
  'modules/platform/custom-field-scope-registry.js',
  'modules/platform/custom-field-contract.js',
  'modules/platform/tenant-customization.js',
  'modules/platform/tenant-customization-router.js',
  'client/public/lead-field-editor.js',
  'client/public/tenant-customization.js',
];
for(const file of files)if(!fs.lstatSync(path.join(source,file)).isFile())throw Error('REGULAR_SOURCE_FILE_REQUIRED:'+file);
const index=path.join(target,'client/public/index.html');
let html=fs.readFileSync(index,'utf8');
function pattern(name){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp(`<script\\b(?=[^>]*\\bsrc="\\/${escaped}(?:\\?[^"<>]*)?")[^>]*><\\/script>`,'g');
}
function ensureVersion(name,version,anchorName){
  const tags=[...html.matchAll(pattern(name))];
  if(tags.length>1)throw Error('AMBIGUOUS_LOADER:'+name);
  if(tags.length===1){
    const tag=tags[0][0],sourcePattern=new RegExp(`src="\\/${name.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\\\$&')}(?:\\?[^"<>]*)?"`);
    const updated=tag.replace(sourcePattern,`src="/${name}?v=${version}"`);
    html=html.slice(0,tags[0].index)+updated+html.slice(tags[0].index+tag.length);
    return;
  }
  const anchors=[...html.matchAll(pattern(anchorName))];
  if(anchors.length!==1)throw Error('AMBIGUOUS_LOADER:'+anchorName);
  const tag=`<script defer src="/${name}?v=${version}"></script>`;
  html=html.slice(0,anchors[0].index)+tag+html.slice(anchors[0].index);
}
ensureVersion('lead-field-editor.js','20261022-field-scopes1','tenant-customization.js');
ensureVersion('tenant-customization.js','20261022-field-scopes1','tenant-crm-appearance.js');
const ordered=['lead-field-editor.js','tenant-customization.js','tenant-crm-appearance.js'].map(name=>html.indexOf('/'+name));
if(ordered.some(index=>index<0)||ordered[0]>=ordered[1]||ordered[1]>=ordered[2])throw Error('CUSTOMIZATION_SCRIPT_ORDER_INVALID');
for(const file of files){
  const destination=path.join(target,file);fs.mkdirSync(path.dirname(destination),{recursive:true});
  try{if(fs.lstatSync(destination).isSymbolicLink())throw Error('SYMLINK_TARGET_REJECTED:'+file);}catch(error){if(error.code!=='ENOENT')throw error;}
  fs.copyFileSync(path.join(source,file),destination);
}
fs.writeFileSync(index,html);
console.log(JSON.stringify({runtimeFiles:[...files,'client/public/index.html'],migrations:[],generatedShell:'preserved except two reviewed field-scope script references'}));
