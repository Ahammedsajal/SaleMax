'use strict';
const moment=require('moment-timezone');
const {minor,money}=require('./business-finance-context');

function windowFor(date,timezone,endAt){
 const start=moment.tz(date,'YYYY-MM-DD',timezone).startOf('day');
 return {from:start.utc().format('YYYY-MM-DD HH:mm:ss.SSS'),to:moment(endAt).utc().format('YYYY-MM-DD HH:mm:ss.SSS')};
}
async function build(db,tenant,{now=new Date(),day}={}){
 const timezone=moment.tz.zone(tenant.timezone)?tenant.timezone:'Asia/Qatar';
 const local=day?moment.tz(day,'YYYY-MM-DD',timezone):moment.tz(now,timezone);
 const date=local.format('YYYY-MM-DD'),monthStart=local.clone().startOf('month').format('YYYY-MM-DD'),periodEnd=moment.min(local.clone().endOf('day'),moment(now));
 const daily=windowFor(date,timezone,periodEnd),mtd=windowFor(monthStart,timezone,periodEnd);
 const [[owner]]=await db.query(`SELECT u.uid,o.legacy_uid_hash FROM sx_legacy_ownership o JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=o.tenant_id AND m.role='owner' AND m.status='active' JOIN user u ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR) WHERE o.tenant_id=? AND o.legacy_uid_hash=CONVERT(SHA2(u.uid,256) USING ascii) COLLATE ascii_bin LIMIT 1`,[tenant.id]);
 if(!owner)throw Object.assign(Error('OWNER_CONTEXT_UNAVAILABLE'),{code:'OWNER_CONTEXT_UNAVAILABLE'});
 const currencies=new Map(),currency=key=>{key=String(key||'QAR').toUpperCase();if(!currencies.has(key))currencies.set(key,{currency:key,daily:{invoices:0,invoiced:0,receipts:0,received:0},month:{invoices:0,invoiced:0,receipts:0,received:0},receivable:0,overdue:0,aging:{days1to30:0,days31to60:0,days61to90:0,daysOver90:0}});return currencies.get(key);};
 const projection=require('./training-finance-dashboard').portfolioSql();
 const [training]=await db.query(`SELECT currency,
 SUM(issued_at>=? AND issued_at<=?) AS daily_invoices,COALESCE(SUM(IF(issued_at>=? AND issued_at<=?,total_minor,0)),0) AS daily_invoiced,
 SUM(issued_at>=? AND issued_at<=?) AS month_invoices,COALESCE(SUM(IF(issued_at>=? AND issued_at<=?,total_minor,0)),0) AS month_invoiced,
 COALESCE(SUM(GREATEST(0,total_minor-collected_minor-credited_minor)),0) AS receivable
 FROM (${projection}) p GROUP BY currency`,[daily.from,daily.to,daily.from,daily.to,mtd.from,mtd.to,mtd.from,mtd.to,tenant.id,tenant.id]);
 for(const r of training){const c=currency(r.currency);c.daily.invoices+=Number(r.daily_invoices||0);c.daily.invoiced+=minor(r.daily_invoiced);c.month.invoices+=Number(r.month_invoices||0);c.month.invoiced+=minor(r.month_invoiced);c.receivable+=minor(r.receivable);}
 const [sales]=await db.query(`SELECT i.currency,
 SUM(i.issued_at>=? AND i.issued_at<=?) AS daily_invoices,COALESCE(SUM(IF(i.issued_at>=? AND i.issued_at<=?,i.total_minor,0)),0) AS daily_invoiced,
 SUM(i.issued_at>=? AND i.issued_at<=?) AS month_invoices,COALESCE(SUM(IF(i.issued_at>=? AND i.issued_at<=?,i.total_minor,0)),0) AS month_invoiced,
 COALESCE(SUM(GREATEST(0,i.total_minor-COALESCE(a.paid,0))),0) AS receivable
 FROM sx_sales_invoices i LEFT JOIN (SELECT tenant_id,invoice_id,SUM(amount_minor) AS paid FROM sx_sales_receipt_allocations WHERE tenant_id=? AND reversed_at IS NULL GROUP BY tenant_id,invoice_id) a ON a.tenant_id=i.tenant_id AND a.invoice_id=i.id WHERE i.tenant_id=? AND i.status='issued' GROUP BY i.currency`,[daily.from,daily.to,daily.from,daily.to,mtd.from,mtd.to,mtd.from,mtd.to,tenant.id,tenant.id]);
 for(const r of sales){const c=currency(r.currency);c.daily.invoices+=Number(r.daily_invoices||0);c.daily.invoiced+=minor(r.daily_invoiced);c.month.invoices+=Number(r.month_invoices||0);c.month.invoiced+=minor(r.month_invoiced);c.receivable+=minor(r.receivable);}
 for(const [table,posted] of [['sx_training_receipts',"EXISTS(SELECT 1 FROM sx_training_payments p WHERE p.tenant_id=r.tenant_id AND p.id=r.payment_id AND p.status='posted')"],['sx_sales_receipts',"r.status='active'"]]){
  const [rows]=await db.query(`SELECT r.currency,
  COUNT(IF(r.received_at>=? AND r.received_at<=?,1,NULL)) AS daily_receipts,COALESCE(SUM(IF(r.received_at>=? AND r.received_at<=?,r.amount_minor,0)),0) AS daily_received,
  COUNT(IF(r.received_at>=? AND r.received_at<=?,1,NULL)) AS month_receipts,COALESCE(SUM(IF(r.received_at>=? AND r.received_at<=?,r.amount_minor,0)),0) AS month_received
  FROM ${table} r WHERE r.tenant_id=? AND ${posted} GROUP BY r.currency`,[daily.from,daily.to,daily.from,daily.to,mtd.from,mtd.to,mtd.from,mtd.to,tenant.id]);
  for(const r of rows){const c=currency(r.currency);c.daily.receipts+=Number(r.daily_receipts||0);c.daily.received+=minor(r.daily_received);c.month.receipts+=Number(r.month_receipts||0);c.month.received+=minor(r.month_received);}
 }
 const installmentSql=require('./training-finance-dashboard').installmentSql();
 const [trainingAging]=await db.query(`SELECT p.currency,COALESCE(SUM(x.open_minor),0) overdue,
 COALESCE(SUM(IF(DATEDIFF(?,x.due_date) BETWEEN 1 AND 30,x.open_minor,0)),0) days1to30,
 COALESCE(SUM(IF(DATEDIFF(?,x.due_date) BETWEEN 31 AND 60,x.open_minor,0)),0) days31to60,
 COALESCE(SUM(IF(DATEDIFF(?,x.due_date) BETWEEN 61 AND 90,x.open_minor,0)),0) days61to90,
 COALESCE(SUM(IF(DATEDIFF(?,x.due_date)>90,x.open_minor,0)),0) daysOver90
 FROM (${installmentSql}) x JOIN (${projection}) p ON p.id=x.invoice_id WHERE x.due_date<? AND x.open_minor>0 GROUP BY p.currency`,[date,date,date,date,tenant.id,tenant.id,tenant.id,tenant.id,date]);
 for(const r of trainingAging){const c=currency(r.currency);c.overdue+=minor(r.overdue);for(const k of Object.keys(c.aging))c.aging[k]+=minor(r[k]);}
 const [salesAging]=await db.query(`SELECT i.currency,COALESCE(SUM(GREATEST(0,i.total_minor-COALESCE(a.paid,0))),0) overdue,
 COALESCE(SUM(IF(DATEDIFF(?,i.due_at) BETWEEN 1 AND 30,GREATEST(0,i.total_minor-COALESCE(a.paid,0)),0)),0) days1to30,
 COALESCE(SUM(IF(DATEDIFF(?,i.due_at) BETWEEN 31 AND 60,GREATEST(0,i.total_minor-COALESCE(a.paid,0)),0)),0) days31to60,
 COALESCE(SUM(IF(DATEDIFF(?,i.due_at) BETWEEN 61 AND 90,GREATEST(0,i.total_minor-COALESCE(a.paid,0)),0)),0) days61to90,
 COALESCE(SUM(IF(DATEDIFF(?,i.due_at)>90,GREATEST(0,i.total_minor-COALESCE(a.paid,0)),0)),0) daysOver90
 FROM sx_sales_invoices i LEFT JOIN (SELECT tenant_id,invoice_id,SUM(amount_minor) paid FROM sx_sales_receipt_allocations WHERE tenant_id=? AND reversed_at IS NULL GROUP BY tenant_id,invoice_id) a ON a.tenant_id=i.tenant_id AND a.invoice_id=i.id WHERE i.tenant_id=? AND i.status='issued' AND i.due_at<? GROUP BY i.currency`,[date,date,date,date,tenant.id,tenant.id,date]);
 for(const r of salesAging){const c=currency(r.currency);c.overdue+=minor(r.overdue);for(const k of Object.keys(c.aging))c.aging[k]+=minor(r[k]);}
 const [leadRows]=await db.query(`SELECT COUNT(*) total FROM pipeline_leads WHERE uid_hash=? AND uid=? AND created_at>=? AND created_at<=?`,[owner.legacy_uid_hash,owner.uid,daily.from,daily.to]);
 const [monthLeadRows]=await db.query(`SELECT COUNT(*) total FROM pipeline_leads WHERE uid_hash=? AND uid=? AND created_at>=? AND created_at<=?`,[owner.legacy_uid_hash,owner.uid,mtd.from,mtd.to]);
 const [dailyApp]=await db.query(`SELECT COUNT(DISTINCT r.submission_id) total FROM sx_training_registrations r WHERE r.tenant_id=? AND r.created_at>=? AND r.created_at<=?`,[tenant.id,daily.from,daily.to]);
 const [monthApp]=await db.query(`SELECT COUNT(DISTINCT r.submission_id) total FROM sx_training_registrations r WHERE r.tenant_id=? AND r.created_at>=? AND r.created_at<=?`,[tenant.id,mtd.from,mtd.to]);
 const converted=async(from,to)=>{const [rows]=await db.query(`SELECT COUNT(DISTINCT l.id) total FROM pipeline_leads l JOIN (
 SELECT p.lead_id FROM (${projection}) p WHERE p.lead_id IS NOT NULL
 UNION SELECT d.lead_id FROM sx_sales_invoices i JOIN sx_sales_deals d ON d.tenant_id=i.tenant_id AND d.id=i.deal_id WHERE i.tenant_id=? AND i.status='issued' AND d.lead_id IS NOT NULL
 ) invoiced ON invoiced.lead_id=l.id WHERE l.uid_hash=? AND l.uid=? AND l.created_at>=? AND l.created_at<=?`,[tenant.id,tenant.id,tenant.id,owner.legacy_uid_hash,owner.uid,from,to]);return Number(rows[0]?.total||0);};
 const leadsDaily=Number(leadRows[0]?.total||0),leadsMonth=Number(monthLeadRows[0]?.total||0);
 const sum=field=>[...currencies.values()].reduce((n,c)=>n+c[field],0);
 return {version:2,business:tenant.name||'7Network',day:date,month:local.format('YYYY-MM'),monthStart,timezone,asOf:moment(now).tz(timezone).format('DD MMM YYYY, h:mm A'),daily:{leads:leadsDaily,convertedLeads:await converted(daily.from,daily.to),applications:Number(dailyApp[0]?.total||0),invoices:[...currencies.values()].reduce((n,c)=>n+c.daily.invoices,0)},monthToDate:{leads:leadsMonth,convertedLeads:await converted(mtd.from,mtd.to),applications:Number(monthApp[0]?.total||0),invoices:[...currencies.values()].reduce((n,c)=>n+c.month.invoices,0)},finance:[...currencies.values()],receivable:sum('receivable'),overdue:sum('overdue')};
}
function text(s){
 const lines=[s.business,'Daily sales summary',`${s.day} · ${s.timezone}`,`As of ${s.asOf}`,'','DAILY',`New leads: ${s.daily?.leads||0}`,`Leads invoiced: ${s.daily?.convertedLeads||0}`,`Applications: ${s.daily?.applications||0}`,`Invoices issued: ${s.daily?.invoices||0}`,'','MONTH TO DATE',`New leads: ${s.monthToDate?.leads||0}`,`Leads invoiced: ${s.monthToDate?.convertedLeads||0}`,`Applications: ${s.monthToDate?.applications||0}`,`Invoices issued: ${s.monthToDate?.invoices||0}`];
 for(const c of s.finance||[])lines.push('',`${c.currency}`,`Today invoiced: ${money(c.daily.invoiced,c.currency)}`,`Today received: ${money(c.daily.received,c.currency)}`,`Month invoiced: ${money(c.month.invoiced,c.currency)}`,`Month received: ${money(c.month.received,c.currency)}`,`Total receivable: ${money(c.receivable,c.currency)}`,`Overdue: ${money(c.overdue,c.currency)}`,...(c.overdue?[`Aging 1–30 days: ${money(c.aging.days1to30,c.currency)}`,`Aging 31–60 days: ${money(c.aging.days31to60,c.currency)}`,`Aging 61–90 days: ${money(c.aging.days61to90,c.currency)}`,`Aging over 90 days: ${money(c.aging.daysOver90,c.currency)}`]:[]));
 lines.push('','Receivable is the open balance on issued invoices after allocated receipts and approved credits. Overdue is shown separately.');return lines.join('\n');
}
function fromSnapshot(s){return s;}
module.exports={build,text,fromSnapshot,windowFor};
