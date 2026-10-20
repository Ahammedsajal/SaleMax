'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const source=fs.readFileSync(path.join(__dirname,'../client/public/training-sidebar.js'),'utf8');
const row=name=>`<li><button class="MuiListItemButton-root"><span class="MuiListItemText-root"><span class="MuiListItemText-primary"><span>${name}</span></span></span></button></li>`;
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});let cases=0;try{
 for(const language of ['en','ar'])for(const role of ['owner','agent']){
  const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(5000);
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<html lang="${language}"><body>${[1,2].map(()=>`<div class="MuiDrawer-paper" style="width:250px"><input><ul>${row('Dashboard')}${row('Inbox')}${row('Lead Pipeline')}${row('Tasks')}</ul></div>`).join('')}</body></html>`}));
  await page.goto('http://127.0.0.1/user?page=dashboard');
  await page.evaluate(({role,language})=>{
   localStorage.setItem('language',language);window.clicked=0;for(const button of document.querySelectorAll('button'))button.addEventListener('click',()=>window.clicked++);
   window.fixtureAccess={tenantId:'tenant-a',role,categoryKey:'training_center',roleNavigation:['dashboard','inbox','leads','tasks'],assignedNavigation:null,navigationLabels:{inbox:{en:'Customer desk A',ar:'مكتب العملاء أ'}}};
   window.SaleMaxWorkspace={session:async()=>window.fixtureAccess,invalidateSession(){}};
   window.__sxChatbotAdminLoader=window.__sxFaqManagerLoader=window.__sxTrainingFormsEditorLayoutLoader=true;
  },{role,language});
  await page.addScriptTag({content:source});
  await page.waitForFunction(()=>document.querySelectorAll('[data-sx-tenant-label]').length===2);
  const custom=page.locator('[data-sx-tenant-label]').first();assert.equal(await custom.textContent(),language==='ar'?'مكتب العملاء أ':'Customer desk A');
  assert.equal(await page.locator('[data-sx-native-label-hidden]').first().textContent(),'Inbox');
  await custom.click();assert.equal(await page.evaluate(()=>window.clicked),1,'native navigation handlers survive customization');
  await page.locator('.MuiDrawer-paper input').first().fill(language==='ar'?'مكتب':'Customer desk');
  assert.equal(await page.locator('[data-sx-tenant-label]').first().isVisible(),true,'search matches customized label');
  await page.locator('.MuiDrawer-paper input').first().fill('');
  await page.evaluate(()=>{window.fixtureAccess={...window.fixtureAccess,tenantId:'tenant-b',navigationLabels:{inbox:{en:'Reception B',ar:'استقبال ب'}}};window.dispatchEvent(new Event('salemax:customization-published'));});
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-sx-tenant-label]')].every(node=>/Reception B|استقبال ب/.test(node.textContent)));
  assert.equal(await page.locator('[data-sx-tenant-label]').count(),2);
  await page.evaluate(()=>{window.fixtureAccess={...window.fixtureAccess,navigationLabels:{}};window.dispatchEvent(new Event('salemax:customization-published'));});
  await page.waitForFunction(()=>!document.querySelector('[data-sx-tenant-label],[data-sx-native-label-hidden]'));
  await context.close();cases++;
 }
 console.log(JSON.stringify({passed:true,cases,checks:['English and Arabic','owner and agent','two drawers','native click handler preserved','custom label search','account change isolation','defaults restored']}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
