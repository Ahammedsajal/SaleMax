'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.join(__dirname,'../client/public');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});let cases=0;try{
 for(const lang of ['en','ar'])for(const width of [390,1280])for(const training of [false,true]){
  const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(8000);const requests=[],writes=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
  const contract={version:1,category:{key:training?'training_center':'7network_sales',version:1},profile:training?'training':'shared',workflows:{courses:training,forms:training,saleReviews:training}},lead={id:'lead-a',title:'Synthetic lead',contact_name:'Synthetic person',mobile:'+12025550199',stage_key:'new',status:'open',priority:'normal',qualification_data:{certificate_name:'Historical certificate',qid:'12345678901',courseInterest:'Historical course',referralSource:'Referral'},applications:[],conversations:[],activities:[],leadWorkspaceContract:contract};
  await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());let data={};
   if(url.pathname==='/pipeline/')return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,'pipeline/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'')});
   if(!url.pathname.startsWith('/api/'))return route.fulfill({body:'',contentType:url.pathname.endsWith('.css')?'text/css':'text/plain'});
   requests.push(url.pathname);
   if(url.pathname.endsWith('/board'))data={leads:[lead],stages:[{stage_key:'new',title:'New',position:0,leads:[lead]}],agents:[],role:'owner',categoryKey:contract.category.key,total:0,leadWorkspaceContract:contract};
   else if(url.pathname==='/api/workspace/session')data={stageLabels:{new:{en:'Prospect A',ar:'عميل أ'}}};
   else if(url.pathname.endsWith('/filter-options'))data={qrInstances:[]};
   else if(url.pathname.endsWith('/course-options')||url.pathname.endsWith('/contacts/matches')||url.pathname.endsWith('/sale-options')||url.pathname.endsWith('/sale-reviews'))data=[];
   else if(url.pathname.endsWith('/leads/lead-a')){data=lead;if(req.method()==='PATCH')writes.push(req.postDataJSON());}
   else if(url.pathname.endsWith('/leads')&&req.method()==='POST'){writes.push(req.postDataJSON());data={id:'lead-a'};}
   return route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data})});
  });
  await page.goto('http://127.0.0.1/pipeline/?view=detail');await page.evaluate(lang=>{localStorage.setItem('wacrm_user','synthetic');localStorage.setItem('language',lang);document.documentElement.lang=lang;},lang);
  for(const name of ['workspace-api.js','pipeline/workspace-fields.js','pipeline/lead-fields.js','pipeline/pipeline.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,name),'utf8')});await page.waitForSelector('#board .column');
  assert.ok((await page.locator('#board .colname').first().textContent()).includes(lang==='ar'?'عميل أ':'Prospect A'),'board uses the effective tenant label');
  await page.locator('#listMode').click();assert.ok((await page.locator('#list tbody tr td:nth-child(3)').first().textContent()).includes(lang==='ar'?'عميل أ':'Prospect A'),'list uses the effective tenant label');
  await page.locator('#boardMode').click();await page.locator('#addBtn').click();await page.locator('#newLead').waitFor();
  assert.equal(await page.locator('#newLeadStage option').first().textContent(),lang==='ar'?'عميل أ':'Prospect A','new lead stage selector uses the effective tenant label');
  assert.equal(await page.locator('#newLead [name=learnerName]').count(),training?1:0);assert.equal(await page.locator('#newLead [name=qualification_qid]').count(),training?1:0);assert.equal(await page.locator('#newLead [name=qualification_courseInterest]').count(),training?1:0);
  assert.equal(await page.locator('#newLead [name=qualification_referralSource]').count(),1);
  await page.locator('#newLead [name=title]').fill('Synthetic title');await page.locator('#newLead [name=mobile]').fill('+12025550198');await page.locator('#newLead [name=contactName]').fill('Synthetic contact');await page.locator('#newLead .primary').click();await page.waitForFunction(()=>document.querySelector('#modal').classList.contains('hidden'));
  assert.equal(writes[0].learnerName,training?'':undefined);assert.equal(writes[0].qualificationData.qid,undefined);
  await page.evaluate(()=>window.salemaxPipelineOpenLead('lead-a'));await page.locator('#editLead').waitFor();
  assert.equal(await page.locator('#editLeadStage option:checked').textContent(),lang==='ar'?'عميل أ':'Prospect A','edit stage selector uses the effective tenant label');
  assert.equal(await page.locator('#editLead [name=qualification_qid]').count(),training?1:0);assert.equal(await page.locator('#createLeadApplication').count(),training?1:0);assert.equal(await page.locator('#sale-review-area').count(),training?1:0);
  await page.locator('#editLeadTitle').fill('Updated title');await page.locator('#editLead button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#editLeadTitle')?.value==='Synthetic lead');
  assert.equal(writes[1].qualificationData.qid,'12345678901','hidden historical fields survive edit');assert.equal(writes[1].qualificationData.certificate_name,'Historical certificate');assert.equal(writes[1].qualificationData.courseInterest,'Historical course');
  if(!training)assert.equal(requests.some(p=>p.endsWith('/course-options')||p.endsWith('/sale-options')||p.endsWith('/sale-reviews')),false,'shared category never requests training APIs');
  assert.deepEqual(errors,[]);await page.close();cases++;
 }
 console.log(JSON.stringify({passed:true,cases,checks:['board, list, Add and Edit Lead use published stage labels','Sales and Training','EN/AR mobile/desktop','no training API requests for Sales','historical field preservation']}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
