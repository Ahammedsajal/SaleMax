'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'client/public/sales-finance/index.html'),'utf8'),script=fs.readFileSync(path.join(root,'client/public/sales-finance/sales-finance.js'),'utf8');
for(const language of ['en','ar'])test('direct Finance forms and document opening: '+language,async()=>{
 const dom=new JSDOM(html,{url:'http://localhost/sales-finance/?embed=1',runScripts:'outside-only'}),w=dom.window,calls=[];
 w.localStorage.setItem('language',language);w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};
 let failed=false;
 w.fetch=async(url,options={})=>{calls.push({url,options});let data={};
  if(url.endsWith('/overview'))data={role:'manager',permissions:{'sales.invoice.issue':true,'sales.receipt.record':true,'sales.receipt.allocate':true,'sales.finance.report':true},invoicesByCurrency:[],receiptsByCurrency:[]};
  else if(url.includes('/unbilled-sales')||url.includes('/invoices?')||url.includes('/receipts?'))data={items:[]};
  else if(options.method==='POST'){if(!failed){failed=true;throw Error('synthetic lost response');}data={id:'11111111-1111-4111-8111-111111111111'};}
  else if(url.includes('/documents/'))data={kind:'invoice',businessName:'Synthetic Business',number:'SMX-2026-000001',customerName:'Synthetic Customer',amountMinor:'125050',currency:'QAR',date:'2026-10-19T06:00:00Z',description:'Services <script>unsafe</script>',status:'issued'};
  return {ok:true,json:async()=>({success:true,data})};
 };
 vm.runInContext(script,dom.getInternalVMContext());const tick=()=>new Promise(r=>setImmediate(r));await tick();await tick();
 const $=id=>w.document.getElementById(id);assert.equal(w.document.documentElement.dir,language==='ar'?'rtl':'ltr');assert.equal($('createInvoice').hidden,false);
 $('createInvoice').click();const form=$('actionForm');for(const [name,value]of Object.entries({customerName:'Synthetic Customer',description:'Services',amount:'1250.50',currency:'QAR'}))form.elements[name].value=value;
 form.dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await tick();assert.equal($('actionError').hidden,false);
 form.dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await tick();await tick();
 const posts=calls.filter(c=>c.options.method==='POST');assert.equal(posts.length,2);assert.equal(JSON.parse(posts[0].options.body).idempotencyKey,JSON.parse(posts[1].options.body).idempotencyKey);assert.equal(JSON.parse(posts[1].options.body).totalMinor,'125050');
 assert.equal($('documentDialog').hasAttribute('open'),true);assert.match($('documentContent').textContent,/SMX-2026-000001/);assert.equal($('documentContent').querySelector('script'),null);
 $('closeDocument').click();$('createReceipt').click();assert.equal($('reconciliationView').hidden,false);assert.equal($('receiptForm').hidden,false);
 const receipt=$('receiptForm');receipt.elements.payerName.value='Synthetic Customer';receipt.elements.amount.value='500.00';receipt.dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await tick();await tick();assert.ok(calls.some(c=>c.url.endsWith('/receipts')&&c.options.method==='POST'));assert.equal($('documentDialog').hasAttribute('open'),true);
 dom.window.close();
});
