'use strict';
// Synthetic browser fixture; no customer accounts or external services.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const navigation=require('../modules/platform/navigation'),policy=require('../modules/platform/policy');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const source=fs.readFileSync(path.join(__dirname,'../client/public/team-invitations.js'),'utf8');
  const fragment=source.slice(source.indexOf('  function renderRolePermissions('),source.indexOf('  function resetRoleForm('));
  const css=fs.readFileSync(path.join(__dirname,'../client/public/team-access.css'),'utf8');
  const output=process.env.ROLE_SIDEBAR_EVIDENCE;
  for(const ar of [false,true])for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:1000}});
   await page.setContent(`<html lang="${ar?'ar':'en'}" dir="${ar?'rtl':'ltr'}"><head><style>body{font-family:Arial;margin:0}#sx-team-screen{padding:20px}dialog{width:90vw;max-height:90vh;overflow:auto;border:1px solid #ddd;border-radius:16px}h2{margin:0 0 12px}</style><style>${css}</style></head><body><div id="sx-team-screen"><dialog open class="team-dialog role-dialog"><h2>${ar?'تعديل الدور':'Edit role'}</h2><form id="sx-role-form"><input name="seatRole" value="agent" hidden><fieldset class="permission-fieldset"><legend>${ar?'شاشات القائمة الجانبية والإجراءات':'Sidebar screens and actions'}</legend><div id="sx-role-permissions"></div></fieldset><div class="dialog-actions"><button type="button">${ar?'حفظ الدور':'Save role'}</button></div></form></dialog></div></body></html>`);
   await page.evaluate(code=>window.eval(code),source.slice(source.indexOf('  const css ='),source.indexOf('  document.head.append(css);')+'  document.head.append(css);'.length));
   await page.evaluate(({fragment,ar,catalog,permissions})=>{
    window.label=(en,arabic)=>ar?arabic:en;window.esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
    window.permissionTitle=key=>({read:label('View','عرض'),manage:label('Manage','إدارة')})[key.split('.').at(-1)]||key.split('.').at(-1);
    window.eval(fragment+';window.renderRolePermissions=renderRolePermissions;');
    window.fixture={permissionCatalog:{agent:permissions},permissionDefaults:{agent:[]},screenCatalog:catalog};
    renderRolePermissions(window.fixture,['reports.read','courses.read','conversations.read'],['reports','courses','inbox']);
   },{fragment,ar,catalog:navigation.items.filter(item=>item.sidebar!==false).map(item=>({...item,available:!item.ownerOnly&&item.key!=='settings',requiredPermissions:item.key==='finance-reports'?[item.permission,'invoices.read']:[item.permission],actions:policy.capabilities[item.capability]})),permissions:Object.keys(policy.permissions)});
   assert.equal(await page.locator('[name=sidebarScreen]:checked').count(),3);
   await page.locator('[name=sidebarScreen][value=finance-reports]').check();
   await page.locator('[name=sidebarScreen][value=reports]').uncheck();
   assert.equal(await page.locator('[name=sidebarScreen][value=finance-reports]').isChecked(),true);
   assert.equal(await page.locator('[name=sidebarScreen][value=reports]').isChecked(),false);
   assert.equal(await page.locator('[name=permission][value="invoices.read"]').isChecked(),true);
   await page.locator('[data-permission-search]').fill(ar?'المالية':'Finance Reports');
   assert.equal(await page.locator('[data-screen-card]:visible').count(),1);
   await page.locator('[data-permission-search]').fill('');
   const overflow=await page.evaluate(()=>document.querySelector('dialog').scrollWidth>document.querySelector('dialog').clientWidth+1);
   assert.equal(overflow,false,`horizontal overflow ${width} ${ar}`);
   await page.locator('dialog').evaluate(el=>el.scrollTop=0);
   if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,`role-sidebar-${ar?'ar':'en'}-${width}.png`)});}
   await page.close();
  }
  const page=await browser.newPage();
  await page.route('http://sidebar.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<html><head></head><body></body></html>'}));
  await page.goto('http://sidebar.invalid/user?page=dashboard');
  await page.setContent('<div class="MuiDrawer-paper" style="width:250px"><ul>'+['Dashboard','Lead Reports','Finance Reports','Web Notifications','Inbox','Students','Unknown legacy item','Agent Task','Tasks'].map(name=>`<li ${name==='Tasks'?'data-sx-tasks-nav':''}><button class="MuiListItemButton-root"><span class="MuiListItemText-primary">${name}</span></button></li>`).join('')+'</ul></div>');
  await page.evaluate(()=>{window.fixtureNavigation=['dashboard','inbox','reports','tasks'];window.SaleMaxActor='agent';window.SaleMaxWorkspace={session:async()=>({role:'agent',categoryKey:'training_center',roleNavigation:window.fixtureNavigation,assignedNavigation:null})};window.__sxChatbotAdminLoader=window.__sxFaqManagerLoader=window.__sxTrainingFormsEditorLayoutLoader=true;});
  await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../client/public/training-sidebar.js'),'utf8')});
  const row=name=>page.locator('li').filter({has:page.locator('.MuiListItemText-primary',{hasText:new RegExp('^'+name+'$')})});
  await row('Lead Reports').waitFor({state:'visible'});
  for(const name of ['Finance Reports','Students','Web Notifications','Unknown legacy item','Agent Task'])assert.equal(await row(name).isVisible(),false,name);
  assert.equal(await row('Tasks').isVisible(),true);
  await page.evaluate(()=>{window.fixtureNavigation=['dashboard','inbox','finance-reports','notifications'];window.dispatchEvent(new Event('focus'));});
  await row('Finance Reports').waitFor({state:'visible'});
  assert.equal(await row('Lead Reports').isVisible(),false);
  assert.equal(await row('Web Notifications').isVisible(),true);
  await page.close();
  console.log(JSON.stringify({passed:true,checks:['desktop and mobile English and Arabic','independent finance and lead reports','screen enables required action','screen-name search','no horizontal dialog overflow','real sidebar hides unselected and unknown agent rows','duplicate task removed','sidebar refresh applies changed selection']}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
