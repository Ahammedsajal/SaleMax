'use strict';
const crypto=require('node:crypto');
const moment=require('moment-timezone');
const qr=require('./business-whatsapp');
const finance=require('./business-finance-context');
const reports=require('./business-daily-report');
const KINDS=new Set(['invoice_issued','payment_due','payment_received','daily_summary']);
function dailyReportAllowed(categoryKey,caps){
 const finance=caps.includes('finance.invoices')||caps.includes('sales.finance');
 const defaultOwnerReport=categoryKey==='7network_sales'||categoryKey==='salemax_sales';
 return finance&&caps.includes('reports.read')&&(caps.includes('reports.schedule')||defaultOwnerReport);
}
let tenantScanCursor='';
async function enqueue(db,tenantId,{kind,sourceType,sourceId,key,payload=null}){
 if(!KINDS.has(kind)||!/^[-a-z_]{3,32}$/.test(sourceType)||!/^[-0-9a-f]{36}$/i.test(sourceId)||typeof key!=='string'||key.length>191)throw Error('INVALID_BUSINESS_NOTIFICATION');
 const id=crypto.randomUUID();try{await db.query('INSERT INTO sx_business_notification_events(id,tenant_id,event_key,kind,source_type,source_id,payload_json) VALUES (?,?,?,?,?,?,?)',[id,tenantId,key,kind,sourceType,sourceId,payload?JSON.stringify(payload):null]);return {id,repeated:false};}
 catch(e){if(e.code!=='ER_DUP_ENTRY')throw e;return {repeated:true};}
}
async function due(db,tenant,today){
 const portfolio=require('./training-finance-dashboard').portfolioSql(),installments=require('./training-finance-dashboard').installmentSql();
 const canonical="COALESCE((SELECT l.generated_document_id FROM sx_training_generated_invoice_links l WHERE l.tenant_id=? AND l.invoice_id=p.id LIMIT 1),p.id)";
 const [rows]=await db.query(`SELECT p.id,p.kind,${canonical} AS canonical_id,SUM(x.open_minor) AS due FROM (${portfolio}) p JOIN (${installments}) x ON x.invoice_id=p.id WHERE x.due_date=? AND x.open_minor>0 AND p.total_minor-p.collected_minor-p.credited_minor>0 AND NOT EXISTS(SELECT 1 FROM sx_business_notification_events e WHERE e.tenant_id=? AND e.event_key=CONCAT('due:',${canonical},':',?)) GROUP BY p.id,p.kind ORDER BY p.id LIMIT 500`,[tenant.id,tenant.id,tenant.id,tenant.id,tenant.id,today,tenant.id,tenant.id,today]);
 for(const row of rows)await enqueue(db,tenant.id,{kind:'payment_due',sourceType:row.kind==='generated'?'generated':'training_invoice',sourceId:row.id,key:`due:${row.canonical_id}:${today}`,payload:{dueDate:today}});
 const [sales]=await db.query(`SELECT i.id FROM sx_sales_invoices i WHERE i.tenant_id=? AND i.status='issued' AND i.due_at=? AND i.total_minor>COALESCE((SELECT SUM(a.amount_minor) FROM sx_sales_receipt_allocations a JOIN sx_sales_receipts r ON r.tenant_id=a.tenant_id AND r.id=a.receipt_id AND r.status='active' WHERE a.tenant_id=i.tenant_id AND a.invoice_id=i.id AND a.reversed_at IS NULL),0) AND NOT EXISTS(SELECT 1 FROM sx_business_notification_events e WHERE e.tenant_id=i.tenant_id AND e.event_key=CONCAT('due:',i.id,':',?)) ORDER BY i.id LIMIT 500`,[tenant.id,today,today]);
 for(const row of sales)await enqueue(db,tenant.id,{kind:'payment_due',sourceType:'sales_invoice',sourceId:row.id,key:`due:${row.id}:${today}`,payload:{dueDate:today}});
}
async function scanTenant(db,tenant,{now=new Date()}={}){
 const entitlements=await require('./plans').loadEntitlements(db,tenant.id);
 if(!entitlements||!['active','trial','grace'].includes(entitlements.status))return;
 const caps=entitlements.capabilities||[],canFinance=caps.includes('finance.invoices')||caps.includes('sales.finance'),canReports=dailyReportAllowed(tenant.category_key,caps);if(!canFinance&&!canReports)return;
 await db.query('INSERT INTO sx_business_notification_settings(tenant_id) VALUES (?) ON DUPLICATE KEY UPDATE tenant_id=VALUES(tenant_id)',[tenant.id]);
 const [[settings]]=await db.query('SELECT * FROM sx_business_notification_settings WHERE tenant_id=?',[tenant.id]);if(!Number(settings.enabled))return;
 const timezone=moment.tz.zone(tenant.timezone)?tenant.timezone:'Asia/Qatar',local=moment.tz(now,timezone),today=local.format('YYYY-MM-DD');
 if(canFinance){const [[preference]]=await db.query('SELECT enabled FROM sx_training_reminder_settings WHERE tenant_id=?',[tenant.id]);if(!preference||Number(preference.enabled)===1)await due(db,tenant,today);}
 if(!canReports||!Number(settings.daily_enabled))return;
 const [[schedule]]=await db.query(`SELECT s.local_time,s.timezone,s.status,s.whatsapp_enabled,EXISTS(SELECT 1 FROM sx_training_report_recipients r WHERE r.tenant_id=s.tenant_id AND r.channel='whatsapp' AND r.status='verified') AS has_verified FROM sx_training_report_schedules s WHERE s.tenant_id=? AND s.period='daily' LIMIT 1`,[tenant.id]);
 if(schedule?.status==='paused')return;
 // Existing configured Training Center daily reports retain their scheduler and
 // verified recipients; that delivery path also attaches the same PDF layout.
 if(tenant.category_key==='training_center'&&schedule?.status==='active'&&Number(schedule.whatsapp_enabled)&&Number(schedule.has_verified)){
  const owners=await qr.staff(db,tenant.id,{ownerOnly:true});const phone=owners.find(r=>r.phone)?.phone;
  if(phone){const [[verified]]=await db.query("SELECT id FROM sx_training_report_recipients WHERE tenant_id=? AND channel='whatsapp' AND REPLACE(destination,'+','')=? AND status='verified' LIMIT 1",[tenant.id,phone]);if(verified)return;}
 }
 const at=String(schedule?.status==='active'?schedule.local_time:settings.daily_time).slice(0,5);
 if(local.format('HH:mm')<at)return;
 await enqueue(db,tenant.id,{kind:'daily_summary',sourceType:'tenant',sourceId:tenant.id,key:`daily:${today}`,payload:{day:today,timezone}});
}
async function prepare(db,event,tenant){
 const meta=finance.parse(event.payload_json);let data;
 if(event.kind==='daily_summary')data=await reports.build(db,tenant,{day:meta.day});else data=await finance.load(db,event);
 if(!data){await db.query("UPDATE sx_business_notification_events SET status='failed',last_error_code='FINANCE_RESOURCE_CLOSED_OR_UNAVAILABLE' WHERE id=? AND tenant_id=?",[event.id,event.tenant_id]);return;}
 const members=data.customerOnly?[]:await qr.staff(db,event.tenant_id,{ownerOnly:event.kind==='daily_summary'});
 if(['payment_due','payment_received'].includes(event.kind)&&event.source_type!=='sales_receipt'){
  let optedOut=false;if(event.kind==='payment_due'&&data.invoiceId){const [[p]]=await db.query('SELECT status FROM sx_training_reminder_preferences WHERE tenant_id=? AND invoice_id=?',[event.tenant_id,data.invoiceId]);optedOut=p?.status==='opted_out';}
  if(!optedOut)members.push({kind:'customer',id:data.invoiceId||event.source_id,phone:qr.phone(data.phone,{countryCode:tenant.timezone==='Asia/Qatar'?'974':undefined})});
 }
 const seen=new Set();for(const member of members){const destination=qr.hash(member.phone||`missing:${member.id}`);if(seen.has(destination))continue;seen.add(destination);
  for(const part of event.kind==='daily_summary'?['text','pdf']:['text'])await db.query('INSERT INTO sx_business_notification_deliveries(tenant_id,event_id,recipient_kind,recipient_id,destination_hash,part) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id',[event.tenant_id,event.id,member.kind,member.id,destination,part]);
 }
 await db.query("UPDATE sx_business_notification_events SET status='prepared',payload_json=? WHERE id=? AND tenant_id=?",[JSON.stringify({...meta,snapshot:data,business:tenant.name||'7Network'}),event.id,event.tenant_id]);
}
async function claim(db){
 await db.beginTransaction();try{
  // An interrupted send may already have reached WhatsApp. It requires review,
  // rather than an automatic resend after a lease expires.
  await db.query("UPDATE sx_business_notification_deliveries SET status='unknown',lease_token=NULL,lease_expires_at=NULL,error_code='WORKER_SEND_OUTCOME_UNKNOWN' WHERE status='sending' AND lease_expires_at<=UTC_TIMESTAMP(3)");
  const [[item]]=await db.query(`SELECT d.*,e.kind,e.source_type,e.source_id,e.payload_json,t.name,t.timezone FROM sx_business_notification_deliveries d JOIN sx_business_notification_events e ON e.tenant_id=d.tenant_id AND e.id=d.event_id JOIN sx_tenants t ON t.id=d.tenant_id AND t.status='active' JOIN sx_business_notification_settings s ON s.tenant_id=t.id AND s.enabled=1 WHERE d.status IN ('queued','blocked') AND d.available_at<=UTC_TIMESTAMP(3) AND (d.part='text' OR EXISTS(SELECT 1 FROM sx_business_notification_deliveries x WHERE x.event_id=d.event_id AND x.destination_hash=d.destination_hash AND x.part='text' AND x.status='accepted')) ORDER BY d.id LIMIT 1 FOR UPDATE SKIP LOCKED`);
  if(!item){await db.commit();return null;}const token=crypto.randomUUID();await db.query("UPDATE sx_business_notification_deliveries SET status='sending',attempts=attempts+1,lease_token=?,lease_expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 120 SECOND) WHERE id=?",[token,item.id]);await db.commit();return {...item,token,attempts:Number(item.attempts)+1};
 }catch(e){await db.rollback();throw e;}
}
async function allowed(db,item){const e=await require('./plans').loadEntitlements(db,item.tenant_id);if(!e||!['active','trial','grace'].includes(e.status))return false;const caps=e.capabilities||[],finance=caps.includes('finance.invoices')||caps.includes('sales.finance');return item.kind==='daily_summary'?dailyReportAllowed(e.categoryKey,caps):finance;}
async function dispatch(db,item,{send=qr.send,authorize=allowed}={}){
 if(!await authorize(db,item))return {status:'suppressed',errorCode:'BUSINESS_NOTIFICATION_FEATURE_UNAVAILABLE'};
 const meta=finance.parse(item.payload_json);let current=null;
 if(item.kind!=='daily_summary'){current=await finance.load(db,{...item,tenant_id:item.tenant_id});if(!current)return {status:'suppressed',errorCode:'FINANCE_RESOURCE_CLOSED_OR_UNAVAILABLE'};}
 let to;if(item.recipient_kind==='identity'){const members=await qr.staff(db,item.tenant_id,{ownerOnly:item.kind==='daily_summary'});to=members.find(r=>r.id===item.recipient_id)?.phone;}else if(item.recipient_kind==='report_recipient'){
  const [[r]]=await db.query("SELECT destination FROM sx_training_report_recipients WHERE tenant_id=? AND id=? AND channel='whatsapp' AND status='verified'",[item.tenant_id,item.recipient_id]);to=qr.phone(r?.destination);
  if(item.kind==='daily_summary'){const owners=await qr.staff(db,item.tenant_id,{ownerOnly:true});if(!owners.some(owner=>owner.phone&&qr.hash(owner.phone)===qr.hash(to||'')))return {status:'suppressed',errorCode:'DAILY_REPORT_OWNER_ONLY'};}
 }else{
  to=qr.phone(current?.phone,{countryCode:item.timezone==='Asia/Qatar'?'974':undefined});if(item.kind==='payment_due'){const [[p]]=await db.query('SELECT status FROM sx_training_reminder_preferences WHERE tenant_id=? AND invoice_id=?',[item.tenant_id,current.invoiceId]);if(p?.status==='opted_out')return {status:'suppressed',errorCode:'CUSTOMER_REMINDERS_OPTED_OUT'};}
 }
 if(!to)return {status:'blocked',errorCode:'RECIPIENT_PHONE_MISSING'};
 if(qr.hash(to)!==item.destination_hash){
  if(item.destination_hash!==qr.hash(`missing:${item.recipient_id}`))return {status:'suppressed',errorCode:'RECIPIENT_NUMBER_CHANGED'};
  try{await db.query("UPDATE sx_business_notification_deliveries SET destination_hash=? WHERE tenant_id=? AND event_id=? AND recipient_kind=? AND recipient_id=? AND destination_hash=? AND status IN ('sending','queued','blocked')",[qr.hash(to),item.tenant_id,item.event_id,item.recipient_kind,item.recipient_id,item.destination_hash]);}catch(e){if(e.code==='ER_DUP_ENTRY')return {status:'suppressed',errorCode:'DUPLICATE_RECIPIENT'};throw e;}
 }
 if(item.kind==='payment_due'&&meta.dueDate!==moment.tz(new Date(),item.timezone||'Asia/Qatar').format('YYYY-MM-DD'))return {status:'suppressed',errorCode:'REMINDER_DATE_PASSED'};
 const snapshot=item.kind==='daily_summary'?meta.snapshot:current;
 const text=item.kind==='daily_summary'?(meta.reportText||reports.text(snapshot)):finance.message(item.kind,snapshot,{business:meta.business});
 const pdf=item.part==='pdf'?await require('./business-report-pdf').render(snapshot):null;
 const safeBusiness=String(snapshot.business||'7Network').normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu,'_').replace(/^_+|_+$/g,'').slice(0,60)||'7Network';
 return send(db,{tenantId:item.tenant_id,to,text:item.part==='pdf'?`${safeBusiness} sale summary report · ${snapshot.day}`:text,pdf,fileName:`${safeBusiness}_sale_summary_report.pdf`});
}
async function finish(db,item,result){
 let {status}=result;if(!['accepted','blocked','failed','unknown','suppressed'].includes(status))status='unknown';if(status==='blocked'&&item.attempts>=16&&item.kind!=='daily_summary')status='failed';
 const [updated]=await db.query(`UPDATE sx_business_notification_deliveries SET status=?,error_code=?,provider_message_id=?,accepted_at=IF(?='accepted',UTC_TIMESTAMP(3),NULL),available_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND),lease_token=NULL,lease_expires_at=NULL WHERE id=? AND tenant_id=? AND status='sending' AND lease_token=?`,[status,result.errorCode||null,result.providerMessageId||null,status,Math.min(3600,30*2**Math.min(item.attempts,7)),item.id,item.tenant_id,item.token]);
 if(updated.affectedRows!==1)throw Object.assign(Error('BUSINESS_NOTIFICATION_LEASE_LOST'),{code:'BUSINESS_NOTIFICATION_LEASE_LOST'});
 return status;
}
async function scheduledReport(db,{tenantId,to,snapshot,text}){
 const owners=await qr.staff(db,tenantId,{ownerOnly:true}),owner=owners.find(r=>r.phone&&qr.hash(r.phone)===qr.hash(qr.phone(to)||''));
 if(!owner)return {status:'failed',errorCode:'DAILY_REPORT_OWNER_ONLY'};
 const [[recipient]]=await db.query("SELECT id FROM sx_training_report_recipients WHERE tenant_id=? AND channel='whatsapp' AND destination=? AND status='verified' LIMIT 1",[tenantId,to]);
 if(!recipient)return {status:'failed',errorCode:'REPORT_DESTINATION_NOT_VERIFIED'};
 const [[tenant]]=await db.query("SELECT id,name,timezone FROM sx_tenants WHERE id=? AND status='active'",[tenantId]);if(!tenant)return {status:'failed',errorCode:'REPORT_TENANT_UNAVAILABLE'};
 const timezone=snapshot.timezone||tenant.timezone||'Asia/Qatar',day=moment.utc(snapshot.from).tz(timezone).format('YYYY-MM-DD'),key=`daily:${day}`;
 const data=await reports.build(db,tenant,{day});await db.beginTransaction();try{
  await enqueue(db,tenantId,{kind:'daily_summary',sourceType:'tenant',sourceId:tenantId,key,payload:{day,timezone,snapshot:data,business:tenant.name,reportText:text}});
  const [[event]]=await db.query('SELECT id,status FROM sx_business_notification_events WHERE tenant_id=? AND event_key=? FOR UPDATE',[tenantId,key]);
  if(event.status==='queued')await db.query("UPDATE sx_business_notification_events SET status='prepared',payload_json=? WHERE tenant_id=? AND id=?",[JSON.stringify({day,timezone,snapshot:data,business:tenant.name,reportText:reports.text(data)}),tenantId,event.id]);
  const hash=qr.hash(qr.phone(to));for(const part of ['text','pdf'])await db.query("INSERT INTO sx_business_notification_deliveries(tenant_id,event_id,recipient_kind,recipient_id,destination_hash,part) VALUES (?,?,'identity',?,?,?) ON DUPLICATE KEY UPDATE id=id",[tenantId,event.id,owner.id,hash,part]);
  const [parts]=await db.query('SELECT status,provider_message_id FROM sx_business_notification_deliveries WHERE tenant_id=? AND event_id=? AND destination_hash=?',[tenantId,event.id,hash]);await db.commit();
  if(parts.length===2&&parts.every(p=>p.status==='accepted'))return {status:'accepted',providerMessageId:parts.find(p=>p.provider_message_id)?.provider_message_id};
  if(parts.some(p=>p.status==='unknown'))return {status:'unknown',errorCode:'DAILY_REPORT_DELIVERY_UNCONFIRMED'};
  if(parts.some(p=>['failed','suppressed'].includes(p.status)))return {status:'failed',errorCode:'DAILY_REPORT_DELIVERY_FAILED'};
  return {status:'retry',errorCode:'DAILY_REPORT_DELIVERY_PENDING'};
 }catch(e){await db.rollback();throw e;}
}
async function tick(pool,{scan=true,now=new Date(),limit=20}={}){
 const totals={prepared:0,accepted:0,blocked:0,unknown:0};const db=await pool.getConnection();
 try{
  if(scan){const [tenants]=await db.query("SELECT id,name,category_key,timezone FROM sx_tenants WHERE status='active' AND id>? ORDER BY id LIMIT 100",[tenantScanCursor]);tenantScanCursor=tenants.length===100?tenants.at(-1).id:'';for(const tenant of tenants)try{await scanTenant(db,tenant,{now});}catch(e){console.error(JSON.stringify({event:'business_notification_scan_failed',code:e.code||'SCAN_FAILED'}));}}
  for(let i=0;i<limit;i++){
   await db.beginTransaction();try{const [[event]]=await db.query("SELECT e.*,t.name,t.timezone FROM sx_business_notification_events e JOIN sx_tenants t ON t.id=e.tenant_id AND t.status='active' JOIN sx_business_notification_settings s ON s.tenant_id=t.id AND s.enabled=1 WHERE e.status='queued' ORDER BY e.created_at,e.id LIMIT 1 FOR UPDATE SKIP LOCKED");if(!event){await db.commit();break;}await prepare(db,event,{id:event.tenant_id,name:event.name,timezone:event.timezone});await db.commit();totals.prepared++;}catch(e){await db.rollback();throw e;}
  }
 }finally{db.release();}
 for(let i=0;i<limit;i++){const c=await pool.getConnection();try{const item=await claim(c);if(!item)break;let result;try{result=await dispatch(c,item);}catch(e){result={status:'unknown',errorCode:e.code||'BUSINESS_SEND_UNCONFIRMED'};}const status=await finish(c,item,result);if(status in totals)totals[status]++;}finally{c.release();}}
 return totals;
}
function start({env=process.env,pool}={}){
 if(env.LOCAL_ONLY_MODE==='true'||env.SALEMAX_BUSINESS_NOTIFICATIONS_ENABLED!=='true')return {stop(){}};
 pool=pool||require('../../database/config').promise();let stopped=false,busy=false,timer,scanAt=0;
 const loop=async()=>{if(stopped||busy)return;busy=true;try{const scan=Date.now()-scanAt>60000;const result=await tick(pool,{scan});if(scan)scanAt=Date.now();if(result.prepared||result.accepted||result.unknown)console.log(JSON.stringify({businessNotifications:result}));}catch(e){console.error(JSON.stringify({event:'business_notifications_failed',code:e.code||'WORKER_FAILED'}));}finally{busy=false;if(!stopped)timer=setTimeout(loop,15000);}};
 timer=setTimeout(loop,20000);return {stop(){stopped=true;clearTimeout(timer);}};
}
module.exports={enqueue,due,scanTenant,prepare,claim,dispatch,finish,scheduledReport,tick,start};
