'use strict';
// Exercise the actual sidebar builders and observer with synthetic sessions.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const source=fs.readFileSync(path.join(__dirname,'../client/public/training-sidebar.js'),'utf8');
const oldSource=process.env.SIDEBAR_SOURCE&&fs.readFileSync(process.env.SIDEBAR_SOURCE,'utf8');
const keys=['dashboard','leads','reports','call-center','tasks','sales-targets','sales-deals','sales-commissions','sales-organization','commission-policy','sales-audit','sales-finance','recruitment','team'];
const row=(name,attrs='')=>`<li ${attrs}><button class="MuiListItemButton-root"><span class="MuiListItemText-primary">${name}</span></button></li>`;
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 let cases=0;
 try{
  for(const role of ['owner','manager','team_leader','agent','accountant'])for(const ar of [false,true])for(const delayed of [false,true]){
   const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(5000);
   await page.route('http://sidebar.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<html><head></head><body></body></html>'}));
   await page.goto('http://sidebar.invalid/user?page=dashboard');
   await page.setContent(`<html lang="${ar?'ar':'en'}" dir="${ar?'rtl':'ltr'}"><body>`+[0,1].map(()=>`<div class="MuiDrawer-paper" style="width:250px"><input><ul>${row('Dashboard')}${delayed?'':row('Lead Pipeline','data-salemax-pipeline-link="1"')}${row('WA Chatbot')}</ul></div>`).join('')+'</body></html>');
   const allowed=role==='accountant'?['sales-finance','sales-commissions']:role==='owner'?keys:keys.filter(k=>!['commission-policy','sales-audit','recruitment','team'].includes(k));
   await page.evaluate(({role,allowed,delayed})=>{
    window.fixtureAccess={role,categoryKey:'salemax_sales',roleNavigation:allowed,assignedNavigation:null};
    window.SaleMaxWorkspace={session:async()=>{if(delayed)await new Promise(resolve=>setTimeout(resolve,60));return window.fixtureAccess;}};
    window.__sxChatbotAdminLoader=window.__sxFaqManagerLoader=window.__sxTrainingFormsEditorLayoutLoader=true;
   },{role,allowed,delayed});
   await page.addScriptTag({content:oldSource||source});
   await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-sx-navigation-loading'));
   await page.waitForFunction(()=>document.querySelector('[data-sx-sales-commissions-nav],[data-sx-canonical-sales-nav="sales-commissions"]'));
   if(delayed){
    await page.evaluate(({row})=>{for(const list of document.querySelectorAll('.MuiDrawer-paper ul'))list.insertAdjacentHTML('beforeend',row);},{row:row('Lead Pipeline','data-salemax-pipeline-link="1"')});
    if(role!=='accountant')await page.waitForFunction(()=>document.querySelector('[data-sx-sales-targets-nav]'));
   }
   const inspect=()=>page.evaluate(()=>[...document.querySelectorAll('.MuiDrawer-paper ul')].map(list=>({
    labels:[...list.children].filter(r=>r.tagName==='LI'&&!r.hasAttribute('data-sx-nav-section')&&!r.hasAttribute('data-sx-search-hidden')&&!r.hidden).map(r=>r.querySelector('.MuiListItemText-primary')?.textContent),
    sections:[...list.querySelectorAll('[data-sx-sales-section]')].map(r=>r.dataset.sxSalesSection),
    inherited:list.querySelectorAll('[data-sx-canonical-sales-nav][data-sx-sales-commissions-nav],[data-sx-sales-finance-nav][data-sx-canonical-sales-nav]').length
   })));
   const check=async()=>{for(const drawer of await inspect()){
    assert.equal(new Set(drawer.labels).size,drawer.labels.length,`duplicate ${role} ${ar} delayed=${delayed}: ${drawer.labels}`);
    assert.equal(drawer.inherited,0,'new rows must not inherit template identities');
    if(role!=='accountant')for(const section of ['overview','targets','reports','deals','commissions'])assert.ok(drawer.sections.includes(section),`${role} must retain ${section}`);
   }};
   await check();
   // Native React rows can mount after fallback generation; their handlers win.
   await page.evaluate(({row})=>{for(const list of document.querySelectorAll('.MuiDrawer-paper ul'))list.insertAdjacentHTML('afterbegin',row);},{row:row(ar?'مالية المبيعات':'Sales Finance','data-native-fixture="1"')});
   await page.waitForFunction(()=>[...document.querySelectorAll('.MuiDrawer-paper ul')].every(list=>!list.querySelector('[data-sx-sales-finance-nav],[data-sx-canonical-sales-nav="sales-finance"]')));
   await check();
   // Repeated focus, resize, search and DOM mutations must not recreate copies.
   for(let i=0;i<4;i++){
    await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('resize'));document.body.append(document.createElement('i'));});
    await page.locator('.MuiDrawer-paper input').first().fill('Finance');
    await page.locator('.MuiDrawer-paper input').first().fill('');
   }
   await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-sx-navigation-loading'));
   await check();
   // Revocation hides the retained destination, even when it is a native row.
   await page.evaluate(()=>{window.fixtureAccess.assignedNavigation=window.fixtureAccess.roleNavigation.filter(k=>k!=='sales-finance');window.dispatchEvent(new Event('focus'));});
   await page.waitForFunction(()=>[...document.querySelectorAll('[data-native-fixture]')].every(r=>r.hasAttribute('data-sx-search-hidden')));
   await page.close();cases++;
  }
  console.log(JSON.stringify({passed:true,cases,checks:['five roles','English and Arabic','two drawers','both session load orders','distinct overview/targets/reports','late native mount','repeat focus resize search mutation','permission revocation']}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
