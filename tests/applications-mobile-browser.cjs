'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const dir=process.env.APPLICATION_ASSET_DIR||path.join(__dirname,'../client/public');
const read=f=>fs.readFileSync(path.join(dir,f),'utf8');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});let cases=0;
 try{for(const width of [330,412,1440])for(const ar of [false,true])for(const screen of ['forms','recruitment']){
  const page=await browser.newPage({viewport:{width,height:850}});page.setDefaultTimeout(5000);
  const item={id:'fixture-app',referenceCode:'APP-SYNTHETIC-123',fullName:'Synthetic Applicant Long Name',mobile:'+97400000000',email:'synthetic.long.email@example.invalid',englishLevel:'fluent',hindiLevel:'basic',experienceYears:4,status:'new',submittedAt:'2026-10-25T09:00:00Z',submissionData:{contact_name:'Synthetic Applicant Long Name',phone:'+97400000000',email:'synthetic.long.email@example.invalid'},formId:'fixture-form',leadId:'fixture-lead',linkedChatId:'fixture-chat',answers:{fullName:'Synthetic Applicant Long Name',email:'synthetic.long.email@example.invalid'}};
  await page.route('http://fixture.invalid/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data:{items:[item],total:1,page:1,pages:1,publicUrl:'http://fixture.invalid/careers/synthetic'}})}));
  await page.goto('http://fixture.invalid/user?page='+screen);
  await page.setContent('<html dir="'+(ar?'rtl':'ltr')+'"><head></head><body><header class="MuiAppBar-root" style="position:fixed;top:0;left:0;right:0;height:56px;z-index:1100;background:white"><button id="menu">Menu</button></header><div class="MuiDrawer-root MuiDrawer-modal MuiModal-root" style="display:none;position:fixed;inset:0;z-index:1300;background:white"><div class="MuiDrawer-paper" style="width:100%"><ul data-sx-sidebar-list><li><button class="MuiListItemButton-root" aria-label="Dashboard"><span class="MuiListItemText-root" style="opacity:0;width:0;overflow:hidden"><span class="MuiListItemText-primary">Dashboard</span></span></button></li></ul></div></div></body></html>');
  await page.evaluate(({ar})=>{localStorage.setItem('language',ar?'ar':'en');localStorage.setItem('wacrm_user','synthetic-token');window.SXTrainingRegistration={definitions:[['contact_name','Name','الاسم'],['phone','Phone','الهاتف']]};window.SaleMaxWorkspace={session:async()=>({role:'owner',categoryKey:'7network_sales',assignedNavigation:null,roleNavigation:['dashboard','forms','recruitment','inbox']}),request:async(_,url)=>({data:url.startsWith('/submissions')?{items:[{id:'fixture-app',referenceCode:'APP-SYNTHETIC-123',submittedAt:'2026-10-25T09:00:00Z',submissionData:{contact_name:'Synthetic Applicant Long Name',phone:'+97400000000',email:'synthetic.long.email@example.invalid'},formId:'fixture-form',leadId:'fixture-lead'}],total:1,page:1,pages:1}:[{id:'fixture-form',nameEn:'Student Registration Form',nameAr:'نموذج تسجيل الطالب',slug:'student-registration',publishedSlug:'student-registration',status:'published',publishedVersion:1,draftRevision:1,publicPath:'/p/synthetic/forms/student-registration'}]})};window.__sxRecruitmentLoader=window.__sxChatbotAdminLoader=window.__sxFaqManagerLoader=window.__sxTrainingFormsEditorLayoutLoader=true;document.querySelector('#menu').onclick=()=>document.querySelector('.MuiModal-root').style.display='block';},{ar});
  await page.addStyleTag({content:read('training-forms.css')+'\n'+read('recruitment-admin.css')+'\n'+read('applications-mobile.css')});
  await page.addScriptTag({content:read('training-sidebar.js')});
  await page.addScriptTag({content:read(screen==='forms'?'training-forms.js':'recruitment.js')});
  const root=screen==='forms'?'#sx-forms-screen':'#sx-recruitment-screen';
  await page.waitForSelector(root+' tbody tr').catch(async e=>{console.log(await page.locator('body').innerText());throw e;});
  assert.equal(await page.locator(screen==='forms'?'#sx-form-exit':'.sx-recruit-back').isVisible(),true,'workspace exit visible');
  const bounds=await page.locator(root).boundingBox();if(width<=720){assert.ok(bounds.y>=55,'header must remain uncovered');assert.ok(bounds.width<=width+1);const overflow=await page.locator(root).evaluate(el=>el.scrollWidth-el.clientWidth);assert.ok(overflow<=1,'workspace must not overflow: '+overflow);const table=await page.locator(root+' table').first().boundingBox();assert.ok(table.width<=width-20,'record must fit phone width');}
  if(width===1440){assert.equal(await page.locator(root+' thead').first().evaluate(el=>getComputedStyle(el).position),'static','desktop table preserved');}
  if(width===330&&!ar)await page.screenshot({path:'/tmp/'+screen+'-mobile-content.png'});
  await page.locator('#menu').click();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.MuiModal-root')).display==='block');
  if(width<=900)await page.waitForFunction(()=>getComputedStyle(document.querySelector('.MuiListItemText-primary')).display!=='none'&&document.querySelector('.MuiListItemText-primary').getBoundingClientRect().width>0).catch(async e=>{console.log({width,ar,screen,drawer:await page.locator('.MuiDrawer-paper').evaluate(el=>el.outerHTML)});throw e;});
  assert.equal(await page.locator('.MuiListItemText-primary').first().evaluate(el=>getComputedStyle(el.parentElement).opacity),width<=900?'1':'0');
  if(width<=720){const after=await page.locator(root).boundingBox();assert.ok(Math.abs(after.width-bounds.width)<=1,'opening menu must not shrink forms screen');}
  if(width===330&&!ar)await page.screenshot({path:'/tmp/'+screen+'-mobile-candidate.png',fullPage:false});
  await page.close();cases++;
 }
 console.log(JSON.stringify({passed:true,cases,checks:['330/412/1440','EN/AR','persistent workspace exit','header reachable','records fit phone','menu opened from forms','no mobile drawer content inset','desktop table preserved']}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
