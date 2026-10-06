const test=require('node:test');
const assert=require('node:assert/strict');
const generator=require('../modules/platform/invoice-generator');
const crypto=require('node:crypto');

function context(role='owner'){
  return {audience:'tenant',identity:{id:'identity-1'},tenant:{id:'tenant-1',status:'active',categoryKey:'training_center',categoryVersion:1},membership:{tenantId:'tenant-1',role,status:'active'},category:{key:'training_center',version:1,capabilities:['finance.invoices']},subscription:{status:'active',capabilities:['finance.invoices']}};
}
const settings={company_name:'Training Co',cr_number:'CR-123',company_address:'Doha, Qatar',footer:'Thank you',logo_data_url:null,invoice_prefix:'INV',payment_plans:JSON.stringify([{id:'full',label:'Full payment',installments:1,intervalDays:0}]),last_number:0};
const input={requestKey:'8e631ffe-f749-43c2-af8a-eaa7516bb776',customerType:'manual',customerName:'Synthetic Learner',customerAddress:'Doha',courseId:'a419050e-16b8-4f60-b77d-a956ce855e1c',installments:[{dueDate:'2026-10-05',amountMinor:10000}]};
function fakeDb(prior=null){
  const calls=[];let transaction=false;
  return {calls,get transaction(){return transaction;},async query(sql,params){calls.push({sql,params});
    if(sql.includes('FROM sx_invoice_generator_settings')&&!sql.includes('FOR UPDATE'))return [[settings]];
    if(sql.includes('FROM sx_training_courses c JOIN'))return [[{id:input.courseId,nameEn:'Course',nameAr:'دورة',code:'C1',offerVersion:1,currency:'QAR',amountMinor:10000}]];
    if(sql.includes('SELECT id FROM sx_tenants'))return [[{id:'tenant-1'}]];
    if(sql.includes('FROM sx_invoice_generator_settings')&&sql.includes('FOR UPDATE'))return [[settings]];
    if(sql.includes('FROM sx_invoice_generator_documents')&&sql.includes('request_key'))return [prior?[prior]:[]];
    if(sql.startsWith('INSERT INTO sx_invoice_generator_documents'))return [{affectedRows:1}];
    return [[]];
  },async beginTransaction(){transaction=true;calls.push({sql:'BEGIN'});},async commit(){calls.push({sql:'COMMIT'});},async rollback(){calls.push({sql:'ROLLBACK'});}};
}

test('invoice generation is available to tenant owners and rejects roles before database access',()=>{
  assert.doesNotThrow(()=>generator.requireRole(context()));
  assert.throws(()=>generator.requireRole(context('manager'),true),{code:'PERMISSION_DENIED'});
});

test('manual invoice creation stores a no-tax snapshot and advances a locked tenant sequence',async()=>{
  const db=fakeDb();const result=await generator.create(db,context(),{uid:'legacy-owner',input});
  assert.equal(result.taxMinor,0);assert.equal(result.taxMode,'no_tax');assert.equal(result.customer.name,'Synthetic Learner');
  assert.equal(result.installments[0].amountMinor,10000);assert.match(result.invoiceNumber,/^INV-\d{4}-000001$/);
  assert.ok(db.calls.some(call=>call.sql==='BEGIN'));assert.ok(db.calls.some(call=>call.sql.includes('sx_invoice_generator_settings')&&call.sql.includes('FOR UPDATE')));
  assert.ok(db.calls.some(call=>call.sql.startsWith('INSERT INTO sx_invoice_generator_documents')));assert.equal(db.calls.at(-1).sql,'COMMIT');
});

test('identical invoice retries return the original snapshot without creating another document',async()=>{
  const firstDb=fakeDb();const first=await generator.create(firstDb,context(),{uid:'legacy-owner',input});
  const hash=crypto.createHash('sha256').update(JSON.stringify({customerType:'manual',customerId:null,customerName:'Synthetic Learner',customerAddress:'Doha',customerPhone:null,customerEmail:null,courseId:input.courseId,paymentPlan:null,installments:input.installments})).digest('hex');
  const prior={id:first.id,snapshot:JSON.stringify(first),payload_hash:hash};const retryDb=fakeDb(prior);const retry=await generator.create(retryDb,context(),{uid:'legacy-owner',input});
  assert.equal(retry.repeated,true);assert.equal(retry.id,first.id);assert.equal(retryDb.calls.some(call=>call.sql.startsWith('INSERT INTO sx_invoice_generator_documents')),false);
});

test('payment schedule totals must match the selected course price',async()=>{
  const db=fakeDb();await assert.rejects(generator.create(db,context(),{uid:'legacy-owner',input:{...input,installments:[{dueDate:'2026-10-05',amountMinor:9999}]}}),{code:'PAYMENT_SCHEDULE_TOTAL_MISMATCH'});
  assert.equal(db.calls.some(call=>call.sql==='BEGIN'),false);
});

test('legacy generated invoices acquire Business Profile branding when opened and preserve existing issue snapshots',async()=>{
  const id='d38c7530-feba-4e44-8e43-a28e6b83e8f1',queries=[];
  const db={async query(sql){queries.push(sql);if(sql.includes('FROM sx_invoice_generator_documents'))return [[{snapshot:JSON.stringify({id,companyName:'Old Settings Name',logoDataUrl:'legacy-logo'})}]];if(sql.includes('SELECT t.name AS tenantName'))return [[{tenantName:'Tenant',nameEn:'Current Center',nameAr:'المركز الحالي',logoUrl:'/media/current.png'}]];throw new Error(`Unexpected query: ${sql}`);}};
  const current=await generator.detail(db,context(),id);assert.deepEqual(current.businessProfile,{nameEn:'Current Center',nameAr:'المركز الحالي',logoUrl:'/media/current.png'});assert.equal(current.companyName,'Old Settings Name');
  const existing={...current,businessProfile:{nameEn:'Issued Center',nameAr:'مركز الإصدار',logoUrl:'/media/issued.png'}};
  db.query=async sql=>sql.includes('FROM sx_invoice_generator_documents')?[[{snapshot:JSON.stringify(existing)}]]:[[]];
  const preserved=await generator.detail(db,context(),id);assert.deepEqual(preserved.businessProfile,existing.businessProfile);
});
