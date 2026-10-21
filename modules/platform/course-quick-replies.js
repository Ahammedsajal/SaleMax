'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const courses = require('./training-courses');
const catalog = require('./product-catalog');
function catalogCapability(ctx){const kind=catalog.kind(ctx);return kind==='products'?'products.catalog':kind==='courses'?'training.courses':null;}
function requireCatalog(ctx){const capability=catalogCapability(ctx);if(!['active','trial','grace'].includes(ctx.subscription?.status)||!capability||!ctx.category?.capabilities.includes(capability)||!ctx.subscription?.capabilities.includes(capability))fail('FEATURE_UNAVAILABLE',403);}
const media = require('./training-course-media');
const access = require('./team-inbox-scope');
const fail = (code, status = 409) => { throw Object.assign(new Error(code), { code, status }); };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const validId = value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);

async function context(pool, actor, agent, owner) {
  const query = async (sql, args) => (await pool.query(sql, args))[0];
  const scope = await access.resolveInboxScope(query, { ...actor, isAgent: agent }, 'send_chat_message');
  if (!scope.canonical && agent) {
    if (!owner?.uid || actor.owner_uid !== owner.uid || !actor.is_active) fail('PERMISSION_DENIED', 403);
    scope.uid = owner.uid;
  }
  const ctx = await courses.legacyOwnerContext(pool, scope.uid,{allowProducts:true});
  requireCatalog(ctx);
  return { scope, ctx, actor, agent, query, refresh:async()=>{
    const rows=await query(`SELECT * FROM ${agent?'agents':'user'} WHERE id=? LIMIT 1`,[actor.id]);
    if(rows.length!==1||rows[0].uid!==actor.uid)fail('PERMISSION_DENIED',403);
    return context(pool,rows[0],agent,owner);
  } };
}
async function sessionContext(pool,session){
  if(!session.context)return context(pool,session.actor,session.agent,session.owner);
  const ctx=session.context,result=require('./policy').decision(ctx,{capability:'messaging.inbox',permission:'conversations.reply'});
  if(!result.allowed)fail(result.code,403);
  requireCatalog(ctx);
  const query=async(sql,args)=>(await pool.query(sql,args))[0];
  const scope=session.actor?await access.resolveInboxScope(query,{...session.actor,isAgent:session.agent},'send_chat_message'):{canonical:true,uid:session.ownerUid,identityId:ctx.identity.id,assignedOnly:ctx.membership.role!=='owner',sharedQrInstances:[],ctx};
  return {scope,ctx,actor:session.actor||{uid:session.ownerUid},agent:session.agent,query,refresh:async()=>sessionContext(pool,await session.refresh())};
}
async function options(pool,c){
  requireCatalog(c.ctx);pool=catalog.forContext(pool,c.ctx);
  return (await pool.query("SELECT id,name_en AS nameEn,name_ar AS nameAr FROM sx_training_courses WHERE tenant_id=? AND status='active' AND deleted_at IS NULL ORDER BY name_en,name_ar,id",[c.ctx.tenant.id]))[0];
}
async function conversation(c, chatId) {
  if (typeof chatId !== 'string' || !chatId || chatId.length > 255) fail('INVALID_CONVERSATION', 400);
  const rows = await c.query('SELECT * FROM beta_chats WHERE uid=? AND chat_id=? LIMIT 1', [c.scope.uid, chatId]);
  if (rows.length !== 1) fail('CONVERSATION_NOT_AVAILABLE', 403);
  const chat = rows[0];
  if (c.scope.canonical && c.scope.assignedOnly && !access.filterAssignedChats(rows, c.scope).length) fail('PERMISSION_DENIED', 403);
  if (!c.scope.canonical && c.agent) {
    let assigned; try { assigned = JSON.parse(chat.assigned_agent || '[]'); } catch { assigned = []; }
    if (!Array.isArray(assigned) || !assigned.some(a => a.uid === c.actor.uid)) fail('PERMISSION_DENIED', 403);
  }
  if (!['qr', 'meta'].includes(chat.origin) || chat.isGroup) fail('CHANNEL_NOT_SUPPORTED');
  return chat;
}
function textParts(course, offer, language, products=false) {
  const ar = language === 'ar';
  const pick = key => course[key + (ar ? '_ar' : '_en')] || course[key + (ar ? '_en' : '_ar')] || '';
  const title = pick('name');
  const parts = [];
  const add = text => { for (let i = 0; i < text.length; i += 3500) parts.push({ kind: 'text', text: text.slice(i, i + 3500) }); };
  add([title, pick('description')].filter(Boolean).join('\n\n'));
  const details = [];
  if (course.duration_value) details.push(`${ar ? 'المدة' : 'Duration'}: ${course.duration_value} ${ar ? ({hours:'ساعات',days:'أيام',weeks:'أسابيع',months:'أشهر'}[course.duration_unit] || course.duration_unit) : course.duration_unit}`);
  if (course.delivery_mode) details.push(`${ar ? 'طريقة الدراسة' : 'Delivery'}: ${(ar ? {in_person:'حضوري',online:'عبر الإنترنت',hybrid:'مدمج'} : {in_person:'In person',online:'Online',hybrid:'Hybrid'})[course.delivery_mode] || course.delivery_mode}`);
  if (offer) {
    details.push(`${products?(ar?'السعر':'Price'):(ar?'رسوم الدورة':'Course fee')}: ${offer.currency} ${(Number(offer.price_minor) / 100).toFixed(2)}`);
    if (Number(offer.registration_fee_minor)) details.push(`${ar ? 'رسوم التسجيل' : 'Registration fee'}: ${offer.currency} ${(Number(offer.registration_fee_minor) / 100).toFixed(2)}`);
    let inclusions; try { inclusions = typeof offer.inclusions === 'string' ? JSON.parse(offer.inclusions) : offer.inclusions; } catch { inclusions = []; }
    if (Array.isArray(inclusions) && inclusions.length) details.push(`${ar ? 'تشمل' : 'Includes'}:\n${inclusions.join('\n')}`);
  }
  if (pick('outcomes')) details.push(`${products?(ar?'التفاصيل':'Details'):(ar?'مخرجات التعلم':'Learning outcomes')}:\n${pick('outcomes')}`);
  if (pick('prerequisites')) details.push(`${ar ? 'المتطلبات' : 'Prerequisites'}:\n${pick('prerequisites')}`);
  if (details.length) add(details.join('\n\n'));
  return parts;
}
async function plan(pool, c, courseId, language) {
  requireCatalog(c.ctx);pool=catalog.forContext(pool,c.ctx);
  if (!validId(courseId)) fail('INVALID_COURSE', 400);
  const [[course]] = await pool.query("SELECT * FROM sx_training_courses WHERE tenant_id=? AND id=? AND status='active' AND deleted_at IS NULL", [c.ctx.tenant.id, courseId]);
  if (!course) fail('COURSE_NOT_AVAILABLE', 404);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [[offer]] = await pool.query("SELECT * FROM sx_training_offers WHERE tenant_id=? AND course_id=? AND status='active' AND (valid_from IS NULL OR valid_from<=?) AND (valid_until IS NULL OR valid_until>=?) ORDER BY version DESC LIMIT 1", [c.ctx.tenant.id, courseId, today, today]);
  // Published course attachments are part of an authorized Inbox reply. Staff
  // do not need catalogue-management/sidebar access to send these public facts.
  const [files] = await pool.query('SELECT id,media_kind AS kind,mime_type AS mimeType,original_name AS originalName,file_size_bytes AS sizeBytes FROM sx_training_course_media WHERE tenant_id=? AND course_id=? AND deleted_at IS NULL ORDER BY created_at,id',[c.ctx.tenant.id,courseId]);
  const parts = files.sort((a,b) => ({image:0,document:1,video:2}[a.kind] - {image:0,document:1,video:2}[b.kind])).map(f => ({kind:f.kind, mediaId:f.id, name:f.originalName, mimeType:f.mimeType, sizeBytes:f.sizeBytes}));
  for (const p of parts) {
    const max = {image:5,document:20,video:16}[p.kind];
    if (!max || p.sizeBytes > max * 1024 * 1024 || (p.kind === 'document' && p.mimeType !== 'application/pdf') || (p.kind === 'image' && !['image/jpeg','image/png'].includes(p.mimeType)) || (p.kind === 'video' && p.mimeType !== 'video/mp4')) fail('COURSE_MEDIA_NOT_SENDABLE');
    const file = await media.getFile(pool, c.ctx.tenant.id, courseId, p.mediaId);
    const stat = await fs.stat(file.path);
    if (stat.size !== p.sizeBytes) fail('COURSE_MEDIA_NOT_AVAILABLE');
  }
  const texts=textParts(course,offer,language,catalog.sales(c.ctx));
  parts.push(...texts);
  return { courseId, name:language==='ar'?course.name_ar:course.name_en, language, parts };
}
function publicJob(row) {
  const parts = typeof row.parts_json === 'string' ? JSON.parse(row.parts_json) : row.parts_json;
  return { id:row.id, chatId:row.chat_id, courseId:row.course_id, state:row.state, sent:Number(row.sent_count), total:parts.length, parts:parts.map(p=>({kind:p.kind,name:p.name,text:p.text})), error:row.error_code || null };
}
async function job(pool, c, id) {
  requireCatalog(c.ctx);pool=catalog.forContext(pool,c.ctx);
  if (!validId(id)) fail('INVALID_REQUEST',400);
  const [[row]] = await pool.query('SELECT * FROM sx_course_reply_jobs WHERE id=? AND owner_hash=?', [id,hash(c.scope.uid)]);
  if (!row) fail('REQUEST_NOT_FOUND',404);
  await conversation(c,row.chat_id);
  if(row.state==='sending'){
    const [[lock]]=await pool.query('SELECT IS_FREE_LOCK(?) AS available',[conversationLock(c.scope.uid,row.chat_id)]);
    if(Number(lock.available)===1){await pool.query("UPDATE sx_course_reply_jobs SET state='stopped',error_code='SEND_INTERRUPTED_CHECK_CHAT',updated_at=UTC_TIMESTAMP(3) WHERE id=? AND state='sending'",[id]);row.state='stopped';row.error_code='SEND_INTERRUPTED_CHECK_CHAT';}
  }
  return row;
}
const conversationLock=(uid,chatId)=>'course-reply:'+hash(uid+'|'+chatId).slice(0,48);
// A durable claim and per-conversation database lock prevent duplicate/reordered
// sends across clicks, HTTP retries and app processes. Ambiguous sends never retry.
async function execute(pool, c, input, send = require('./course-reply-transport').send) {
  requireCatalog(c.ctx);pool=catalog.forContext(pool,c.ctx);
  const {requestId,chatId,courseId,language='en'}=input || {};
  if (!validId(requestId) || !['en','ar'].includes(language)) fail('INVALID_REQUEST',400);
  await conversation(c,chatId);
  const existing = await pool.query('SELECT * FROM sx_course_reply_jobs WHERE id=?', [requestId]);
  if (existing[0].length) {
    const old=await job(pool,c,requestId);
    if(old.chat_id!==chatId||old.course_id!==courseId||old.language_code!==language)fail('IDEMPOTENCY_CONFLICT');
    return publicJob(old);
  }
  const prepared=await plan(pool,c,courseId,language);
  const db=await pool.getConnection();
  const lock=conversationLock(c.scope.uid,chatId);
  let locked=false;
  try {
    const [[result]]=await db.query('SELECT GET_LOCK(?,0) AS locked',[lock]);
    if(!result.locked)fail('CONVERSATION_SEND_BUSY');locked=true;
    try {await db.query("INSERT INTO sx_course_reply_jobs(id,tenant_id,owner_hash,chat_id,course_id,language_code,parts_json,state) VALUES (?,?,?,?,?,?,?,'sending')",[requestId,c.ctx.tenant.id,hash(c.scope.uid),chatId,courseId,language,JSON.stringify(prepared.parts)]);}
    catch(e){if(e.code==='ER_DUP_ENTRY')return publicJob(await job(pool,c,requestId));throw e;}
    let sent=0;
    try {
      for(let index=0;index<prepared.parts.length;index++) {
        const current=c.refresh?await c.refresh():c;
        if(current.scope.uid!==c.scope.uid||current.ctx.tenant.id!==c.ctx.tenant.id)fail('PERMISSION_DENIED',403);
        const chat=await conversation(current,chatId);
        const [[active]]=await pool.query("SELECT id FROM sx_training_courses WHERE id=? AND tenant_id=? AND status='active' AND deleted_at IS NULL",[courseId,c.ctx.tenant.id]);
        if(!active)fail('COURSE_NOT_AVAILABLE');
        const p=prepared.parts[index];
        const file=p.mediaId?await media.getFile(pool,c.ctx.tenant.id,courseId,p.mediaId):null;
        let timer;
        try {await Promise.race([send({c:current,chat,part:p,file,jobId:requestId,index}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('SEND_TIMEOUT'),{code:'SEND_TIMEOUT'})),90000);})]);}
        finally {clearTimeout(timer);}
        sent++;
        await db.query('UPDATE sx_course_reply_jobs SET sent_count=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?',[sent,requestId]);
      }
      await db.query("UPDATE sx_course_reply_jobs SET state='sent',updated_at=UTC_TIMESTAMP(3) WHERE id=?",[requestId]);
    }catch(e){
      await db.query("UPDATE sx_course_reply_jobs SET state='stopped',error_code=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?",[e.code==='PERMISSION_DENIED'?'PERMISSION_DENIED':'SEND_STOPPED_CHECK_CHAT',requestId]);
    }
    return publicJob(await job(pool,c,requestId));
  }finally{if(locked)await db.query('SELECT RELEASE_LOCK(?)',[lock]);db.release();}
}
module.exports={context,sessionContext,options,conversation,plan,textParts,job,publicJob,execute,hash};
