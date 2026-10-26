'use strict';const fs=require('node:fs');const root=process.argv[2]||'/app/client/public';const file=root+'/team-login.js';let s=fs.readFileSync(file,'utf8');
function once(a,b){if(s.split(a).length!==2)throw Error('Expected one Team Login navigation anchor');s=s.replace(a,b);}
once('#sx-team-login{position:fixed;z-index:1300;','#sx-team-login{position:fixed;z-index:1000;');
once('<div class="wrap"><h1>','<div class="wrap"><nav style="position:sticky;top:0;z-index:1;background:#f5f7fa;padding:0 0 8px"><a data-workspace-back href="/user?page=dashboard" style="display:inline-flex;align-items:center;min-height:44px;padding:0 10px;border:1px solid #d0d5dd;border-radius:8px;color:#314757;background:white;text-decoration:none">${label(\'Back to workspace\',\'العودة إلى مساحة العمل\')}</a></nav><h1>');
once('@media(max-width:760px){#sx-team-login','@media(max-width:899px){#sx-team-login');
fs.writeFileSync(file,s);const shell=root+'/index.html';let h=fs.readFileSync(shell,'utf8');const refs=h.match(/team-login\.js\?v=[^"'\s<>]+/g);if(refs?.length!==1)throw Error('Expected one Team Login reference');fs.writeFileSync(shell,h.replace(refs[0],'team-login.js?v=20261026-navigation1'));
