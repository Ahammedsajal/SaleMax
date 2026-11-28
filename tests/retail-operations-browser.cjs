'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.SALEMAX_PLAYWRIGHT_PATH || 'playwright');
const publicDir = path.join(__dirname, '../client/public');
const key = 'a'.repeat(64);

async function verify(browser, language, width, role) {
  const page = await browser.newPage({viewport:{width,height:850}, colorScheme:language==='ar'?'dark':'light'});
  try {
    const errors=[];
    page.on('pageerror', error=>errors.push(error.message));
    await page.addInitScript(({language,role,key})=>{
      localStorage.setItem('language',language);
      const access = role==='accountant'?[]:['retail-customers','retail-orders'];
      const customer={id:key,name:'Demo Buyer',email:'demo@example.invalid',phone:'00001234',orderCount:2};
      window.SaleMaxWorkspace={
        session:async()=>({role,permissions:{'retail.orders':true,'retail.customers.read':true},roleNavigation:access}),
        request:async(module,route,options)=>{
          window.lastRetailRequest={module,route,options};
          if(route.startsWith('/customers?'))return {data:{items:[customer],limit:20,total:1,page:1}};
          if(route.startsWith('/customers/'))return {data:{...customer,orders:[{id:'11',provider:'woocommerce',storeName:'Demo Shop',currency:'QAR',total:'260',breakdown:{shipping:'20'},status:'processing'}]}};
          if(route==='/drivers')return {data:[]};
          if(route==='/orders/search')return {data:{orders:[{id:'demo-01',status:'ready',fulfillment:'delivery',lines:[],totalMinor:'1000'}]}};
          throw Error('Unexpected fixture request');
        }
      };
    },{language,role,key});
    await page.route('https://retail.test/**',route=>{
      const url=new URL(route.request().url());
      if(['/agent','/user'].includes(url.pathname))return route.fulfill({contentType:'text/html',body:'<meta charset=utf-8><meta name="viewport" content="width=device-width, initial-scale=1"><script defer src="/retail-workspace.js"></script>'});
      const css=url.pathname==='/retail-workspace.css';
      if(css||url.pathname==='/retail-workspace.js')return route.fulfill({contentType:css?'text/css':'application/javascript',body:fs.readFileSync(path.join(publicDir,url.pathname.slice(1)))});
      return route.abort();
    });
    const entry='https://retail.test/'+(role==='owner'?'user':'agent');
    await page.goto(entry+'?page=retail-orders');
    const root=page.locator('#sx-retail-workspace');
    if(role==='accountant'){assert.equal(await root.count(),0);assert.equal(await page.evaluate(()=>window.lastRetailRequest),undefined);return;}
    const queue=root.locator('select').filter({has:page.locator('option[value="delivery_attention"]')});
    await queue.selectOption('delivery_attention');
    await root.locator('form button[type=submit]').click();
    assert.equal((await page.evaluate(()=>window.lastRetailRequest)).options.body.queue,'delivery_attention');
    const open=root.locator('.sx-retail-open-drawer');
    await open.click();
    await page.getByRole('dialog').waitFor({timeout:2500});
    assert.ok(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.keyboard.press('Escape');
    assert.ok(await open.evaluate(el=>document.activeElement===el));
    await page.goto(entry+'?page=retail-customers');
    await root.locator('option[value=returning]').waitFor({state:'attached'});
    await root.locator('form select').selectOption('returning');
    await root.locator('form input').nth(1).fill('SA-11');
    await root.locator('form button[type=submit]').click();
    const query=new URLSearchParams((await page.evaluate(()=>window.lastRetailRequest)).route.split('?')[1]);
    assert.equal(query.get('segment'),'returning');assert.equal(query.get('order'),'SA-11');
    await root.locator('.sx-retail-customer-open').click();
    await root.locator('.sx-retail-customer-order-details summary').click();
    assert.match(await root.innerText(),/Demo Shop/);
    assert.match(await root.innerText(),language==='ar'?/الشحن/:/Shipping/);
    await root.locator('.sx-retail-customer-detail-toolbar button').click();
    await root.locator('.sx-retail-customer-open').waitFor();
    assert.equal(await root.locator('form select').inputValue(),'returning');
    assert.ok(await root.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
}
(async()=>{
  const browser=await chromium.launch({channel:'msedge'});
  try{
    for(const [language,width,role] of [['en',1440,'owner'],['ar',390,'manager'],['en',320,'manager'],['ar',768,'owner'],['en',390,'accountant']])await verify(browser,language,width,role);
    console.log('Orders, directory, profile, return navigation, and denied role passed in Edge.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
