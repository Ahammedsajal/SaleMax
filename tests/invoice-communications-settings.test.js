'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const messages=require('../modules/platform/invoice-communications-settings');
const ctx=role=>({audience:'tenant',identity:{id:'identity'},tenant:{id:'tenant',categoryKey:'training_center',categoryVersion:1,status:'active'},membership:{tenantId:'tenant',role,status:'active'},category:{key:'training_center',version:1,capabilities:['finance.invoices']},subscription:{status:'active',capabilities:['finance.invoices']}});
function input(){const {revision,offsetsDays,...value}=messages.defaults();return {...value,expectedRevision:revision};}
test('communication defaults include both channels, the exact requested cadence and daily overdue',()=>{
  const value=messages.defaults();assert.deepEqual(value.offsetsDays,[-7,-3,-1,0]);assert.equal(value.dailyOverdue,true);assert.equal(value.invoiceEmail,true);assert.equal(value.invoiceWhatsapp,true);
  value.templates.overdue.en.body='Modified';assert.notEqual(messages.defaults().templates.overdue.en.body,'Modified');
  assert.equal(messages.normalize(input()).localTime,'09:00');
});
test('editable templates preserve bilingual defaults and accept supported tokens only',()=>{
  const value=input();value.templates.upcoming.en.body='Hi {customer_name}, {amount_due} is due on {due_date}.';assert.equal(messages.normalize(value).templates.upcoming.en.body,value.templates.upcoming.en.body);
  for(const mutate of [v=>v.templates.due.en.body='{password}',v=>v.templates.invoice.en.subject='Header\r\nBcc: anyone',v=>v.templates.overdue.en.body='',v=>v.templates.invoice.en.body='{{invoice_number}}',v=>v.templates.invoice.en.body='x'.repeat(2001),v=>delete v.templates.due.ar]){const invalid=input();mutate(invalid);assert.throws(()=>messages.normalize(invalid));}
});
test('message rendering substitutes only supplied record facts without interpreting replacement syntax',()=>{
  const config=messages.defaults(),values={customer_name:'A $& B',business_name:'Synthetic\r\nBusiness',invoice_number:'INV-TEST',invoice_total:'QAR 1,000.00',amount_due:'QAR 250.00',due_date:'2026-10-24',invoice_url:'https://example.invalid/invoice#token',preferences_url:'https://example.invalid/preferences#token'};
  const message=messages.render(config,'invoice','en',values);assert.match(message.text,/A \$& B/);assert(!/[\r\n]/.test(message.subject));assert.match(messages.render(config,'overdue','ar',values).text,/QAR 250.00/);
  assert.throws(()=>messages.render(config,'invoice','en',{}),{code:'INVOICE_MESSAGE_VALUE_MISSING'});
});
test('settings require owner write authority and validate before any database mutation',async()=>{
  for(const role of ['accountant','manager','agent'])await assert.rejects(messages.save({beginTransaction(){throw Error('must not mutate');}},ctx(role),input()),{code:'PERMISSION_DENIED'});
  for(const invalid of [{...input(),localTime:'24:00'},{...input(),enabled:'true'},{...input(),expectedRevision:-1},{...input(),tenantId:'other'}])await assert.rejects(messages.save({beginTransaction(){throw Error('must not mutate');}},ctx('owner'),invalid));
});
test('stale settings are rolled back instead of overwriting another owner edit',async()=>{
  let rolledBack=false,writes=0;
  const db={async beginTransaction(){},async query(sql){if(sql.startsWith('SELECT id'))return [[{id:'tenant'}]];if(sql.startsWith('SELECT revision'))return [[{revision:2}]];writes++;return [[]];},async rollback(){rolledBack=true;}};
  await assert.rejects(messages.save(db,ctx('owner'),input()),{code:'STALE_INVOICE_COMMUNICATION_SETTINGS'});assert(rolledBack);assert.equal(writes,0);
});
