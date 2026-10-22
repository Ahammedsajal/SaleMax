'use strict';
const fs=require('node:fs'),path=require('node:path');const [target,source]=process.argv.slice(2);
if(!target||!source||path.resolve(target)===path.resolve(source))throw Error('DISTINCT_TARGET_AND_SOURCE_REQUIRED');
const targetRoot=path.resolve(target),targetStat=fs.lstatSync(targetRoot);
if(targetStat.isSymbolicLink()||!targetStat.isDirectory())throw Error('INVALID_TARGET_ROOT');
const targetRealRoot=fs.realpathSync(targetRoot);
function targetPath(relative){
 const normalized=path.normalize(relative);
 if(path.isAbsolute(normalized)||normalized==='..'||normalized.startsWith(`..${path.sep}`))throw Error('INVALID_TARGET_PATH');
 const parts=normalized.split(path.sep);let current=targetRealRoot;
 for(let index=0;index<parts.length;index++){
  current=path.join(current,parts[index]);
  if(!fs.existsSync(current))continue;
  const stat=fs.lstatSync(current);
  if(stat.isSymbolicLink())throw Error('UNSAFE_TARGET_SYMLINK:'+relative);
  if(index<parts.length-1&&!stat.isDirectory())throw Error('INVALID_TARGET_PARENT:'+relative);
 }
 return current;
}
const version='20261022-generic-staff-forms1';
const files=['modules/platform/form-submission-version.js','modules/platform/training-forms.js','modules/platform/workspace-forms.js','modules/platform/training-form-router.js','client/public/training-forms.js','client/public/workspace-api.js','client/public/training-public-form.js'];
const migrations=['20261022_pipeline_identity_activity_actor.sql','20261022_workspace_forms.sql'];
const migrationCopies=migrations.map(name=>({name,source:path.join(source,'database/migrations',name),target:targetPath(`database/migrations/${name}`)}));
for(const migration of migrationCopies){
 if(!fs.existsSync(migration.source)||fs.lstatSync(migration.source).isSymbolicLink()||!fs.statSync(migration.source).isFile())throw Error('MIGRATION_SOURCE_MISSING:'+migration.name);
 if(fs.existsSync(migration.target)){
  if(fs.lstatSync(migration.target).isSymbolicLink()||!fs.statSync(migration.target).isFile())throw Error('INVALID_TARGET_MIGRATION:'+migration.name);
  if(fs.readFileSync(migration.target).compare(fs.readFileSync(migration.source))!==0)throw Error('TARGET_MIGRATION_CHECKSUM_CONFLICT:'+migration.name);
 }
}
const targetFiles=[...files,'client/public/index.html','client/public/training-form.html'].map(relative=>({relative,path:targetPath(relative)}));
for(const rel of files){const sourceFile=path.join(source,rel);if(!fs.existsSync(sourceFile)||fs.lstatSync(sourceFile).isSymbolicLink()||!fs.statSync(sourceFile).isFile())throw Error('INVALID_SOURCE_FILE:'+rel);}
function bump(html,asset,{required=true}={}){
 const regex=new RegExp('/'+asset.replaceAll('.','\\.')+'(?:\\?[^"\\s<>]+)?','g'),matches=html.match(regex)||[];
 if(matches.length>1||required&&matches.length!==1)throw Error('AMBIGUOUS_ASSET_REFERENCE:'+asset);
 if(!matches.length)return html;
 return html.replace(regex,'/'+asset+'?v='+version);
}
const indexPath=targetFiles.find(file=>file.relative==='client/public/index.html').path;let index=fs.readFileSync(indexPath,'utf8');
if(!(index.match(/\/workspace-api\.js(?:\?[^"\s<>]+)?/g)||[]).length){if(index.split('<head>').length!==2)throw Error('HEAD_ANCHOR_AMBIGUOUS');index=index.replace('<head>','<head><script defer src="/workspace-api.js?v='+version+'"></script>');}
index=bump(index,'workspace-api.js');index=bump(index,'training-forms.js');
const formPath=targetFiles.find(file=>file.relative==='client/public/training-form.html').path;let form=fs.readFileSync(formPath,'utf8');
const apiRefs=form.match(/\/workspace-api\.js(?:\?[^"\s<>]+)?/g)||[];
if(apiRefs.length>1)throw Error('AMBIGUOUS_ASSET_REFERENCE:workspace-api.js');
if(!apiRefs.length){const anchor=/(<script[^>]+src="\/training-public-form\.js)/;if(!anchor.test(form))throw Error('PUBLIC_FORM_LOADER_ANCHOR_AMBIGUOUS');form=form.replace(anchor,'<script defer src="/workspace-api.js?v='+version+'"></script>$1');}
form=bump(form,'workspace-api.js');form=bump(form,'training-public-form.js');
for(const [rel,contents] of [['client/public/index.html',index],['client/public/training-form.html',form]])fs.writeFileSync(path.join(target,rel),contents);
for(const rel of files){const destination=targetFiles.find(file=>file.relative===rel).path;fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(source,rel),destination);}
for(const migration of migrationCopies){fs.mkdirSync(path.dirname(migration.target),{recursive:true});if(!fs.existsSync(migration.target))fs.copyFileSync(migration.source,migration.target,fs.constants.COPYFILE_EXCL);}
console.log(JSON.stringify({runtimeFiles:[...files,'client/public/index.html','client/public/training-form.html'],migrations,migrationFiles:migrationCopies.map(({name})=>`database/migrations/${name}`)}));
