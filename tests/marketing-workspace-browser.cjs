'use strict';
// Real compiled shell and maintained hooks; synthetic HTTP responses only.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),jwt=require('jsonwebtoken');
const {chromium}=require(process.env.SALEMAX_PLAYWRIGHT_PATH||'playwright');
const publicRoot=path.resolve('client/public'),output=path.resolve(process.env.SALEMAX_UI_OUTPUT||'database/local-runtime/marketing-browser');fs.mkdirSync(output,{recursive:true});
const ownerToken=jwt.sign({uid:'synthetic-owner',email:'owner@example.invalid',role:'user'},'synthetic-test-key');
const agentToken=jwt.sign({uid:'synthetic-agent',email:'agent@example.invalid',role:'agent'},'synthetic-test-key');
const allKeys=['dashboard','inbox','contacts','whatsapp-qr','whatsapp-meta','templates','campaigns','campaign-dashboard','products-services','tasks'];
const state={templates:true,role:'owner',keys:[...allKeys],assigned:null};
const calls=[],writes=[];
const campaign={campaign_id:'synthetic-campaign',title:'October product launch',template_name:'product_update',template_language:'en',status:'COMPLETED',createdAt:'2026-10-18T09:00:00Z',schedule:'2026-10-18T10:00:00Z',total_contacts:500,sent_count:480,delivered_count:465,read_count:350,failed_count:20,phonebook_name:'Existing customers'};
const template={id:'synthetic-template',name:'product_update',language:'en',status:'APPROVED',category:'MARKETING',components:[{type:'BODY',text:'Hello {{1}}, discover our new business services.',example:{body_text:[['Alex']]}}],variables:[{component:'BODY',index:'1',example:'Alex'}]};
function response(url){
 const p=url.pathname;
 const access={role:state.role,categoryKey:'salemax_sales',roleNavigation:state.keys,assignedNavigation:state.assigned,modules:{products:true,inbox:true,phonebook:true},permissions:{'products.read':true,'products.manage':true,'campaigns.manage':true,'templates.manage':state.keys.includes('templates')},quickReplyCatalog:'products'};
 const profile={id:1,uid:state.role==='agent'?'synthetic-agent':'synthetic-owner',name:'Synthetic Sales',email:'sales@example.invalid',role:'user',isAgent:state.role==='agent',workspaceRole:state.role,plan:JSON.stringify({qr_account:3,contact_limit:1000}),plan_expire:String(Date.now()+86400000)};
 if(p==='/api/workspace/session'||p.endsWith('/sidebar-access'))return {success:true,data:access};
 if(p==='/api/user/get_me')return {success:true,data:profile,addon:['QR']};
 if(p==='/api/user/get_dashboard')return {success:true,data:{user:{...profile,plan:JSON.parse(profile.plan)},addons:['QR'],stats:{},recentConversations:[],performanceData:[],unreadSummary:[],activeChatbots:[]}};
 if(p==='/api/broadcast/dashboard')return {success:true,totalCampaigns:3,messageStats:{total:1350,sent:1200,delivered:1100,read:850,failed:30,pending:120},campaignsByStatus:[{status:'COMPLETED',count:2},{status:'SCHEDULED',count:1}],dailyStats:[{date:'2026-10-18',sent:300,delivered:260,read:200}],recentCampaigns:[campaign]};
 if(p==='/api/broadcast/campaigns')return {success:true,campaigns:[campaign],pagination:{currentPage:1,totalPages:1,totalCampaigns:1,limit:10}};
 if(p==='/api/user/get_my_meta_templets_beta')return {success:true,data:state.templates?[template]:[],paging:{}};
 if(p==='/api/workspace/phonebook/bootstrap')return {success:true,books:[],config:{labels:['Company','City','Interest','Source','Notes'],rules:[]},canManage:true};
 if(p==='/api/user/optional-features')return {success:true,data:{features:{}}};
 if(p==='/api/user/call-center/status')return {success:true,data:{feature:{enabled:false}}};
 return {success:true,data:[],items:[],total:0};
}
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/api/')){
  calls.push({path:url.pathname,actor:req.headers['x-salemax-actor']||null});
  if(!['GET','HEAD'].includes(req.method)){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>writes.push({path:url.pathname,body:body?JSON.parse(body):null}));}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response(url)));return;
 }
 const file=path.join(publicRoot,url.pathname==='/user'?'index.html':url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname);
 if(!file.startsWith(publicRoot+path.sep)){res.statusCode=403;res.end();return;}
 try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  for(const language of ['en','ar'])for(const width of [1440,390]){
   Object.assign(state,{templates:true,role:'owner',keys:[...allKeys],assigned:null});const errors=[];
   const context=await browser.newContext({viewport:{width,height:1000}});
   await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
   await context.addInitScript(({ownerToken,agentToken,language})=>{if(location.origin==='null')return;localStorage.setItem('wacrm_user',ownerToken);localStorage.setItem('wacrm_agent',agentToken);localStorage.setItem('language',language);},{ownerToken,agentToken,language});
   const page=await context.newPage();page.on('pageerror',error=>{if(!error.message.includes('localStorage'))errors.push(error.message);});
   await page.goto(origin+'/user?page=campaign-dashboard');await page.locator('#sx-marketing-nav').waitFor();
   assert.equal(await page.locator('#sx-marketing-nav').count(),1);assert.equal(await page.locator('#sx-marketing-nav [aria-current=page]').count(),1);
   assert.equal(await page.locator('[data-sx-marketing-action]').getAttribute('href'),'/user?page=send-campaign');
   await page.getByRole('tab',{name:'All Campaigns',exact:true}).click();await page.getByText(campaign.title,{exact:true}).waitFor();
   await page.getByRole('tab',{name:'Overview',exact:true}).click();await page.waitForTimeout(1200);await page.screenshot({path:path.join(output,`campaign-dashboard-${language}-${width}.png`),fullPage:true});
   await page.locator('[data-sx-marketing-action]').click();await page.waitForURL('**/user?page=send-campaign');await page.getByRole('button',{name:'Use Template',exact:true}).click();
   await page.getByText('Campaign Settings',{exact:true}).waitFor();
   assert.equal(await page.getByRole('main').getByRole('button',{name:'Send Campaign',exact:true}).isDisabled(),true);
   assert.equal(await page.locator('#sx-marketing-nav').count(),1);await page.screenshot({path:path.join(output,`campaign-configure-${language}-${width}.png`),fullPage:true});
   await page.locator('#sx-marketing-nav a[href*="create-meta-template"]').click();await page.waitForURL('**/user?page=create-meta-template');
   await page.getByRole('textbox',{name:language==='ar'?'اسم القالب':'Template Name',exact:true}).fill('october_product_update');
   await page.getByRole('button',{name:'Next',exact:true}).click();await page.getByRole('textbox',{name:language==='ar'?'اسم القالب':'Template Name',exact:true}).waitFor({state:'hidden'});
   await page.getByRole('button',{name:'Back',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:language==='ar'?'اسم القالب':'Template Name',exact:true}).inputValue(),'october_product_update');
   await page.screenshot({path:path.join(output,`template-editor-${language}-${width}.png`),fullPage:true});
   state.templates=false;await page.goto(origin+'/user?page=send-campaign');await page.locator('[data-sx-marketing-empty]').waitFor();
   assert.equal(await page.locator('[data-sx-marketing-empty] a').count(),2);
   state.keys=allKeys.filter(key=>key!=='templates');await page.reload();await page.locator('#sx-marketing-nav').waitFor();
   assert.equal(await page.locator('#sx-marketing-nav a[href*="create-meta-template"]').count(),0);assert.equal(await page.locator('[data-sx-marketing-empty] a[href*="create-meta-template"]').count(),0);
   await page.screenshot({path:path.join(output,`campaign-empty-limited-${language}-${width}.png`),fullPage:true});
   assert.deepEqual(errors,[],language+' '+width+' page errors');assert.equal(writes.length,0,'navigation and previews never queue campaigns or submit templates');
   await context.close();
  }
  Object.assign(state,{templates:true,role:'agent',keys:[...allKeys],assigned:['campaign-dashboard']});
  const agentContext=await browser.newContext({viewport:{width:1440,height:1000}});
  await agentContext.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  await agentContext.addInitScript(({agentToken})=>{if(location.origin==='null')return;localStorage.setItem('wacrm_agent',agentToken);localStorage.setItem('language','en');},{agentToken});
  const agentPage=await agentContext.newPage();
  await agentPage.goto(origin+'/user?actor=agent&page=campaign-dashboard');await agentPage.locator('#sx-marketing-nav').waitFor();
  assert.equal(await agentPage.locator('#sx-marketing-nav a').count(),1,'member restrictions intersect role navigation');
  assert.equal(await agentPage.locator('[data-sx-marketing-action]').count(),0,'read-only dashboard grant cannot start campaigns');
  state.assigned=['campaign-dashboard','campaigns'];await agentPage.reload();await agentPage.locator('[data-sx-marketing-action]').waitFor();
  assert.equal(await agentPage.locator('[data-sx-marketing-action]').getAttribute('href'),'/user?page=send-campaign&actor=agent');
  await agentPage.locator('[data-sx-marketing-action]').click();await agentPage.waitForURL('**page=send-campaign&actor=agent');await agentPage.locator('#sx-marketing-nav').waitFor();
  assert.equal(await agentPage.locator('#sx-marketing-nav a[href*="create-meta-template"]').count(),0);
  assert.ok(calls.some(call=>call.path==='/api/workspace/session'&&call.actor==='agent'),'shared session carries Agent identity');
  assert.equal(writes.length,0);await agentContext.close();
  console.log(JSON.stringify({passed:true,checks:['real dashboard overview/list controls','campaign-to-template navigation','existing configure wizard preserved','template next/back preserves validation','empty-state actions','permission-restricted links','Agent identity and member restrictions','EN AR desktop/mobile'],providerCalls:0,submissions:writes.length}));
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
