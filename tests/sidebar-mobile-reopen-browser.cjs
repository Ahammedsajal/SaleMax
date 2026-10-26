'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const source=fs.readFileSync(process.env.SIDEBAR_SOURCE||path.join(__dirname,'../client/public/training-sidebar.js'),'utf8');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});let cycles=0;try{
for(const width of [330,360,412,899,1440])for(const ar of [false,true]){
const page=await browser.newPage({viewport:{width,height:800}});
await page.route('http://drawer.invalid/**',r=>r.fulfill({contentType:'application/json',body:'{"success":true,"data":{}}'}));
await page.goto('http://drawer.invalid/user?page=forms');
await page.setContent('<html dir="'+(ar?'rtl':'ltr')+'"><body><button id="open">Menu</button><div class="MuiDrawer-modal"><div class="MuiDrawer-paper" style="position:fixed;top:70px;left:0;width:330px"><div style="position:relative;height:60px"><button id="close" aria-label="Close menu" style="position:absolute;right:0;top:0;width:44px;height:44px">X</button></div><ul><li><button class="MuiListItemButton-root" aria-label="Dashboard"><span class="MuiListItemIcon-root"><svg></svg></span></button></li><li><button class="MuiListItemButton-root"><span class="MuiListItemText-primary">Inbox</span></button></li></ul></div></div></body></html>');
await page.evaluate(({ar})=>{localStorage.setItem('language',ar?'ar':'en');window.SaleMaxWorkspace={session:async()=>({role:'owner',categoryKey:'training_center',roleNavigation:['forms','dashboard','inbox'],assignedNavigation:null})};window.__sxRecruitmentLoader=window.__sxChatbotAdminLoader=window.__sxFaqManagerLoader=window.__sxTrainingFormsEditorLayoutLoader=true;document.querySelector('#close').onclick=()=>document.querySelector('.MuiDrawer-modal').style.display='none';document.querySelector('#open').onclick=()=>{document.querySelector('.MuiDrawer-modal').style.display='block';window.dispatchEvent(new Event('resize'));};},{ar});
await page.addScriptTag({content:source});await page.waitForFunction(()=>document.querySelector('.sx-sidebar-fallback-label'));
if(width<900){for(let i=0;i<10;i++){
await page.locator('#close').click();await page.locator('#open').click();
await page.waitForFunction(()=>!document.querySelector('.MuiDrawer-paper').hasAttribute('data-sx-sidebar-collapsed'),null,{timeout:1500});
assert.equal(await page.locator('.sx-sidebar-fallback-label').first().isVisible(),true,'icon label after reopen '+width+' cycle '+i);
assert.equal(await page.locator('.MuiListItemText-primary').first().isVisible(),true,'native label after reopen');cycles++;
}}else{
await page.locator('#close').click();assert.equal(await page.locator('.MuiDrawer-paper').getAttribute('data-sx-sidebar-collapsed'),'','desktop collapse override retained');
}
await page.close();}
console.log(JSON.stringify({passed:true,reopenCycles:cycles,widths:[330,360,412,899,1440],languages:['English','Arabic'],checks:['close X then reuse same drawer','native and icon-only labels','desktop collapse retained']}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
