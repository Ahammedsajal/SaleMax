'use strict';
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {randomUUID} = require('node:crypto');
const mysql = require('mysql2/promise');
const express = require('express');

async function main() {
  const socketPath = process.env.INVENTORY_TEST_SOCKET;
  assert.match(socketPath || '', /^\/(?:private\/)?tmp\//);
  const database = 'inventory_test_' + randomUUID().replaceAll('-', '');
  const admin = await mysql.createConnection({socketPath, user: 'root'});
  await admin.query('CREATE DATABASE ' + database);
  const pool = mysql.createPool({socketPath, user: 'root', database});
  const tenant = randomUUID(), other = randomUUID(), item = randomUUID(), foreign = randomUUID();
  const category = require('../modules/platform/categories').getCategory('retail_boutique', 1);
  assert.equal(category.public, false);
  const app = express();
  const driverId=randomUUID(), secondDriver=randomUUID();
  const routes=require('../modules/platform/retail-commerce-router');
  function authenticate(req,res,next) {
    const role = req.get('x-test-role');
    if (!role) return res.sendStatus(401);
    req.businessContext = {audience: 'tenant', category, identity: {id: tenant},
      tenant: {id: tenant, status: 'active', categoryKey: category.key, categoryVersion: 1},
      membership: {id:req.get('x-test-driver')||driverId,tenantId: tenant, status: 'active', role},
      subscription: {status: 'active', capabilities: category.capabilities}};
    next();
  }
  process.env.LOCAL_ONLY_MODE='true';
  app.use('/business/:storeSlug/shop',routes.publicRouter({pool,origin:'http://127.0.0.1'}));
  app.use('/workspace/retail',routes.workspaceRouter({pool,authenticate}));
  app.get(['/user','/agent'],(req,res)=>{
    const role=['owner','manager','accountant','agent'].includes(req.query.role)?req.query.role:'owner';
    const roleNavigation=['retail-orders','retail-deliveries','retail-finance'].includes(req.query.page)?[req.query.page]:[];
    const permissions={'retail.configure':role==='owner','retail.orders':['owner','manager'].includes(role),
      'retail.deliver':role==='agent','retail.finance':['owner','accountant'].includes(role),
      'retail.cash.collect':['owner','manager'].includes(role),'leads.manage':role==='owner'};
    const access=JSON.stringify({role,roleNavigation,permissions});
    res.type('html').send(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><ul><li data-sx-stock-nav>Inventory</li></ul>
      <script>const access=${access};window.SaleMaxWorkspace={session:async()=>access,request:async(feature,path,options={})=>{const response=await fetch('/workspace/retail'+path,{...options,body:options.body?JSON.stringify(options.body):undefined,headers:{'Content-Type':'application/json','x-test-role':access.role,'x-test-driver':'${driverId}'}});const result=await response.json();if(!response.ok)throw Error(result.code||'REQUEST_FAILED');return result;}};</script>
      <script defer src="/retail-workspace.js"></script></body></html>`);
  });
  app.use(express.static(require('node:path').resolve(__dirname,'../client/public'),{index:false}));
  app.use(require('../modules/platform/business-inventory-router')({pool,authenticate}));
  let server;
  try {
    await pool.query('CREATE TABLE sx_product_catalog (id CHAR(36) PRIMARY KEY, tenant_id CHAR(36), code VARCHAR(40), name_en VARCHAR(200), name_ar VARCHAR(200), deleted_at DATETIME NULL, status VARCHAR(20)) ENGINE=InnoDB');
    await pool.query(readFileSync(require.resolve('../database/migrations/20270125_private_business_inventory.sql'), 'utf8'));
    const {splitSql}=require('../database/migration-runner');
    for(const statement of splitSql(readFileSync(require.resolve('../database/migrations/20270126_retail_commerce.sql'),'utf8'))) await pool.query(statement);
    for(const statement of splitSql(readFileSync(require.resolve('../database/migrations/20270127_retail_cash_and_returns.sql'),'utf8'))) await pool.query(statement);
    await pool.query("INSERT INTO sx_product_catalog VALUES (?,?,'TEST','Test item','عنصر تجريبي',NULL,'active'),(?,?,'OTHER','Other','آخر',NULL,'active')", [item, tenant, foreign, other]);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
    const send = (path, role, body) => fetch('http://127.0.0.1:' + server.address().port + path, {
      method: body ? 'POST' : 'GET',
      headers: {'content-type': 'application/json', ...(role && {'x-test-role': role})},
      body: body && JSON.stringify(body)
    });
    const payload = {requestId: randomUUID(), expectedRevision: '0', quantity: 12, reason: 'Opening stock'};
    const path = '/' + item + '/count';
    assert.equal((await send('/')).status, 401);
    assert.equal((await send('/', 'agent')).status, 403);
    assert.equal((await send(path, 'accountant', payload)).status, 403);
    assert.equal((await send('/' + foreign + '/count', 'owner', payload)).status, 404);
    const race = await Promise.all([send(path, 'owner', payload), send(path, 'manager', {...payload, requestId: randomUUID()})]);
    assert.deepEqual(race.map(result => result.status).sort(), [200, 409]);
    const winner = race[0].status === 200;
    if (winner) assert.equal((await send(path, 'owner', payload)).status, 200);
    const data = await (await send('/', 'accountant')).json();
    assert.deepEqual(data.data.items.map(product => [product.id, product.quantity]), [[item, 12]]);
    const history = await (await send('/' + item + '/history', 'owner')).json();
    assert.equal(history.data.length, 1);
    await pool.query("ALTER TABLE sx_product_catalog ADD description_en TEXT, ADD description_ar TEXT");
    await pool.query("CREATE TABLE sx_product_offers (id CHAR(36) PRIMARY KEY,tenant_id CHAR(36),course_id CHAR(36),price_minor INT,version INT,status VARCHAR(15),currency CHAR(3),valid_from DATE,valid_until DATE)");
    await pool.query("CREATE TABLE sx_tenants (id CHAR(36) PRIMARY KEY,status VARCHAR(15),category_key VARCHAR(40),category_version INT)");
    await pool.query("CREATE TABLE sx_plan_versions (id CHAR(36) PRIMARY KEY,status VARCHAR(15),category_key VARCHAR(40),category_version INT,capabilities JSON)");
    await pool.query("CREATE TABLE sx_plan_assignments (tenant_id CHAR(36),plan_version_id CHAR(36),current_tenant CHAR(36),status VARCHAR(15),effective_from DATETIME,expires_at DATETIME)");
    const plan=randomUUID();
    await pool.query("INSERT INTO sx_tenants VALUES (?,'active','retail_boutique',1)",[tenant]);
    await pool.query("INSERT INTO sx_plan_versions VALUES (?,'published','retail_boutique',1,?)",[plan,JSON.stringify(category.capabilities)]);
    await pool.query("INSERT INTO sx_plan_assignments VALUES (?,?,?,'active',UTC_TIMESTAMP()-INTERVAL 1 DAY,UTC_TIMESTAMP()+INTERVAL 1 DAY)",[tenant,plan,tenant]);
    await pool.query("INSERT INTO sx_product_offers VALUES (?,?,?,2500,1,'active','QAR',NULL,NULL)",[randomUUID(),tenant,item]);
    await pool.query("INSERT INTO sx_retail_store (tenant_id,slug,title,about,contact,enabled,delivery_fee,delivery_zones) VALUES (?,'test-retail','Synthetic','About','Contact',1,800,?)",[tenant,JSON.stringify([{name:'Central',feeMinor:800}])]);
    await pool.query("INSERT INTO sx_retail_listings (tenant_id,product_id,category,published) VALUES (?,?,'Fixtures',1)",[tenant,item]);
    const retail=require('../modules/platform/retail-commerce');
    const shop=await retail.browse(pool,'test-retail');
    assert.deepEqual(shop.items.map(row=>row.id),[item]);
    assert.equal(shop.store.tenantId,undefined);
    const cart={requestId:randomUUID(),name:'Synthetic buyer',phone:'55555555',fulfillment:'pickup',lines:[{id:item,quantity:12}],expectedTotal:30000};
    await assert.rejects(retail.checkout(pool,'test-retail',{...cart,expectedTotal:1}),{code:'PRICE_CHANGED'});
    const attempts=await Promise.allSettled([retail.checkout(pool,'test-retail',cart),retail.checkout(pool,'test-retail',{...cart,requestId:randomUUID()})]);
    const winning=attempts.findIndex(result=>result.status==='fulfilled');
    assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(attempts.find(result=>result.status==='rejected').reason.code,'STOCK_CHANGED');
    const order=attempts[winning].value;
    if(winning===0) assert.deepEqual(await retail.checkout(pool,'test-retail',cart),order);
    const reserved=await (await send('/','owner')).json();
    assert.equal(Number(reserved.data.items[0].reserved),12);
    assert.equal((await send(path,'owner',{requestId:randomUUID(),expectedRevision:reserved.data.items[0].revision,quantity:11,reason:'count'})).status,409);
    const actor={identityId:tenant,membershipId:randomUUID()};
    await assert.rejects(retail.transition(pool,tenant,actor,order.reference,'completed',true),{code:'ORDER_NOT_FOUND'});
    await retail.transition(pool,tenant,actor,order.reference,'cancelled',false);
    assert.equal((await retail.browse(pool,'test-retail')).items[0].available,true);
    const pickup=await retail.checkout(pool,'test-retail',{...cart,requestId:randomUUID(),lines:[{id:item,quantity:2}],expectedTotal:5000});
    await retail.transition(pool,tenant,actor,pickup.reference,'ready',false);
    await assert.rejects(retail.transition(pool,tenant,actor,pickup.reference,'completed',false),{code:'CASH_RECEIPT_REQUIRED'});
    await retail.recordCashReceipt(pool,tenant,actor,pickup.reference,{requestId:randomUUID(),amountMinor:5000});
    await retail.transition(pool,tenant,actor,pickup.reference,'completed',false);
    const fulfilled=await (await send('/','owner')).json();
    assert.equal(fulfilled.data.items[0].quantity,10);
    assert.equal(Number(fulfilled.data.items[0].reserved),0);
    await pool.query('CREATE TABLE sx_identities (id CHAR(36) PRIMARY KEY,display_name VARCHAR(100),status VARCHAR(12))');
    await pool.query('CREATE TABLE sx_memberships (id CHAR(36) PRIMARY KEY,tenant_id CHAR(36),identity_id CHAR(36),role VARCHAR(15),status VARCHAR(15))');
    await pool.query("INSERT INTO sx_identities VALUES (?,'Synthetic driver','active')",[driverId]);
    await pool.query("INSERT INTO sx_memberships VALUES (?,?,?,'agent','active')",[driverId,tenant,driverId]);
    const base='http://127.0.0.1:'+server.address().port;
    const orderPath='/business/test-retail/shop';
    assert.match(await (await fetch(base+orderPath)).text(),/id="shop"/);
    assert.equal((await fetch(base+orderPath+'/catalog')).status,200);
    const publicPost=(path,body,origin='http://127.0.0.1')=>fetch(base+orderPath+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const deliveryInput={...cart,requestId:randomUUID(),fulfillment:'delivery',address:'Synthetic delivery point',zone:'Central',lines:[{id:item,quantity:2}],expectedTotal:5800};
    assert.equal((await publicPost('/checkout',deliveryInput,'https://foreign.invalid')).status,403);
    const delivery=await (await publicPost('/checkout',deliveryInput)).json();
    assert.ok(delivery.success);
    const orderId=delivery.data.reference;
    assert.deepEqual((await (await publicPost('/track',{reference:orderId})).json()).data,{status:'placed'});
    const workspace=(path,role,method='GET',body,driver=driverId)=>fetch(base+'/workspace/retail'+path,{method,
      headers:{'Content-Type':'application/json','x-test-role':role,'x-test-driver':driver},body:body&&JSON.stringify(body)});
    assert.equal((await workspace('/orders/'+orderId+'/driver','owner','PUT',{driverId})).status,200);
    assert.equal((await workspace('/orders/'+orderId+'/status','owner','POST',{status:'ready'})).status,200);
    assert.equal((await (await workspace('/deliveries','agent','GET',null,secondDriver)).json()).data.length,0);
    assert.equal((await workspace('/deliveries/'+orderId+'/status','agent','POST',{status:'dispatched'},secondDriver)).status,404);
    assert.equal((await workspace('/deliveries/'+orderId+'/status','agent','POST',{status:'dispatched'})).status,200);
    await assert.rejects(retail.transition(pool,tenant,{identityId:tenant,membershipId:driverId},orderId,'completed',true),{code:'CASH_RECEIPT_REQUIRED'});
    const receiptRequest={requestId:randomUUID(),amountMinor:5800};
    if(process.env.RETAIL_BROWSER==='true'){
      const browser=await require('playwright').chromium.launch({channel:'msedge',headless:true});
      try {
        const driverPage=await browser.newPage({viewport:{width:390,height:844},colorScheme:'dark'});
        await driverPage.addInitScript(()=>localStorage.setItem('language','ar'));
        driverPage.on('dialog',dialog=>dialog.accept());
        await driverPage.goto(base+'/agent?page=retail-deliveries&role=agent');
        await driverPage.getByRole('heading',{name:/عمليات التوصيل/}).waitFor();
        await driverPage.getByRole('link',{name:'Google Maps'}).waitFor();
        await driverPage.getByRole('link',{name:'Waze'}).waitFor();
        await driverPage.screenshot({path:'/private/tmp/7network-retail-driver-ar-dark-390.png',fullPage:true});
        await driverPage.getByRole('button',{name:'تسجيل تحصيل المبلغ نقداً'}).click();
        await driverPage.getByRole('button',{name:'مكتمل'}).click();
        assert.equal(await driverPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        await driverPage.close();
        for(const [width,role,language,scheme] of [[390,'accountant','ar','dark'],[1440,'owner','en','light']]){
          const page=await browser.newPage({viewport:{width,height:900},colorScheme:scheme});
          await page.addInitScript(value=>localStorage.setItem('language',value),language);
          await page.goto(base+'/user?page=retail-finance&role='+role);
          await page.getByRole('heading',{name:language==='ar'?'تسوية النقد':'Cash reconciliation'}).waitFor();
          assert.equal(await page.locator('#sx-retail-workspace').getAttribute('dir'),language==='ar'?'rtl':'ltr');
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          await page.screenshot({path:`/private/tmp/7network-retail-finance-${language}-${scheme}-${width}.png`,fullPage:true});
          await page.close();
        }
      } finally {await browser.close();}
    }
    assert.equal((await workspace('/deliveries/'+orderId+'/cash-received','agent','POST',receiptRequest,secondDriver)).status,404);
    assert.equal((await workspace('/orders/'+orderId+'/cash-received','agent','POST',receiptRequest,secondDriver)).status,404);
    assert.equal((await workspace('/deliveries/'+orderId+'/cash-received','agent','POST',{...receiptRequest,amountMinor:5700})).status,409);
    assert.equal((await workspace('/deliveries/'+orderId+'/cash-received','agent','POST',receiptRequest)).status,200);
    assert.equal((await workspace('/deliveries/'+orderId+'/cash-received','agent','POST',receiptRequest)).status,200);
    assert.equal((await workspace('/deliveries/'+orderId+'/status','agent','POST',{status:'completed'})).status,200);
    assert.equal((await workspace('/finance','manager')).status,403);
    assert.equal((await workspace('/finance','agent')).status,403);
    const finance=await (await workspace('/finance','accountant')).json();
    assert.equal(finance.data.drivers[0].expectedMinor,5800);
    assert.equal(finance.data.drivers[0].orders[0].id,orderId);
    const mismatch={requestId:randomUUID(),driverId,orderIds:[orderId],countedMinor:5700};
    assert.equal((await workspace('/finance/settlements','accountant','POST',mismatch)).status,200);
    const mismatchView=await (await workspace('/finance','owner')).json();
    assert.equal(mismatchView.data.settlements[0].status,'variance');
    assert.equal(mismatchView.data.drivers[0].orders[0].id,orderId);
    const settlement={requestId:randomUUID(),driverId,orderIds:[orderId],countedMinor:5800};
    const settlementRetries=await Promise.all([
      workspace('/finance/settlements','accountant','POST',settlement),
      workspace('/finance/settlements','accountant','POST',settlement)
    ]);
    assert.deepEqual(settlementRetries.map(response=>response.status),[200,200]);
    const settled=await (await workspace('/finance','owner')).json();
    assert.equal(settled.data.drivers.length,0);
    assert.equal(settled.data.settlements[0].status,'matched');
    const returnRequest={requestId:randomUUID(),reason:'Synthetic partial return',restock:true,lines:[{id:item,quantity:1}]};
    assert.equal((await workspace('/orders/'+orderId+'/returns','owner','POST',returnRequest)).status,200);
    const partial=await (await send('/','owner')).json();
    assert.equal(partial.data.items[0].quantity,9);
    assert.equal((await workspace('/orders/'+orderId+'/returns','owner','POST',{...returnRequest,lines:[{id:item,quantity:2}]})).status,409);
    assert.equal((await workspace('/orders/'+orderId+'/status','owner','POST',{status:'returned'})).status,200);
    assert.equal((await workspace('/orders/'+orderId+'/status','owner','POST',{status:'returned'})).status,200);
    const afterReturn=await (await send('/','owner')).json();
    assert.equal(afterReturn.data.items[0].quantity,10);
    if(process.env.RETAIL_BROWSER==='true'){
      const browser=await require('playwright').chromium.launch({channel:'msedge',headless:true});
      try {
        for(const [width,lang,colorScheme] of [[390,'ar','dark'],[1440,'en','light']]){
          const page=await browser.newPage({viewport:{width,height:900},colorScheme});
          await page.goto(base+orderPath+'?lang='+lang);
          await page.getByRole('heading',{name:'Synthetic',exact:true}).waitFor();
          assert.equal(await page.locator('html').getAttribute('dir'),lang==='ar'?'rtl':'ltr');
          await page.getByRole('button',{name:lang==='ar'?'المنتجات':'Menu',exact:true}).click();
          await page.getByRole('button',{name:lang==='ar'?'إضافة إلى السلة':'Add to cart',exact:true}).click();
          await page.getByRole('button',{name:lang==='ar'?'السلة (1)':'Cart (1)',exact:true}).click();
          await page.getByRole('button',{name:lang==='ar'?'إتمام الطلب':'Checkout',exact:true}).click();
          assert.ok(await page.locator('main form').isVisible());
          assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
          await page.close();
        }
      } finally {await browser.close();}
    }
    console.log('Inventory and commerce migrations, tenant and role denial, stock race, price changes, reservations, cancellation and fulfillment passed');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end();
    await admin.query('DROP DATABASE ' + database);
    await admin.end();
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
