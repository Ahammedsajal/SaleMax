'use strict';
const {OFFSETS}=require('./invoice-communications-settings');
const fail=code=>{throw Object.assign(Error(code),{code});};
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail('INVALID_INVOICE_COMMUNICATION_DATE');return value;}
function minor(value){if(typeof value==='number'&&!Number.isSafeInteger(value)||!/^\d+$/.test(String(value)))fail('INVALID_INVOICE_COMMUNICATION_AMOUNT');return BigInt(value);}
function phone(value){let raw=String(value||'').trim().replace(/[\s().-]/g,'');if(raw.startsWith('00'))raw='+'+raw.slice(2);if(/^\d{8}$/.test(raw))raw='+974'+raw;if(/^974\d{8}$/.test(raw))raw='+'+raw;return /^\+[1-9]\d{7,14}$/.test(raw)?raw:null;}
function email(value){const raw=String(value||'').trim().toLowerCase();return raw.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)?raw:null;}
function active(document){return Boolean(document&&!document.deleted&&!document.replaced&&['generated','issued'].includes(document.status)&&document.id&&Number.isSafeInteger(document.revision)&&document.revision>=1);}
function balance(term,allocations=[],credits=[]){
  const amount=minor(term.amountMinor);let paid=0n,credited=0n;
  for(const item of allocations){if(item.installmentId!==term.id||item.status!=='posted'||!item.receiptId)continue;const gross=minor(item.amountMinor),reversed=minor(item.reversedMinor||0);if(reversed>gross)fail('INVOICE_COMMUNICATION_BALANCE_REQUIRES_REVIEW');paid+=gross-reversed;}
  for(const item of credits)if(item.installmentId===term.id&&item.status==='posted')credited+=minor(item.amountMinor);
  if(paid+credited>amount)fail('INVOICE_COMMUNICATION_BALANCE_REQUIRES_REVIEW');
  return {amountMinor:String(amount),paidMinor:String(paid),creditedMinor:String(credited),openMinor:String(amount-paid-credited)};
}
function channels(document,settings,kind){
  const values={email:email(document.email),whatsapp:phone(document.phone)},prefix=kind==='invoice'?'invoice':'reminder',jobs=[],skipped=[];
  for(const channel of ['email','whatsapp'])if(settings[prefix+(channel==='email'?'Email':'Whatsapp')]){if(values[channel])jobs.push({channel,recipient:values[channel]});else skipped.push({channel,reason:'RECIPIENT_UNAVAILABLE'});}
  return {jobs,skipped};
}
function invoice(document,settings){
  if(!active(document)||!settings.enabled)return {jobs:[],skipped:[]};
  const delivery=channels(document,settings,'invoice');return {jobs:delivery.jobs.map(channel=>({...channel,kind:'invoice',documentId:document.id,documentRevision:document.revision,idempotencyKey:`invoice:${document.id}:v${document.revision}:${channel.channel}`})),skipped:delivery.skipped};
}
function reminders(document,settings,today,{allocations=[],credits=[]}={}){
  date(today);if(!active(document)||!settings.enabled||document.optedOut||document.disputed||document.enrollmentCancelled)return {jobs:[],skipped:[]};
  const jobs=[],skipped=[];
  for(const term of document.installments||[]){if(term.cancelled)continue;date(term.dueDate);const days=Math.round((Date.parse(today+'T00:00:00Z')-Date.parse(term.dueDate+'T00:00:00Z'))/86400000);
    if(!OFFSETS.includes(days)&&!(days>0&&settings.dailyOverdue))continue;
    const amounts=balance(term,allocations,credits);if(amounts.openMinor==='0')continue;
    const delivery=channels(document,settings,'reminder'),kind=days<0?'upcoming':days===0?'due':'overdue',termKey=term.id||`sequence-${term.sequence}`;
    if(!termKey||!term.id&&(!Number.isSafeInteger(term.sequence)||term.sequence<1))fail('INVALID_INVOICE_COMMUNICATION_INSTALLMENT');
    for(const channel of delivery.jobs)jobs.push({...channel,kind,documentId:document.id,documentRevision:document.revision,installmentId:term.id||null,sequence:term.sequence,dueDate:term.dueDate,scheduledDate:today,daysFromDue:days,amountMinor:amounts.openMinor,idempotencyKey:`reminder:${document.id}:v${document.revision}:${termKey}:${today}:${channel.channel}`});
    skipped.push(...delivery.skipped.map(item=>({...item,sequence:term.sequence})));
  }
  return {jobs,skipped};
}
function recheck(job,document,settings,today,balances){
  const current=job.kind==='invoice'?invoice(document,settings):reminders(document,settings,today,balances);
  const matching=current.jobs.find(item=>item.idempotencyKey===job.idempotencyKey&&item.recipient===job.recipient);
  return matching?{status:'eligible',job:matching}:{status:'suppressed',reason:'INVOICE_OR_PAYMENT_STATE_CHANGED'};
}
module.exports={date,minor,phone,email,balance,active,invoice,reminders,recheck};
