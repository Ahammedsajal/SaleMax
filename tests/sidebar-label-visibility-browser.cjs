'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
const source=fs.readFileSync(process.env.SIDEBAR_SOURCE||path.join(__dirname,'../client/public/training-sidebar.js'),'utf8');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 let cases=0;
 try{
  for(const width of [330,412,1440])for(const arabic of [false,true]){
   const page=await browser.newPage({viewport:{width,height:900}});
   await page.route('http://sidebar.invalid/**',route=>route.fulfill({contentType:'application/json',body:'{"success":true,"data":{}}'}));
   await page.goto('http://sidebar.invalid/user?page=dashboard');
   await page.setContent('<html lang="'+(arabic?'ar':'en')+'" dir="'+(arabic?'rtl':'ltr')+'"><body><div class="MuiDrawer-paper" style="width:330px"><div><button aria-label="Expand menu">Expand</button></div><ul>'+
    '<li id="icon-only"><button class="MuiListItemButton-root" aria-label="Dashboard"><span class="MuiListItemIcon-root"><svg></svg></span></button></li>'+
    '<li id="native"><button class="MuiListItemButton-root"><span class="MuiListItemIcon-root"><svg></svg></span><span class="MuiListItemText-root"><span class="MuiListItemText-primary">Inbox</span></span></button></li>'+
    '<li id="legacy"><button class="MuiListItemButton-root"><span class="MuiListItemIcon-root"><svg></svg></span><span class="legacy-label">Phonebook</span></button></li>'+
    '</ul></div></body></html>');
   await page.evaluate(({arabic})=>{
    localStorage.setItem('language',arabic?'ar':'en');
    window.SaleMaxWorkspace={session:async()=>({role:'owner',categoryKey:'training_center',roleNavigation:['dashboard','inbox','contacts'],assignedNavigation:null}),invalidateSession(){}};
    window.__sxChatbotAdminLoader=window.__sxFaqManagerLoader=window.__sxTrainingFormsEditorLayoutLoader=window.__sxRecruitmentLoader=true;
   },{arabic});
   await page.addScriptTag({content:source});
   await page.waitForFunction(()=>document.querySelector('#icon-only .sx-sidebar-fallback-label'));
   const fallback=page.locator('#icon-only .sx-sidebar-fallback-label');
   assert.equal(await fallback.isVisible(),true,'icon-only menu row must have a visible label at '+width);
   assert.equal(await page.locator('#native .MuiListItemText-primary').isVisible(),true,'native label must remain visible');
   assert.equal(await page.locator('#native .sx-sidebar-fallback-label').count(),0,'native label must not be duplicated');
   assert.equal(await page.locator('#legacy .sx-sidebar-fallback-label').count(),0,'visible legacy text must not be duplicated');
   await page.evaluate(()=>{document.querySelector('.MuiDrawer-paper').style.width='72px';window.dispatchEvent(new Event('resize'));});
   await page.waitForFunction(()=>document.querySelector('.MuiDrawer-paper').hasAttribute('data-sx-sidebar-collapsed'));
   assert.equal(await fallback.isVisible(),false,'collapsed drawer must keep label hidden');
   await page.evaluate(()=>{document.querySelector('.MuiDrawer-paper').style.width='330px';window.dispatchEvent(new Event('resize'));});
   await page.locator('button[aria-label="Expand menu"]').click();
   await page.waitForFunction(()=>!document.querySelector('.MuiDrawer-paper').hasAttribute('data-sx-sidebar-collapsed'));
   assert.equal(await fallback.isVisible(),true,'reopened drawer must restore label');
   await page.close();cases++;
  }
  console.log(JSON.stringify({passed:true,cases,checks:['330/412/1440 widths','English/Arabic','icon-only fallback visible','native and legacy labels not duplicated','collapse and reopen']}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

