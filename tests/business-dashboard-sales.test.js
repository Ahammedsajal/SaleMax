'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const test=require('node:test');
const source=fs.readFileSync(require.resolve('../client/public/business-dashboard/dashboard.js'),'utf8');
const css=fs.readFileSync(require.resolve('../client/public/business-dashboard/dashboard.css'),'utf8');

async function render(access,fixtures,language='en'){
  const ids=['metrics','eyebrow','title','subtitle','period','create-menu','create','refresh','dashboard','updated','notice','chart','chart-link','chart-subtitle','chart-title','mix','mix-subtitle','mix-title','insights','priorities','priority-link','priority-title'];
  const elements=Object.fromEntries(ids.map(id=>[id,{id,textContent:'',innerHTML:'',hidden:true,href:'',dataset:{},classList:{toggle(){},add(){},remove(){}},setAttribute(){},querySelectorAll(){return[];},closest(){return null;}}]));
  const containers={'.main-grid':{innerHTML:''},'.bottom-grid':{innerHTML:''}};
  const document={documentElement:{lang:'',dir:''},querySelector:s=>s.startsWith('#')?elements[s.slice(1)]:containers[s]||null,addEventListener(){}};
  const requests=[];
  const context={document,window:{parent:{location:{pathname:'/user'}},addEventListener(){}},localStorage:{getItem:k=>k==='language'?language:null},location:{assign(){}},Intl,Date,Number,String,Math,Set,Map,Promise,encodeURIComponent,fetch:async url=>{const key=String(url);requests.push(key);if(key==='/api/user/business-auth/me')return{ok:true,json:async()=>({context:{audience:'tenant'},csrfToken:'synthetic-csrf'})};let result;if(key==='/api/workspace/session')result=access;else if(fixtures[key]!==undefined)result=fixtures[key];else throw Error(`Unexpected request ${key}`);return{ok:true,json:async()=>({success:true,...(key==='/api/broadcast/dashboard'?result:{data:result})})};},console};
  vm.runInNewContext(source,context,{timeout:1000});await new Promise(r=>setTimeout(r,20));return{elements,containers,requests};
}

test('SaleMaX category dashboard presents scoped leads, call, campaign and finance data',async()=>{
  const month=new Date().toISOString().slice(0,7);
  const access={categoryKey:'salemax_sales',role:'owner',currency:'QAR',timezone:'Asia/Qatar',roleNavigation:['leads','campaigns','campaign-dashboard','call-center','sales-targets','sales-finance'],assignedNavigation:null,permissions:{'sales.receipt.record':true}};
  const fixtures={
    '/api/pipeline/stage-summary':{total:12,stages:[{stageKey:'new',total:7},{stageKey:'qualified',total:5}]},
    '/api/pipeline/follow-ups?period=all&page=1&limit=6':{items:[{contact_name:'Amina',lead_id:'lead-1',next_follow_up_at:'Today'}],summary:{overdue:2,upcoming:4}},
    [`/api/user/sales-targets?period=${month}`]:{members:[{displayName:'Agent One',actual:{connectedCalls:18}}]},
    '/api/broadcast/dashboard':{success:true,totalCampaigns:3,messageStats:{sent:100,delivered:90,read:45},recentCampaigns:[{title:'October offer',status:'COMPLETED',sent_count:100,delivered_count:90,read_count:45}]},
    '/api/user/call-center/calls':{items:[{startedByName:'Agent One',direction:'outbound',leadId:'lead-1',status:'completed'}]},
    '/api/user/sales-finance/overview':{invoicesByCurrency:[{currency:'QAR',invoiceCount:4,billedMinor:'4260000',collectedMinor:'3125000',outstandingMinor:'1135000'}],receiptsByCurrency:[{currency:'QAR',receivedMinor:'3125000'}]},
    '/api/user/sales-finance/invoices?limit=5':{items:[{invoiceNumber:'SMX-2026-0001'}]},
    '/api/user/sales-finance/receipts?limit=5':{items:[{id:'receipt-1',externalReference:'RCPT-1042',payerName:'Amina',amountMinor:'850000',currency:'QAR',reconciliationStatus:'matched'}]}
  };
  const {elements,containers,requests}=await render(access,fixtures);
  assert.match(elements.title.textContent,/Your sales at a glance/);
  assert.match(elements.metrics.innerHTML,/Leads in pipeline/);assert.match(elements.metrics.innerHTML,/Connected calls/);assert.match(elements.metrics.innerHTML,/Campaign delivery/);assert.match(elements.metrics.innerHTML,/Invoices issued/);assert.match(elements.metrics.innerHTML,/Payments received/);
  assert.match(containers['.main-grid'].innerHTML,/Lead pipeline/);assert.match(containers['.main-grid'].innerHTML,/Connected calls by team/);assert.match(containers['.main-grid'].innerHTML,/Agent One/);
  assert.match(containers['.bottom-grid'].innerHTML,/Campaign performance/);assert.match(containers['.bottom-grid'].innerHTML,/October offer/);assert.match(containers['.bottom-grid'].innerHTML,/Finance overview/);assert.match(containers['.bottom-grid'].innerHTML,/Recent invoices/);assert.match(containers['.bottom-grid'].innerHTML,/SMX-2026-0001/);assert.match(containers['.bottom-grid'].innerHTML,/Recent receipts/);assert.match(containers['.bottom-grid'].innerHTML,/RCPT-1042/);assert.match(containers['.bottom-grid'].innerHTML,/Needs attention/);
  assert.ok(requests.includes('/api/user/sales-finance/receipts?limit=5'));
});

test('Sales accountant and manager only request finance details their role can read',async()=>{
  const month=new Date().toISOString().slice(0,7);
  const base={categoryKey:'salemax_sales',currency:'QAR',timezone:'Asia/Qatar',roleNavigation:['sales-finance'],assignedNavigation:null};
  const common={'/api/user/sales-finance/overview':{role:'manager',billedByCurrency:[{currency:'QAR',invoiceCount:2,billedMinor:'20000'}]}};
  const manager=await render({...base,role:'manager'},common);
  assert.ok(manager.requests.includes('/api/user/sales-finance/overview'));
  assert.ok(!manager.requests.some(url=>url.includes('/invoices?')||url.includes('/receipts?')));
  const accountant=await render({...base,role:'accountant'},common);
  assert.ok(accountant.requests.includes('/api/user/sales-finance/invoices?limit=5'));
  assert.ok(accountant.requests.includes('/api/user/sales-finance/receipts?limit=5'));
});

test('Training Center keeps the existing dashboard layout and never receives Sales styling',async()=>{
  const month=new Date().toISOString().slice(0,7),today=new Date().toISOString().slice(0,10),from=month+'-01';
  const access={categoryKey:'training_center',role:'manager',currency:'QAR',timezone:'Asia/Qatar',roleNavigation:['leads','tasks'],assignedNavigation:null,modules:{}};
  const fixtures={'/api/pipeline/stage-summary':{total:1,stages:[{stageKey:'new',total:1}]},'/api/pipeline/follow-ups?period=all&page=1&limit=6':{items:[],summary:{overdue:0,upcoming:0}},'/api/user/training/tasks?status=active&scope=team&page=1&limit=6':{items:[]}};
  const {elements,containers,requests}=await render(access,fixtures);
  assert.match(elements.title.textContent,/Training center/);
  assert.doesNotMatch(containers['.main-grid'].innerHTML,/Connected calls by team/);
  assert.ok(!requests.some(url=>url.includes('/api/broadcast/dashboard')||url.includes('/api/user/call-center/calls')));
  assert.match(css,/\.sales-category \.metrics/);
});
