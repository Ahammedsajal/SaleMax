'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require(process.env.SALEMAX_PLAYWRIGHT_PATH||'playwright');
const script=fs.readFileSync(path.join(__dirname,'../client/public/business-inventory.js'));
let fixture;
const app=http.createServer((req,res)=>{
  if(req.url==='/business-inventory.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(script);}
  if(req.url.startsWith('/user?')){
    const state=JSON.stringify(fixture);
    const setup=`<script>
      const fixture=${state};
      localStorage.setItem('language',fixture.language);
      document.documentElement.dataset.sxTheme=fixture.theme;
      window.SaleMaxWorkspace={
        session:async()=>({modules:{inventory:true},roleNavigation:['business-inventory'],permissions:{'inventory.manage':true,'retail.configure':false}}),
        request:async(module,route)=>{
          if(module==='inventory'&&route==='/locations')return {data:[fixture.location]};
          if(module==='inventory'&&route.startsWith('/?')){window.lastInventoryQuery=route;return {data:{items:[fixture.item],hasMore:false}};}
          throw Error('Unexpected inventory request '+route);
        }
      };
    </script>`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    return res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+setup+'<script defer src="/business-inventory.js"></script>');
  }
  res.writeHead(404).end();
});
const location={id:'11111111-1111-4111-8111-111111111111',code:'doha',nameEn:'Doha showroom',nameAr:'معرض الدوحة',status:'active',isDefault:true,address:'Doha'};
const item={id:'22222222-2222-4222-8222-222222222222',code:'LINEN-M',nameEn:'Linen shirt',nameAr:'قميص كتان',quantity:'4',reserved:'1',availableQuantity:'3',
  quantityPrecision:0,quantityIncrement:'1',lowStock:true,lowStockThreshold:'3',thresholdRevision:1,unitRevision:0};
async function verify(browser,{language,width,theme}){
  fixture={language,width,theme,location,item};
  const page=await browser.newPage({viewport:{width,height:860},colorScheme:theme});
  try{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://127.0.0.1:'+app.address().port+'/user?page=business-inventory');
    const root=page.locator('#sx-business-inventory');
    await root.getByText(language==='ar'?'قميص كتان':'Linen shirt').waitFor();
    assert.equal(await root.getAttribute('dir'),language==='ar'?'rtl':'ltr');
    assert.equal(await root.getByText(language==='ar'?'3 وحدات':'3 units').count(),1);
    const locations=root.locator('details').filter({hasText:language==='ar'?'إدارة المواقع':'Manage locations'});
    await locations.locator('summary').click();
    await root.getByLabel(language==='ar'?'الاسم بالإنجليزية':'Name in English').fill('West Bay showroom');
    assert.equal(await root.getByLabel(language==='ar'?'رمز الموقع':'Location code').inputValue(),'west-bay-showroom');
    await root.getByLabel(language==='ar'?'المخزون المنخفض فقط':'Low stock only').check();
    await page.waitForFunction(()=>window.lastInventoryQuery?.includes('lowStock=1'));
    assert.ok(await root.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    assert.deepEqual(errors,[]);
  }catch(error){console.error('Inventory fixture state',await page.locator('body').innerText());throw error;}
  finally{await page.close();}
}
(async()=>{
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge'});
  try{
    for(const screen of [{language:'en',width:1440,theme:'light'},{language:'ar',width:390,theme:'dark'},{language:'en',width:320,theme:'dark'}])await verify(browser,screen);
    console.log('Inventory location setup, product stock, low-stock filtering and RTL reflow passed in Edge.');
  }finally{await browser.close();await new Promise(resolve=>app.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
