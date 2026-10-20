'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {chromium}=require('playwright');
const root=path.join(__dirname,'../client/public');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});let cases=0;try{
 for(const lang of ['en','ar'])for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(5000);const requests=[],definition={key:'cf_text_0123456789abcdef',type:'text',label:{en:'Account reference',ar:'مرجع الحساب'},active:true,required:true,version:1};
  await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());let data={};
   if(url.pathname==='/pipeline/')return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,'pipeline/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'')});
   if(!url.pathname.startsWith('/api/'))return route.fulfill({body:'',contentType:url.pathname.endsWith('.css')?'text/css':'text/plain'});
   if(url.pathname.endsWith('/board'))data={leads:[],stages:[{stage_key:'new',title:'New',position:0,leads:[]}],agents:[],role:'owner',categoryKey:'training_center',total:0,customFieldContract:{revision:7,fields:[definition]}};
   if(url.pathname.endsWith('/filter-options'))data={qrInstances:[]};if(url.pathname.endsWith('/course-options')||url.pathname.endsWith('/contacts/matches'))data=[];
   if(url.pathname.endsWith('/leads')&&req.method()==='POST'){requests.push(req.postDataJSON());data={id:'synthetic-lead'};}
   return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data})});
  });
  await page.goto('http://127.0.0.1/pipeline/');await page.evaluate(lang=>{localStorage.setItem('wacrm_user','synthetic');localStorage.setItem('language',lang);document.documentElement.lang=lang;},lang);
  for(const name of ['pipeline/lead-fields.js','pipeline/pipeline.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,name),'utf8')});
  await page.locator('#addBtn').click();await page.locator('[data-tenant-lead-fields] input').waitFor();
  await page.locator('#newLead [name=title]').fill('Synthetic custom lead');await page.locator('#newLead [name=contactName]').fill('Synthetic person');await page.locator('#newLead [name=mobile]').fill('+12025550199');
  const custom=page.locator('[data-tenant-lead-fields] input');await custom.fill('Reference A');
  assert.equal(await page.locator('.modal-foot [data-tenant-lead-fields]').count(),0,'fields remain outside action footer');
  await page.locator('#newLead .primary').click();await page.waitForFunction(()=>document.querySelector('#modal').classList.contains('hidden'));
  assert.equal(requests.length,1);assert.deepEqual(requests[0].customFields,{configurationRevision:7,values:{[definition.key]:'Reference A'}});assert.equal(requests[0][definition.key],undefined);
  await page.close();cases++;
 }
 console.log(JSON.stringify({passed:true,cases,checks:['actual existing Pipeline Add Lead form','English Arabic','desktop mobile','typed contract rendered','existing submit serializes custom fields','separate namespace']}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
