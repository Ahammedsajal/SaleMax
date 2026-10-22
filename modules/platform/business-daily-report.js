'use strict';
const moment=require('moment-timezone');
const {minor,money}=require('./business-finance-context');
async function build(db,tenant,{now=new Date(),day}={}){
 const timezone=moment.tz.zone(tenant.timezone)?tenant.timezone:'Asia/Qatar';const local=day?moment.tz(day,'YYYY-MM-DD',timezone):moment.tz(now,timezone);
 const date=local.format('YYYY-MM-DD'),start=local.clone().startOf('day').utc().format('YYYY-MM-DD HH:mm:ss'),end=moment.min(local.clone().endOf('day'),moment(now)).utc().format('YYYY-MM-DD HH:mm:ss.SSS');
 const [owners]=await db.query(`SELECT u.uid,o.legacy_uid_hash FROM sx_legacy_ownership o JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=o.tenant_id AND m.role='owner' AND m.status='active' JOIN user u ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR) WHERE o.tenant_id=? AND o.legacy_uid_hash=CONVERT(SHA2(u.uid,256) USING ascii) COLLATE ascii_bin LIMIT 2`,[tenant.id]);
 if(owners.length!==1)throw Object.assign(Error('OWNER_CONTEXT_UNAVAILABLE'),{code:'OWNER_CONTEXT_UNAVAILABLE'});const {uid,legacy_uid_hash:uidHash}=owners[0];
 const [[chats]]=await db.query(`SELECT COUNT(*) AS total FROM beta_chats c WHERE c.uid=? AND c.createdAt>=? AND c.createdAt<=? AND EXISTS(SELECT 1 FROM beta_conversation b WHERE b.uid=c.uid AND b.chat_id=c.chat_id AND b.route='INCOMING' AND b.createdAt<=?)`,[uid,start,end,end]);
 const [[leads]]=await db.query('SELECT COUNT(*) AS total FROM pipeline_leads WHERE uid_hash=? AND uid=? AND created_at>=? AND created_at<=?',[uidHash,uid,start,end]);
 const [pipeline]=await db.query('SELECT status,COUNT(*) AS total FROM pipeline_leads WHERE uid_hash=? AND uid=? GROUP BY status',[uidHash,uid]);
 const currencies=new Map(),currency=key=>{if(!currencies.has(key))currencies.set(key,{currency:key,invoices:0,invoiced:0,payments:0,received:0,outstanding:0,overdue:0});return currencies.get(key);};
 // Reuse the Finance dashboard's commercial-invoice projection so a PDF and its
 // posted accounting invoice count once, with archives/replacements excluded.
 const projection=require('./training-finance-dashboard').portfolioSql();
 const [training]=await db.query(`SELECT currency,SUM(issued_at>=? AND issued_at<=?) AS invoices,COALESCE(SUM(IF(issued_at>=? AND issued_at<=?,total_minor,0)),0) AS invoiced,COALESCE(SUM(GREATEST(0,total_minor-collected_minor-credited_minor)),0) AS outstanding FROM (${projection}) p GROUP BY currency`,[start,end,start,end,tenant.id,tenant.id]);
 for(const row of training)Object.assign(currency(row.currency),{invoices:Number(row.invoices||0),invoiced:minor(row.invoiced),outstanding:minor(row.outstanding)});
 const [sales]=await db.query(`SELECT i.currency,SUM(i.issued_at>=? AND i.issued_at<=?) AS invoices,COALESCE(SUM(IF(i.issued_at>=? AND i.issued_at<=?,i.total_minor,0)),0) AS invoiced,COALESCE(SUM(GREATEST(0,i.total_minor-COALESCE(a.paid,0))),0) AS outstanding,COALESCE(SUM(IF(i.due_at<? ,GREATEST(0,i.total_minor-COALESCE(a.paid,0)),0)),0) AS overdue FROM sx_sales_invoices i LEFT JOIN (SELECT tenant_id,invoice_id,SUM(amount_minor) AS paid FROM sx_sales_receipt_allocations WHERE tenant_id=? AND reversed_at IS NULL GROUP BY tenant_id,invoice_id) a ON a.tenant_id=i.tenant_id AND a.invoice_id=i.id WHERE i.tenant_id=? AND i.status='issued' GROUP BY i.currency`,[start,end,start,end,date,tenant.id,tenant.id]);
 for(const row of sales){const c=currency(row.currency);for(const key of ['invoices','invoiced','outstanding','overdue'])c[key]+=minor(row[key]);}
 const [overdue]=await db.query(`SELECT p.currency,COALESCE(SUM(x.open_minor),0) AS total FROM (${require('./training-finance-dashboard').installmentSql()}) x JOIN (${projection}) p ON p.id=x.invoice_id WHERE x.due_date<? GROUP BY p.currency`,[tenant.id,tenant.id,tenant.id,tenant.id,date]);for(const row of overdue)currency(row.currency).overdue+=minor(row.total);
 for(const table of ['sx_training_receipts','sx_sales_receipts']){
  const [rows]=await db.query(`SELECT r.currency,COUNT(*) AS payments,COALESCE(SUM(r.amount_minor),0) AS received FROM ${table} r WHERE r.tenant_id=? AND r.received_at>=? AND r.received_at<=? ${table==='sx_sales_receipts'?"AND r.status='active'":"AND EXISTS(SELECT 1 FROM sx_training_payments p WHERE p.tenant_id=r.tenant_id AND p.id=r.payment_id AND p.status='posted')"} GROUP BY r.currency`,[tenant.id,start,end]);
  for(const r of rows){const c=currency(r.currency);c.payments+=Number(r.payments);c.received+=minor(r.received);}
 }
 return {version:1,business:tenant.name||'7Network',day:date,timezone,asOf:moment(now).tz(timezone).format('DD MMM YYYY, h:mm A'),newChats:Number(chats.total),newLeads:Number(leads.total),pipeline:pipeline.map(r=>({status:r.status,total:Number(r.total)})),finance:[...currencies.values()],invoices:[...currencies.values()].reduce((n,c)=>n+c.invoices,0),payments:[...currencies.values()].reduce((n,c)=>n+c.payments,0)};
}
function text(s,{test=false}={}){
 const lines=[test?'TEST / SAMPLE DAILY REPORT':s.business,'Daily business summary',`${s.day} · ${s.timezone}`,`As of ${s.asOf}`,'',`New incoming chats: ${s.newChats}`,`New leads: ${s.newLeads}`,`Invoices created: ${s.invoices}`,`Payments received: ${s.payments}`,''];
 for(const c of s.finance||[])lines.push(`${c.currency} totals`,`Invoiced today: ${money(c.invoiced,c.currency)}`,`Received today: ${money(c.received,c.currency)}`,`Outstanding balance: ${money(c.outstanding,c.currency)}`,`Overdue balance: ${money(c.overdue,c.currency)}`,'');
 if(s.pipeline?.length)lines.push('Current lead pipeline',...s.pipeline.map(r=>`${String(r.status).replace(/_/g,' ')}: ${r.total}`),'');
 lines.push('Your detailed PDF report follows.','Today’s activity is counted up to the time shown. Outstanding balances are current.');return lines.join('\n');
}
function fromSnapshot(s){const f=s.dashboardFinance||{},base=s.finance||{},summary=s.summary||{};return {business:s.business||'7Network',day:String(s.from||'').slice(0,10),timezone:s.timezone||'Asia/Qatar',asOf:String(s.to||'').slice(0,16).replace('T',' '),newChats:Number(summary.newChats||0),newLeads:Number(summary.leadsCreated||0),invoices:Number(f.invoice_count??base.issuedInvoiceCount??0),payments:Number(base.paymentsReceivedCount||0),pipeline:[],finance:[{currency:base.currency||'QAR',invoices:Number(f.invoice_count??base.issuedInvoiceCount??0),payments:Number(base.paymentsReceivedCount||0),invoiced:Number(f.sales_minor??base.billedMinor??0),received:Number(f.received_minor??base.cashReceivedMinor??0),outstanding:Number(f.receivable_minor??base.allOutstandingMinor??0),overdue:Number(f.overdue_minor??base.overdueReceivablesMinor??0)}]};}
module.exports={build,text,fromSnapshot};
