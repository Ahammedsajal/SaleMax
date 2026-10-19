'use strict';
// Explicit DOM regression runner: npm install linkedom in a disposable runtime.
const {parseHTML}=require('linkedom'),fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const navigation=require('../modules/platform/navigation'),policy=require('../modules/platform/policy');
const source=fs.readFileSync(path.join(__dirname,'../client/public/team-invitations.js'),'utf8');
const fragment=source.slice(source.indexOf('  function renderRolePermissions('),source.indexOf('  function resetRoleForm('));
for(const arabic of [false,true]){
 const {document,HTMLInputElement}=parseHTML('<html><body><form id="sx-role-form"><input name="seatRole" value="agent"><div id="sx-role-permissions"></div></form></body></html>');
 Object.defineProperty(HTMLInputElement.prototype,'checked',{configurable:true,get(){return this.hasAttribute('checked');},set(value){this.toggleAttribute('checked',!!value);}});
 const label=(en,ar)=>arabic?ar:en;
 const catalog=navigation.items.filter(item=>item.sidebar!==false).map(item=>({...item,available:item.key!=='settings',requiredPermissions:item.key==='finance-reports'?[item.permission,'invoices.read']:[item.permission],actions:policy.capabilities[item.capability]}));
 const data={permissionCatalog:{agent:Object.keys(policy.permissions)},permissionDefaults:{agent:[]},screenCatalog:catalog};
 const sandbox={document,label,esc:String,permissionTitle:key=>key.split('.').at(-1),Set,Map};vm.runInNewContext(fragment,sandbox);
 sandbox.renderRolePermissions(data,['reports.read','courses.read']);
 const checkbox=key=>document.querySelector('[name=sidebarScreen][value="'+key+'"]'),target=document.getElementById('sx-role-permissions');
 assert.equal(checkbox('reports').checked,true);assert.equal(checkbox('finance-reports').checked,false);assert.equal(checkbox('settings').hasAttribute('disabled'),true);
 assert.ok(target.textContent.includes(label('Lead Reports','تقارير العملاء المحتملين')));assert.ok(!target.textContent.includes('reports.read'));
 checkbox('finance-reports').checked=true;target.onchange({target:checkbox('finance-reports')});
 assert.equal(document.querySelector('[name=permission][value="invoices.read"]').checked,true);
 checkbox('reports').checked=false;target.onchange({target:checkbox('reports')});
 const saved=[...document.querySelectorAll('[name=sidebarScreen]:checked')].map(input=>input.value);
 assert.ok(saved.includes('finance-reports'));assert.ok(!saved.includes('reports'));
 sandbox.renderRolePermissions(data,['reports.read','courses.read','invoices.read'],saved);
 assert.equal(checkbox('reports').checked,false);assert.equal(checkbox('finance-reports').checked,true);
 assert.ok(!document.querySelector('[data-role-screen-preview]').textContent.includes(label('Lead Reports','تقارير العملاء المحتملين')));
}
console.log(JSON.stringify({passed:true,checks:['English and Arabic matching screen names','finance not implied by lead reports','disabled unavailable screen','explicit independent screen selection','required read action','saved selection reopens without broadening','no raw permission keys in labels']}));
