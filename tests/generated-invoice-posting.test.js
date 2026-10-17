'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {snapshotInput}=require('../modules/platform/generated-invoice-posting');
const valid=()=>{const snapshot={currency:'QAR',taxMinor:0,totalMinor:85000,legalName:'Synthetic Centre',issuedAt:'2026-10-17T10:00:00Z',customer:{name:'Synthetic Payer'},lines:[{courseId:crypto.randomUUID(),offerVersion:1,quantity:1,unitAmountMinor:100000,discountMinor:15000,totalMinor:85000,taxMinor:0}],installments:[{dueDate:'2026-10-17',amountMinor:25000},{dueDate:'2026-11-17',amountMinor:60000}]};return {invoice_number:'INV-2026-000003',amount_minor:85000,snapshot:JSON.stringify(snapshot)};};
test('direct posting preserves the issued snapshot rather than repricing or inventing sale approval',()=>{
 const doc=valid(),s=snapshotInput(doc);assert.equal(s.totalMinor,85000);assert.equal(s.lines[0].discountMinor,15000);assert.equal(s.installments[1].amountMinor,60000);
 for(const change of [{currency:'USD'},{taxMinor:1},{totalMinor:90000},{lines:[]},{customer:{name:''}},{installments:[{dueDate:'2026-10-17',amountMinor:100}]}])assert.throws(()=>snapshotInput({...doc,snapshot:{...s,...change}}));
 assert.throws(()=>snapshotInput({...doc,amount_minor:1}));
 assert.throws(()=>snapshotInput({...doc,snapshot:{...s,lines:[{...s.lines[0],discountMinor:100001}]}}));
});
test('the existing receipt picker opens a read-only payment preview without a sale-approval request',async()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../client/public/training-finance.js'),'utf8');
 const start=source.indexOf('  async function openGeneratedReceiptInvoice('),end=source.indexOf('  async function loadReceiptRegister(',start),calls=[];
 const context={generatorPath:mode=>mode==='owner'?'/generator':'/accountant/generator',generatorFetch:async(...args)=>{calls.push(args);return {id:'document-id'};},loadInvoiceDetail:async(...args)=>calls.push(args),encodeURIComponent};
 require('node:vm').runInNewContext(source.slice(start,end),context);
 const dialog={};await context.openGeneratedReceiptInvoice(dialog,'manager','fixture-csrf','selected-document');
 assert.equal(calls[0][0],'manager');assert.equal(calls[0][1],'/accountant/generator/invoices/selected-document/payment-context');assert.equal(calls[0][2],'GET');assert.equal(calls[1][3],'document-id');
});
