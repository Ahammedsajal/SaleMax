'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const read=name=>fs.readFileSync(path.join(__dirname,'../client/public',name),'utf8');
const fields=[{key:'courses',label:{en:'Courses',ar:'الدورات'}},{key:'inbox',label:{en:'Inbox',ar:'صندوق الوارد'}}];
const categoryLeadField={key:'cf_text_0123456789abcdef',type:'text',label:{en:'Property reference',ar:'مرجع العقار'},required:false,active:true,version:1};
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});let cases=0;try{
 for(const language of ['en','ar'])for(const auth of ['cookie','bearer'])for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(7000);
  const baseLabels={courses:{en:'Courses',ar:'الدورات'},inbox:{en:'Inbox',ar:'صندوق الوارد'}};
  const resolveView=(doc,revision=0)=>{const labels={...baseLabels,...(doc?.navigationLabels||{})},provenance={};for(const [key,value]of Object.entries(labels))for(const lang of Object.keys(value))provenance[`navigationLabels.${key}.${lang}`]=doc?.navigationLabels?.[key]?.[lang]?{scope:'tenant',revision}:{scope:'platform'};const hasLeadFieldOverride=!!doc&&Object.hasOwn(doc,'leadFields'),value={schemaVersion:doc?.schemaVersion||3,navigationLabels:labels,leadFields:hasLeadFieldOverride?doc.leadFields:[categoryLeadField],hiddenNavigation:doc?.hiddenNavigation||[]};provenance.leadFields=hasLeadFieldOverride?{scope:'tenant',revision}:{scope:'category_version',categoryKey:'real_estate',categoryVersion:1};for(const name of ['hiddenNavigation'])provenance[name]=doc&&Object.hasOwn(doc,name)?{scope:'tenant',revision}:{scope:'platform'};return {value,provenance,deleted:{}};};
  let state={revision:0,active:null,draft:null,defaults:{schemaVersion:3,navigationLabels:{},leadFields:[],hiddenNavigation:[]},inherited:resolveView(null).value,resolved:resolveView(null),fields,history:[]},conflict=false;const requests=[],documents=new Map();
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   const respond=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
   if(url.pathname==='/user')return route.fulfill({contentType:'text/html',body:`<html lang="${language}"><body><nav><li data-sx-profile-nav><button><span>Center profile</span></button></li></nav></body></html>`});
   if(url.pathname==='/api/user/business-auth/me')return respond({context:{audience:'tenant',tenant:{id:'tenant-a',name:'Synthetic business A'}},csrfToken:'synthetic-csrf'});
   if(url.pathname==='/api/crm/appearance')return respond({success:true,data:{branding:{revision:0,logoUrl:''},domain:null}});
   if(url.pathname==='/api/crm/branding')return respond({success:true,data:{revision:0,logoUrl:''}});
   if(!url.pathname.startsWith('/api/workspace/customization'))return respond({success:false},404);
   const body=req.method()==='GET'?{}:req.postDataJSON();requests.push({path:url.pathname,body,headers:req.headers()});
   if(conflict&&req.method()==='PUT')return respond({success:false,code:'STALE_CUSTOMIZATION_REVISION'},409);
   if(url.pathname.endsWith('/preview'))return respond({success:true,data:{document:body.document,resolved:resolveView(body.document),readOnly:true}});
   if(req.method()==='GET')return respond({success:true,data:{...state,draftResolved:state.draft?resolveView(state.draft.document,state.revision):null}});
   assert.equal(body.expectedRevision,state.revision);
   assert.equal(body.tenantId,undefined);
   state.revision++;
   const id=`00000000-0000-4000-8000-${String(state.revision).padStart(12,'0')}`;
   if(url.pathname.endsWith('/draft'))state.draft={id,document:body.document};
   else{
    const document=url.pathname.endsWith('/rollback')?documents.get(body.targetId):state.draft.document;
    assert.ok(document);state.active={id,document};state.resolved=resolveView(document,state.revision);state.draft=null;documents.set(id,document);state.history.unshift({id,revision:state.revision,createdAt:'2026-10-20T10:00:00Z'});
   }
   return respond({success:true,data:{revision:state.revision,id}});
  });
  await page.goto('http://127.0.0.1/user?page=crm-appearance');
  await page.evaluate(({auth})=>{if(auth==='bearer')localStorage.setItem('wacrm_user','synthetic-owner');window.publishEvents=0;window.addEventListener('salemax:customization-published',()=>window.publishEvents++);},{auth});
  for(const name of ['workspace-api.js','lead-field-editor.js','tenant-customization.js','tenant-crm-appearance.js'])await page.addScriptTag({content:read(name)});
  const panel=page.locator('[data-sx-customization]');await panel.locator('form').waitFor();await panel.locator('[data-resolved-settings] summary').click();assert.ok(await panel.locator('[data-resolved-settings]').textContent());await panel.locator('form > details').first().locator('summary').click();
  assert.equal(await panel.locator('[data-lead-field-editor] input[data-field-language="en"]').first().inputValue(),'Property reference');assert.equal(await panel.locator('[data-lead-field-editor] input[data-field-language="ar"]').first().inputValue(),'مرجع العقار');
  await panel.locator('[data-hide-navigation][value="inbox"]').check();
  await panel.locator('form > details').nth(1).locator('summary').click();
  const field=panel.locator('[data-label-key="courses"]');await field.locator('[data-en]').fill('Programmes A');await field.locator('[data-ar]').fill('برامج أ');assert.equal(await panel.locator('[data-publish]').isDisabled(),true);
  await panel.locator('[data-preview]').click();await panel.locator('[data-preview-result] li').first().waitFor();assert.ok((await panel.locator('[data-hidden-preview]').textContent()).includes(language==='ar'?'صندوق الوارد':'Inbox'));assert.ok((await panel.locator('[data-preview-result]').textContent()).includes(language==='ar'?'إعداد المنصة الافتراضي':'Platform default'));assert.equal(state.revision,0,'preview has no write effect');
  await panel.locator('button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('[data-publish]').disabled);
  await panel.locator('[data-publish]').click();await page.waitForFunction(()=>window.publishEvents===1);await panel.locator('form').waitFor();assert.equal(state.active.document.navigationLabels.courses.en,'Programmes A');assert.deepEqual(state.active.document.hiddenNavigation,['inbox']);assert.equal(Object.hasOwn(state.active.document,'leadFields'),false,'unchanged category fields stay inherited');const firstPublished=state.active.id;
  await panel.locator('[data-defaults]').click();assert.equal(await panel.locator('[data-lead-field-editor] input[data-field-language="en"]').first().inputValue(),'Property reference');assert.equal(await panel.locator('[data-lead-field-editor] input[data-field-language="ar"]').first().inputValue(),'مرجع العقار');await panel.locator('button[type="submit"]').click();await page.waitForFunction(()=>!document.querySelector('[data-publish]').disabled);await panel.locator('[data-publish]').click();await page.waitForFunction(()=>window.publishEvents===2);assert.deepEqual(state.active.document.navigationLabels,{});assert.deepEqual(state.active.document.hiddenNavigation,[]);assert.equal(Object.hasOwn(state.active.document,'leadFields'),false);
  await panel.locator('[data-history]').selectOption(firstPublished);await panel.locator('[data-restore]').click();await page.waitForFunction(()=>window.publishEvents===3);assert.equal(state.active.document.navigationLabels.courses.en,'Programmes A');
  await panel.locator('form > details').nth(1).locator('summary').click();
  if(process.env.CUSTOMIZATION_BROWSER_EVIDENCE){fs.mkdirSync(process.env.CUSTOMIZATION_BROWSER_EVIDENCE,{recursive:true});await page.screenshot({path:path.join(process.env.CUSTOMIZATION_BROWSER_EVIDENCE,`${language}-${auth}-${width}.png`),fullPage:true});}
  conflict=true;await panel.locator('[data-label-key="courses"] [data-en]').fill('Unsaved A');await panel.locator('button[type="submit"]').click();await panel.locator('[data-message][role="alert"]').waitFor();assert.equal(state.active.document.navigationLabels.courses.en,'Programmes A');
  for(const request of requests){if(auth==='bearer')assert.equal(request.headers.authorization,'Bearer synthetic-owner');else if(request.body.document||request.path.endsWith('/publish')||request.path.endsWith('/rollback'))assert.equal(request.headers['x-csrf-token'],'synthetic-csrf');}
  await context.close();cases++;
 }
 console.log(JSON.stringify({passed:true,cases,checks:['existing appearance screen','English Arabic','desktop mobile','bearer cookie client','preview no mutation','draft then publish','restore defaults','historical rollback','stale revision error','published event refresh']}));
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
