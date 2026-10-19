'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../client/public/workspace-modern.js'),'utf8');
function run(path,language){
 const links=[],root={dataset:{}},doc={addEventListener(){},documentElement:root,head:{append:link=>links.push(link)},querySelector:()=>links[0]||null,querySelectorAll:()=>[],createElement:()=>({dataset:{}})};
 vm.runInNewContext(source,{location:{pathname:path,origin:'https://synthetic.example'},document:doc,localStorage:{getItem:()=>language},MutationObserver:class{observe(){}},WeakSet});
 return {links,root};
}
test('modern workspace styling is limited to existing authenticated routes and modules',()=>{
 for(const path of ['/','/pricing','/public/form','/api/user'])assert.equal(run(path,'en').links.length,0);
 for(const path of ['/user','/user/login','/agent','/admin']){const r=run(path,'en');assert.equal(r.root.dataset.sxModern,'shell');assert.equal(r.links.length,1);}
});
test('embedded and direct module entry honors persisted Arabic locale before module scripts run',()=>{
 for(const language of ['ar','ar-QA','Arabic']){const r=run('/sales-workspace/',language);assert.equal(r.root.dataset.sxModern,'module');assert.equal(r.root.dir,'rtl');assert.equal(r.root.lang,'ar');assert.equal(r.links.length,1);}
 assert.equal(run('/sales-workspace/','en').root.dir,'ltr');
});
test('Training Center profile/student navigation never clones the Sales catalogue',()=>{
 for(const file of ['training-courses.js','training-students.js']){
  const s=fs.readFileSync(require.resolve('../client/public/'+file),'utf8');const start=s.lastIndexOf('  function addNav(){'),end=s.indexOf('\n',start);const fn=s.slice(start,end);
  let queries=0;const context={location:{pathname:'/user'},document:{querySelector:()=>{queries++;return {dataset:{sxCatalogKind:'products'}};}},api:()=>assert.fail('Sales cannot fetch training profile for navigation')};
  vm.runInNewContext(fn+';addNav();',context);assert.equal(queries,1);
 }
});
