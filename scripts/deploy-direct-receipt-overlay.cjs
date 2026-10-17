'use strict';
const fs=require('node:fs'),path=require('node:path');
const [target,source]=process.argv.slice(2);if(!target||!source||path.resolve(target)===path.resolve(source))throw Error('DISTINCT_TARGET_AND_SOURCE_REQUIRED');
for(const file of ['modules/platform/generated-invoice-posting.js','modules/platform/invoice-generator.js','modules/platform/policy.js','modules/platform/training-finance-router.js','modules/platform/training-invoices.js','modules/platform/training-payment-proofs.js','modules/platform/training-payments.js','client/public/training-finance.js','database/migrations/20261214_direct_invoice_receipts.sql']){const dest=path.join(target,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(source,file),dest);}
const index=path.join(target,'client/public/index.html'),text=fs.readFileSync(index,'utf8');let count=0;const next=text.replace(/training-finance\.js\?v=[^"\s<>]+/g,()=>{count++;return 'training-finance.js?v=20261017-direct-receipt2';});if(count!==1)throw Error('FINANCE_LOADER_AMBIGUOUS');fs.writeFileSync(index,next);
console.log('Direct receipt overlay applied; generated shell and unrelated live modules preserved.');
