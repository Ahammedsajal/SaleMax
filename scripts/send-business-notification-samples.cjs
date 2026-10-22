'use strict';
// Explicit operator-only smoke send. This does not create financial records,
// change business recipients, or drain historical notification queues.
require('dotenv').config({quiet:true});
const qr=require('../modules/platform/business-whatsapp');
const finance=require('../modules/platform/business-finance-context');
const reports=require('../modules/platform/business-daily-report');
const pdf=require('../modules/platform/business-report-pdf');
const moment=require('moment-timezone');
async function main(){
 const args=process.argv.slice(2),get=key=>args[args.indexOf(key)+1];
 if(!args.includes('--confirm-test-send')||!args.includes('--tenant-id')||!args.includes('--to')||!/^[-0-9a-f]{36}$/i.test(get('--tenant-id')||'')||!/^\+[1-9]\d{9,14}$/.test(get('--to')||''))throw Error('EXPLICIT_TENANT_DESTINATION_AND_TEST_CONFIRMATION_REQUIRED');
 const tenantId=get('--tenant-id'),to=get('--to'),db=require('../database/config').promise();
 try{
  const [[tenant]]=await db.query("SELECT id,name,category_key,timezone FROM sx_tenants WHERE id=? AND status='active' AND category_key='training_center'",[tenantId]);if(!tenant)throw Error('TRAINING_CENTER_TENANT_REQUIRED');
  if(!await qr.sender(db,tenantId))throw Error('DEFAULT_TRAINING_QR_UNAVAILABLE');
  const now=moment.tz('Asia/Qatar'),data={number:'TEST-INV-001',receiptNumber:'TEST-RCP-001',customer:'Sample Training Customer (test only)',phone:'Sample contact - not a real customer',product:'Advanced Excel training (sample)',currency:'QAR',total:100000,received:40000,balance:60000,amountDue:60000,dueDate:now.clone().add(1,'day').format('YYYY-MM-DD'),receivedAt:now.toISOString()};
  const results=[];for(const kind of ['invoice_issued','payment_due','payment_received']){
   const result=await qr.send(db,{tenantId,to,text:finance.message(kind,data,{business:tenant.name,test:true})});results.push({kind,...result});if(result.status!=='accepted'){console.log(JSON.stringify({results}));return;}
  }
  const summary=await reports.build(db,tenant);const text=await qr.send(db,{tenantId,to,text:'TEST DELIVERY — current Training Center report\n\n'+reports.text(summary)});results.push({kind:'daily_summary',...text});
  if(text.status==='accepted')results.push({kind:'daily_pdf',...await qr.send(db,{tenantId,to,text:'TEST DELIVERY — daily Training Center business report (actual current totals)',pdf:await pdf.render(summary),fileName:`7Network-test-daily-report-${summary.day}.pdf`})});
  console.log(JSON.stringify({destinationLast4:to.slice(-4),results}));
 }finally{await db.end();}
}
if(require.main===module)main().catch(e=>{console.error(e.code||e.message||'TEST_SEND_FAILED');process.exitCode=1;});
module.exports={main};
