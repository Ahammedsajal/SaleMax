'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=process.argv[2]||'/app/client/public';
const patch=(name,before,after)=>{
 const file=path.join(root,name);let s=fs.readFileSync(file,'utf8');
 if(!s.includes(before)||s.indexOf(before)!==s.lastIndexOf(before))throw Error('Expected one '+name+' anchor: '+before.slice(0,80));
 fs.writeFileSync(file,s.replace(before,after));
};
patch('recruitment.js','function frame(root){const appBar','function frame(root){if(!root)return;const appBar');
patch('recruitment.js','<div class="sx-recruit-wrap"><header','<div class="sx-recruit-wrap"><nav class="sx-recruit-nav"><a class="sx-recruit-back" href="/user?page=dashboard">${tr(\'Back to workspace\',\'العودة إلى مساحة العمل\')}</a></nav><header');
patch('recruitment.js',"else if(!active())document.getElementById('sx-recruitment-screen')?.remove();","else if(!active())document.getElementById('sx-recruitment-screen')?.remove();if(active()){frame(document.getElementById('sx-recruitment-screen'));labelRecruitmentTables();}");
patch('recruitment.js',"const observer=new MutationObserver(","function labelRecruitmentTables(){document.querySelectorAll('#sx-recruitment-screen table').forEach(table=>{const headings=[...table.querySelectorAll('thead th')].map(x=>x.textContent);table.querySelectorAll('tbody tr').forEach(row=>[...row.cells].forEach((cell,i)=>{if(cell.dataset.label!==headings[i])cell.dataset.label=headings[i]||'';}));});}\n  const observer=new MutationObserver(");
patch('training-forms.js','return visible&&atViewportEdge&&(item.docked||!item.modal||compactPersistent);','return window.innerWidth>=900&&visible&&atViewportEdge&&(item.docked||!item.modal||compactPersistent);');
patch('training-forms.js',"location.href='/user';","location.href='/user?page=dashboard';");
patch('training-sidebar.js',"if(style.display==='none'||style.visibility==='hidden'){hidden=true;break;}","if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0||parent.getBoundingClientRect().width===0){hidden=true;break;}");
const shell=path.join(root,'index.html');let html=fs.readFileSync(shell,'utf8');
for(const [name,version] of [['training-sidebar','20261026-application-drawer3'],['training-forms','20261026-application-compact1']]){
 const rx=new RegExp(name+'\\.js\\?v=[^"\x27\\s<>]+','g');const refs=html.match(rx);if(refs?.length!==1)throw Error('Expected one shell ref for '+name);
 html=html.replace(refs[0],name+'.js?v='+version);
}
if(html.includes('/applications-mobile.css'))throw Error('Applications stylesheet already present');
html=html.replace('</head>','<link rel="stylesheet" href="/applications-mobile.css?v=20261026-compact1"></head>');
if(!html.includes('/applications-mobile.css'))throw Error('Missing head insertion');
fs.writeFileSync(shell,html);
const sidebar=path.join(root,'training-sidebar.js');let source=fs.readFileSync(sidebar,'utf8');
const refs=source.match(/recruitment\.js\?v=[^"'\s<>]+/g);
if(refs?.length!==1)throw Error('Expected one recruitment loader');
fs.writeFileSync(sidebar,source.replace(refs[0],'recruitment.js?v=20261026-application-navigation1'));
