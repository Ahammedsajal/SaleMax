'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const pack=require('../modules/platform/chatbot-domain-packs').getDomainPack('training_center',1),script=fs.readFileSync(path.join(__dirname,'../client/public/chatbot-admin.js'),'utf8'),a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});let cases=0;try{for(const lang of ['en','ar'])for(const width of [390,1280])for(const mode of ['selected','disabled']){
 const page=await browser.newPage({viewport:{width,height:950}});page.setDefaultTimeout(8000);const writes=[],previews=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());let data={};
  if(url.pathname==='/user')return route.fulfill({contentType:'text/html',body:'<html><body><main><div class="react-flow">Automation Flows</div></main></body></html>'});
  if(!url.pathname.startsWith('/api/'))return route.fulfill({body:''});
  if(url.pathname==='/api/user/chatbots')data={category:'training_center',categoryVersion:1,categoryTitle:{en:'Training center',ar:'مركز تدريب'},guidedContentDefaults:pack.guidedContentDefaults,guidedContentSchema:pack.guidedContentSchema,captureFormsSupported:true,captureForms:[{id:a,nameEn:'Enquiry A',nameAr:'استفسار أ',customFieldCount:2},{id:b,nameEn:'Enquiry B',nameAr:'استفسار ب',customFieldCount:1}],items:[{id:'bot-a',name:'Synthetic Bot A',engine:'guided',status:'draft',revision:1,config:{guidedMode:'domain_default',captureFormId:a},channels:[]},{id:'bot-b',name:'Synthetic Bot B',engine:'guided',status:'draft',revision:1,config:{guidedMode:'domain_default',captureFormId:b},channels:[]}]};
  if(url.pathname.endsWith('/channels')||url.pathname.endsWith('/flows'))data=[];
  if(url.pathname.endsWith('/settings/provider'))data={configured:false};
  if(url.pathname.endsWith('/guided-preview')){previews.push(req.postDataJSON());data={reply:'Synthetic preview',state:{},buttons:[]};}
  if(url.pathname.endsWith('/bot-a')&&req.method()==='PUT'){writes.push(req.postDataJSON());data={id:'bot-a',revision:2};}
  return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data})});
 });
 await page.goto('http://127.0.0.1/user?page=automation-flows');await page.evaluate(lang=>{localStorage.setItem('wacrm_user','synthetic');localStorage.setItem('language',lang);document.documentElement.lang=lang;},lang);await page.addScriptTag({content:script});await page.locator('#sx-chatbot-tabs').waitFor();
 if(width<768)await page.locator('.sx-mobile-tab-select').selectOption('guided');else await page.locator('[data-tab=guided]').click();
 await page.locator('[data-edit="bot-a"]').click();const selector=page.locator('.sx-dialog [name=captureFormId]');assert.equal(await selector.inputValue(),a);await selector.selectOption(mode==='selected'?b:'__none__');
 const input=page.locator('[data-guided-message]');await input.fill('form');await page.locator('[data-guided-send]').click();await page.waitForFunction(()=>document.querySelector('[data-guided-transcript]')?.textContent.includes('Synthetic preview'));assert.equal(previews[0].captureFormId,mode==='selected'?b:null);
 await page.locator('.sx-dialog button[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('.sx-bot-editor-dialog'));assert.equal(writes.length,1);assert.equal(writes[0].config.captureFormId,mode==='selected'?b:null);assert.equal(writes[0].expectedRevision,1);
 await page.locator('[data-edit="bot-b"]').click();assert.equal(await page.locator('.sx-dialog [name=captureFormId]').inputValue(),b,'editing one bot does not change another');assert.deepEqual(errors,[]);await page.close();cases++;
 }console.log(JSON.stringify({passed:true,cases,checks:['actual bot editor','selected and disabled form payloads','unsaved guided preview','independent profiles','EN AR mobile desktop']}));}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
