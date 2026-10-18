'use strict';
// Preserve the resolved live release and generated React shell. This overlay
// changes only maintained feature modules, adapters and their loader versions.
const fs=require('node:fs'),path=require('node:path');
const [target,source]=process.argv.slice(2);
if(!target||!source||path.resolve(target)===path.resolve(source))throw Error('DISTINCT_TARGET_AND_SOURCE_REQUIRED');
const files=[
 'modules/platform/business-feature-session.js','modules/platform/feature-contract.js','modules/platform/auth-router.js','modules/platform/sessions.js',
 'modules/platform/navigation.js','modules/platform/policy.js','modules/platform/team-role-request-guard.js','modules/platform/mount-existing-upgrade.js',
 'modules/platform/course-quick-replies.js','modules/platform/course-quick-reply-router.js','modules/platform/course-reply-transport.js',
 'modules/platform/phonebook-workspace.js','modules/platform/phonebook-workspace-router.js',
 'modules/platform/training-finance-router.js','modules/platform/training-course-router.js','modules/platform/training-form-router.js',
 'modules/platform/training-students-router.js','modules/platform/training-center-profile-router.js',
 'client/public/training-sidebar.js','client/public/workspace-api.js','client/public/training-finance.js','client/public/finance-dashboard.js','client/public/course-quick-replies.js',
 'client/public/phonebook-workspace.js','client/public/training-courses.js','client/public/training-students.js','client/public/training-forms.js'
];
for(const file of files){const destination=path.join(target,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(source,file),destination);}
const server=path.join(target,'server.js');let serverText=fs.readFileSync(server,'utf8');
for(const mount of ['/api/phonebook/workspace','/api/agent/phonebook','/api/inbox/course-replies','/api/agent/course-replies']){
 const line=serverText.split('\n').filter(value=>value.includes('app.use("'+mount+'"'));
 if(line.length>1)throw Error('DUPLICATE_LEGACY_MOUNT:'+mount);
 if(line.length)serverText=serverText.replace(line[0]+'\n','');
}
fs.writeFileSync(server,serverText);
const index=path.join(target,'client/public/index.html');let html=fs.readFileSync(index,'utf8');
if(!html.includes('/workspace-api.js?')){if(html.split('<head>').length!==2)throw Error('HEAD_ANCHOR_AMBIGUOUS');html=html.replace('<head>','<head><script defer src="/workspace-api.js?v=20261018-unified1"></script>');}
for(const name of ['training-sidebar.js','workspace-api.js','training-finance.js','finance-dashboard.js','course-quick-replies.js','phonebook-workspace.js','training-courses.js','training-forms.js','training-students.js']){
 const escaped=name.replaceAll('.','\\.');html=html.replace(new RegExp(escaped+'\\?v=[^"\\s<>]+','g'),name+'?v=20261018-unified1');
}
fs.writeFileSync(index,html);
console.log(JSON.stringify({copied:files.length,runtimeFiles:[...files,'server.js','client/public/index.html'],serverAliases:'mounted once in existing upgrade',loaderVersion:'20261018-unified1'}));
