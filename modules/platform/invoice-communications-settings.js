'use strict';
const crypto=require('node:crypto');
const {decision}=require('./policy');
const OFFSETS=Object.freeze([-7,-3,-1,0]);
const KINDS=Object.freeze(['invoice','upcoming','due','overdue']);
const TOKENS=Object.freeze(['customer_name','business_name','invoice_number','invoice_total','amount_due','due_date','invoice_url','preferences_url']);
const FLAGS=Object.freeze(['enabled','invoiceEmail','invoiceWhatsapp','reminderEmail','reminderWhatsapp','dailyOverdue']);
const fail=code=>{throw Object.assign(Error(code),{code,status:code==='PERMISSION_DENIED'?403:code==='STALE_INVOICE_COMMUNICATION_SETTINGS'?409:400});};
function defaults(){return {enabled:true,invoiceEmail:true,invoiceWhatsapp:true,reminderEmail:true,reminderWhatsapp:true,dailyOverdue:true,localTime:'09:00',revision:0,offsetsDays:[...OFFSETS],templates:{
  invoice:{en:{subject:'Invoice {invoice_number} from {business_name}',body:'Hello {customer_name}, your invoice {invoice_number} from {business_name} is ready. Invoice total: {invoice_total}. View your invoice and payment dates: {invoice_url}'},ar:{subject:'فاتورة {invoice_number} من {business_name}',body:'مرحبًا {customer_name}، فاتورتك {invoice_number} من {business_name} جاهزة. إجمالي الفاتورة: {invoice_total}. لعرض الفاتورة ومواعيد الدفع: {invoice_url}'}},
  upcoming:{en:{subject:'Upcoming payment for invoice {invoice_number}',body:'Hello {customer_name}, this is a payment reminder from {business_name}. Your installment for invoice {invoice_number} is due on {due_date}. Remaining installment amount: {amount_due}. View details: {invoice_url}. Reminder preferences: {preferences_url}'},ar:{subject:'موعد دفعة قادمة للفاتورة {invoice_number}',body:'مرحبًا {customer_name}، هذا تذكير بالدفع من {business_name}. يستحق قسط الفاتورة {invoice_number} بتاريخ {due_date}. المبلغ المتبقي للقسط: {amount_due}. التفاصيل: {invoice_url}. تفضيلات التذكير: {preferences_url}'}},
  due:{en:{subject:'Payment due today for invoice {invoice_number}',body:'Hello {customer_name}, your installment for invoice {invoice_number} from {business_name} is due today, {due_date}. Remaining installment amount: {amount_due}. View details: {invoice_url}. If you have paid, please share the payment reference so we can issue your receipt. Reminder preferences: {preferences_url}'},ar:{subject:'دفعة مستحقة اليوم للفاتورة {invoice_number}',body:'مرحبًا {customer_name}، يستحق اليوم {due_date} قسط الفاتورة {invoice_number} من {business_name}. المبلغ المتبقي للقسط: {amount_due}. التفاصيل: {invoice_url}. إذا دفعت بالفعل، يرجى مشاركة مرجع الدفع لإصدار إيصالك. تفضيلات التذكير: {preferences_url}'}},
  overdue:{en:{subject:'Overdue payment for invoice {invoice_number}',body:'Hello {customer_name}, our records show an unpaid installment for invoice {invoice_number} from {business_name}, due on {due_date}. Remaining installment amount: {amount_due}. View details: {invoice_url}. If you have already paid, please share the reference so we can verify it and issue your receipt. Reminder preferences: {preferences_url}'},ar:{subject:'دفعة متأخرة للفاتورة {invoice_number}',body:'مرحبًا {customer_name}، تظهر سجلاتنا قسطًا غير مسدد للفاتورة {invoice_number} من {business_name}، استحق بتاريخ {due_date}. المبلغ المتبقي للقسط: {amount_due}. التفاصيل: {invoice_url}. إذا دفعت بالفعل، يرجى مشاركة المرجع للتحقق منه وإصدار الإيصال. تفضيلات التذكير: {preferences_url}'}}
}};}
function templates(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==KINDS.length||Object.keys(value).some(k=>!KINDS.includes(k)))fail('INVALID_INVOICE_MESSAGE_TEMPLATES');
  const output={};
  for(const kind of KINDS){const entry=value[kind];if(!entry||Object.keys(entry).length!==2||!entry.en||!entry.ar)fail('INVALID_INVOICE_MESSAGE_TEMPLATES');output[kind]={};
    for(const language of ['en','ar']){const fields=entry[language];if(!fields||Object.keys(fields).length!==2||!Object.hasOwn(fields,'subject')||!Object.hasOwn(fields,'body'))fail('INVALID_INVOICE_MESSAGE_TEMPLATES');output[kind][language]={};
      for(const field of ['subject','body']){const text=fields[field];if(typeof text!=='string'||!text.trim()||text.length>(field==='subject'?140:2000)||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)||field==='subject'&&/[\r\n]/.test(text)||/\{\{|\}\}/.test(text))fail('INVALID_INVOICE_MESSAGE_TEMPLATE');
        for(const token of text.matchAll(/\{([^{}]+)\}/g))if(!TOKENS.includes(token[1]))fail('UNKNOWN_INVOICE_MESSAGE_TOKEN');output[kind][language][field]=text.trim();
      }
    }
  }
  return output;
}
function normalize(input){
  const allowed=[...FLAGS,'localTime','templates','expectedRevision'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k))||FLAGS.some(k=>typeof input[k]!=='boolean')||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail('INVALID_INVOICE_COMMUNICATION_SETTINGS');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.localTime||''))fail('INVALID_INVOICE_REMINDER_TIME');
  return {...Object.fromEntries(FLAGS.map(k=>[k,input[k]])),localTime:input.localTime,templates:templates(input.templates),expectedRevision:input.expectedRevision};
}
function authorize(ctx,write=false){
  if(ctx?.audience!=='tenant'||ctx.tenant?.categoryKey!=='training_center'||ctx.tenant?.categoryVersion!==1||ctx.tenant.status!=='active'||ctx.membership?.status!=='active'||ctx.membership.tenantId!==ctx.tenant.id||!ctx.identity?.id)fail('TENANT_CONTEXT_REQUIRED');
  const access=decision(ctx,{capability:'finance.invoices',permission:'invoices.read'});if(!access.allowed)fail(access.code);
  if(!['owner','accountant','manager'].includes(ctx.membership.role)||write&&ctx.membership.role!=='owner')fail('PERMISSION_DENIED');
}
function shape(row){
  if(!row)return defaults();
  return {enabled:Boolean(Number(row.enabled)),invoiceEmail:Boolean(Number(row.invoice_email)),invoiceWhatsapp:Boolean(Number(row.invoice_whatsapp)),reminderEmail:Boolean(Number(row.reminder_email)),reminderWhatsapp:Boolean(Number(row.reminder_whatsapp)),dailyOverdue:Boolean(Number(row.daily_overdue)),localTime:String(row.local_time).slice(0,5),revision:Number(row.revision),offsetsDays:[...OFFSETS],templates:templates(typeof row.templates_json==='string'?JSON.parse(row.templates_json):row.templates_json)};
}
async function get(db,ctx){authorize(ctx);const [[row]]=await db.query('SELECT * FROM sx_invoice_customer_communications WHERE tenant_id=?',[ctx.tenant.id]);return {...shape(row),canEdit:ctx.membership.role==='owner'};}
async function save(db,ctx,input){
  authorize(ctx,true);const data=normalize(input);await db.beginTransaction();
  try{const [[tenant]]=await db.query("SELECT id FROM sx_tenants WHERE id=? AND status='active' FOR UPDATE",[ctx.tenant.id]);if(!tenant)fail('TENANT_CONTEXT_REQUIRED');
    const [[old]]=await db.query('SELECT revision FROM sx_invoice_customer_communications WHERE tenant_id=? FOR UPDATE',[ctx.tenant.id]);if(Number(old?.revision||0)!==data.expectedRevision)fail('STALE_INVOICE_COMMUNICATION_SETTINGS');const revision=data.expectedRevision+1;
    await db.query(`INSERT INTO sx_invoice_customer_communications(tenant_id,enabled,invoice_email,invoice_whatsapp,reminder_email,reminder_whatsapp,daily_overdue,local_time,templates_json,revision,updated_by_identity_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),invoice_email=VALUES(invoice_email),invoice_whatsapp=VALUES(invoice_whatsapp),reminder_email=VALUES(reminder_email),reminder_whatsapp=VALUES(reminder_whatsapp),daily_overdue=VALUES(daily_overdue),local_time=VALUES(local_time),templates_json=VALUES(templates_json),revision=VALUES(revision),updated_by_identity_id=VALUES(updated_by_identity_id),updated_at=UTC_TIMESTAMP(3)`,[ctx.tenant.id,...FLAGS.map(k=>Number(data[k])),data.localTime+':00',JSON.stringify(data.templates),revision,ctx.identity.id]);
    await db.query("INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES(?,?,?,'identity','invoice.communication-settings-updated','invoice-communication-settings',?,?,?)",[crypto.randomUUID(),ctx.tenant.id,ctx.identity.id,ctx.tenant.id,JSON.stringify({revision,templatesHash:crypto.createHash('sha256').update(JSON.stringify(data.templates)).digest('hex'),...Object.fromEntries(FLAGS.map(k=>[k,data[k]]))}),crypto.randomUUID()]);
    await db.commit();const {expectedRevision,...result}=data;return {...result,revision,offsetsDays:[...OFFSETS]};
  }catch(error){try{await db.rollback();}catch{}throw error;}
}
function render(config,kind,language,values){
  if(!KINDS.includes(kind)||!['en','ar'].includes(language))fail('INVALID_INVOICE_MESSAGE_KIND');
  const template=templates(config.templates)[kind][language],replace=text=>text.replace(/\{([^{}]+)\}/g,(_,key)=>{if(!values||!Object.hasOwn(values,key)||values[key]==null||!['string','number'].includes(typeof values[key]))fail('INVOICE_MESSAGE_VALUE_MISSING');return String(values[key]);});
  return {subject:replace(template.subject).replace(/[\r\n]+/g,' '),text:replace(template.body)};
}
module.exports={OFFSETS,KINDS,TOKENS,FLAGS,defaults,templates,normalize,authorize,shape,get,save,render};
