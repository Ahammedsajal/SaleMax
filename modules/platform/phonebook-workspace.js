'use strict';
const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const fields=['name','mobile','phonebook_name','var1','var2','var3','var4','var5','createdAt'];
const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
function ids(input){if(!Array.isArray(input)||!input.length||input.length>500||input.some(id=>!Number.isSafeInteger(Number(id))||Number(id)<1))fail('INVALID_SELECTION');return [...new Set(input.map(Number))];}
function validateConfig(input){
 if(!input||typeof input!=='object')fail('INVALID_CONFIGURATION');
 if(!Array.isArray(input.labels)||input.labels.length!==5||input.labels.some(x=>typeof x!=='string'||!x.trim()||x.trim().length>60))fail('INVALID_LABELS');
 const labels=input.labels.map(x=>x.trim());if(new Set(labels.map(normalize)).size!==5)fail('DUPLICATE_LABELS');
 if(!Array.isArray(input.rules)||input.rules.length>30)fail('INVALID_RULES');
 const rules=input.rules.map(rule=>{if(!rule||typeof rule!=='object')fail('INVALID_RULE');const keyword=normalize(rule.keyword);if(!keyword||keyword.length>240||!Number.isSafeInteger(Number(rule.bookId))||Number(rule.bookId)<1)fail('INVALID_RULE');return {keyword,bookId:Number(rule.bookId)};});
 if(new Set(rules.map(x=>x.keyword)).size!==rules.length)fail('DUPLICATE_KEYWORD');
 return {labels,rules};
}
async function context(db,user,type='user',owner=null){
 if(type==='agents'){
  if(!owner||!user.is_active||user.owner_uid!==owner.uid)fail('ACCESS_DENIED',403);
  const ownerContext=await context(db,owner);
  if(ownerContext.uid!==owner.uid||!ownerContext.manage)fail('ACCESS_DENIED',403);
  const [links]=await db.query(`SELECT o.legacy_uid_hash AS uidHash,m.status,i.status AS identityStatus,t.status AS tenantStatus
   FROM sx_legacy_ownership o LEFT JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=o.tenant_id
   LEFT JOIN sx_identities i ON i.id=m.identity_id LEFT JOIN sx_tenants t ON t.id=o.tenant_id
   WHERE o.source_table='agents' AND o.source_id=? LIMIT 2`,[String(user.id)]);
  if(links.length&&(links.length!==1||links[0].uidHash!==hash(user.uid)||links[0].status!=='active'||links[0].identityStatus!=='active'||links[0].tenantStatus!=='active'))fail('ACCESS_DENIED',403);
  return {...ownerContext,type,id:Number(user.id),manage:false};
 }
 const [links]=await db.query(`SELECT o.legacy_uid_hash AS uidHash,o.tenant_id AS tenantId,m.role,m.status,t.status AS tenantStatus,i.status AS identityStatus
 FROM sx_legacy_ownership o LEFT JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=o.tenant_id LEFT JOIN sx_tenants t ON t.id=o.tenant_id LEFT JOIN sx_identities i ON i.id=m.identity_id
 WHERE o.source_table='user' AND o.source_id=? LIMIT 2`,[String(user.id)]);
 if(!links.length)return {uid:user.uid,hash:hash(user.uid),type,id:Number(user.id),manage:true,category:'legacy'};
 const link=links[0];if(links.length!==1||link.uidHash!==hash(user.uid)||link.status!=='active'||link.identityStatus!=='active'||link.tenantStatus!=='active')fail('ACCESS_DENIED',403);
 const [owners]=await db.query(`SELECT u.uid,o.legacy_uid_hash AS uidHash FROM sx_legacy_ownership o JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=o.tenant_id JOIN user u ON BINARY CAST(u.id AS CHAR)=BINARY o.source_id
 WHERE o.source_table='user' AND o.tenant_id=? AND m.role='owner' AND m.status='active' LIMIT 2`,[link.tenantId]);
 if(owners.length!==1||owners[0].uidHash!==hash(owners[0].uid))fail('ACCESS_DENIED',403);
 const uid=owners[0].uid;
 return {uid,hash:hash(uid),type,id:Number(user.id),manage:['owner','manager'].includes(link.role),category:await category(db,uid)};
}
async function category(db,uid){const [rows]=await db.query(`SELECT t.category_key FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND BINARY o.source_id=BINARY CAST(u.id AS CHAR) JOIN sx_tenants t ON t.id=o.tenant_id WHERE u.uid=? LIMIT 1`,[uid]);return rows[0]?.category_key||'legacy';}
async function sessionContext(db,session){
 if(!session.context)return context(db,session.actor,session.agent?'agents':'user',session.owner);
 const policy=require('./policy'),read=policy.decision(session.context,{capability:'crm.contacts',permission:'contacts.read'});
 if(!read.allowed)fail(read.code,403);
 const manage=policy.decision(session.context,{capability:'crm.contacts',permission:'contacts.manage'}).allowed;
 if(!manage&&!session.actor)fail('ACCESS_DENIED',403);
 return {uid:session.ownerUid,hash:hash(session.ownerUid),type:session.agent?'agents':'user',id:session.actor?.id||null,manage,category:session.context.tenant.categoryKey};
}
async function edit(db,ctx,input){
 manage(ctx);const id=ids([input?.contactId])[0],keys=['name','mobile','var1','var2','var3','var4','var5','var6'];
 if(keys.some(key=>input[key]!=null&&(typeof input[key]!=='string'||input[key].length>999))||!String(input.mobile||'').trim())fail('INVALID_CONTACT');
 const values=keys.map(key=>input[key]??'');
 const [result]=await db.query('UPDATE contact SET name=?,mobile=?,var1=?,var2=?,var3=?,var4=?,var5=?,var6=? WHERE uid=? AND id=?',[...values,ctx.uid,id]);
 if(!result.affectedRows)fail('CONTACT_NOT_FOUND',404);return {updated:true};
}
async function remove(db,ctx,input){manage(ctx);const selected=ids(input?.selected);const [result]=await db.query('DELETE FROM contact WHERE uid=? AND id IN (?)',[ctx.uid,selected]);return {count:result.affectedRows};}
function visibility(ctx,alias='c'){
 if(ctx.manage)return {sql:`${alias}.uid=?`,params:[ctx.uid]};
 return {sql:`${alias}.uid=? AND EXISTS (SELECT 1 FROM sx_phonebook_shares s WHERE s.owner_hash=? AND s.recipient_type=? AND s.recipient_id=? AND ((s.resource_type='book' AND s.resource_id=${alias}.phonebook_id) OR (s.resource_type='contact' AND s.resource_id=${alias}.id)))`,params:[ctx.uid,ctx.hash,ctx.type,ctx.id]};
}
async function settings(db,ctx){const [rows]=await db.query('SELECT config_json,revision FROM sx_phonebook_settings WHERE owner_hash=? AND category_key=?',[ctx.hash,ctx.category]);return rows.length?{...JSON.parse(rows[0].config_json),revision:rows[0].revision}:{labels:[1,2,3,4,5].map(n=>'Variable '+n),rules:[],revision:0};}
async function books(db,ctx){
 const v=visibility(ctx);
 const [rows]=await db.query(`SELECT p.id,p.name,COUNT(c.id) AS contactCount FROM phonebook p LEFT JOIN contact c ON c.phonebook_id=p.id AND ${v.sql}
 WHERE p.uid=? ${ctx.manage?'':`AND (EXISTS (SELECT 1 FROM sx_phonebook_shares s WHERE s.owner_hash=? AND s.resource_type='book' AND s.resource_id=p.id AND s.recipient_type=? AND s.recipient_id=?) OR c.id IS NOT NULL)`} GROUP BY p.id,p.name ORDER BY p.name,p.id`,[...v.params,ctx.uid,...(ctx.manage?[]:[ctx.hash,ctx.type,ctx.id])]);return rows;
}
function where(ctx,input={}){
 const v=visibility(ctx);let sql=v.sql,params=[...v.params];
 if(input.bookId){if(!Number.isSafeInteger(Number(input.bookId))||Number(input.bookId)<1)fail('INVALID_BOOK');sql+=' AND c.phonebook_id=?';params.push(Number(input.bookId));}
 if(input.search){if(String(input.search).length>100)fail('INVALID_SEARCH');sql+=' AND (c.name LIKE ? OR c.mobile LIKE ?)';const term='%'+String(input.search).replace(/[\\%_]/g,'\\$&')+'%';params.push(term,term);}
 const filters=input.filters||[];if(!Array.isArray(filters)||filters.length>10)fail('INVALID_FILTERS');
 for(const filter of filters){if(!filter||!fields.includes(filter.field)||typeof filter.value!=='string'||filter.value.length>1000)fail('INVALID_FILTER');sql+=` AND COALESCE(CAST(c.\`${filter.field}\` AS CHAR),'')=?`;params.push(filter.value);}
 return {sql,params};
}
async function list(db,ctx,input={}){const w=where(ctx,input);const page=Math.max(0,Number(input.page)||0);if(!Number.isSafeInteger(page)||page>100000)fail('INVALID_PAGE');const [[count]]=await db.query(`SELECT COUNT(*) AS total FROM contact c WHERE ${w.sql}`,w.params);const [rows]=await db.query(`SELECT c.* FROM contact c WHERE ${w.sql} ORDER BY c.id DESC LIMIT 100 OFFSET ?`,[...w.params,page*100]);return {rows,total:Number(count.total),page};}
function mobileCandidates(value){let digits=String(value||'').replace(/\D/g,'');if(digits.startsWith('00'))digits=digits.slice(2);if(digits.length<7||digits.length>15)fail('INVALID_MOBILE');const values=new Set([digits,'00'+digits]);if(digits.startsWith('974')&&digits.length===11){values.add(digits.slice(3));values.add('00'+digits.slice(3));}else if(digits.length===8){values.add('974'+digits);values.add('00974'+digits);}return [...values];}
async function contactsByMobile(db,ctx,input={}){
 const candidates=mobileCandidates(input.mobile),v=visibility(ctx);
 const [rows]=await db.query(`SELECT c.id,c.phonebook_id AS phonebookId,COALESCE(NULLIF(c.phonebook_name,''),p.name,'') AS phonebookName,c.name,c.mobile,c.var1,c.var2,c.var3,c.var4,c.var5,c.var6,c.createdAt
 FROM contact c LEFT JOIN phonebook p ON p.uid=c.uid AND p.id=c.phonebook_id
 WHERE ${v.sql} AND LOWER(TRIM(COALESCE(NULLIF(c.phonebook_name,''),p.name,'')))<>'whatsapp leads'
 AND REGEXP_REPLACE(COALESCE(c.mobile,''),'[^0-9]','') IN (?)
 ORDER BY phonebookName,c.name,c.id LIMIT 101`,[...v.params,candidates]);
 const config=await settings(db,ctx);
 const contacts=rows.slice(0,100).map(row=>({id:row.id,phonebookName:row.phonebookName||'',name:row.name||'',mobile:row.mobile||'',createdAt:row.createdAt||null,fields:[1,2,3,4,5,6].map(index=>({label:index<=5?(config.labels?.[index-1]||`Variable ${index}`):'Variable 6',value:row[`var${index}`]??''})).filter(field=>String(field.value).trim())}));
 return {contacts,truncated:rows.length>100};
}
async function unique(db,ctx,input){if(!fields.includes(input.field))fail('INVALID_COLUMN');const w=where(ctx,input);const [rows]=await db.query(`SELECT DISTINCT COALESCE(CAST(c.\`${input.field}\` AS CHAR),'') AS value FROM contact c WHERE ${w.sql} ORDER BY value LIMIT 1001`,w.params);return {values:rows.slice(0,1000).map(x=>x.value),truncated:rows.length>1000};}
function manage(ctx){if(!ctx.manage)fail('READ_ONLY_SHARE',403);}
async function saveSettings(db,ctx,input){manage(ctx);const config=validateConfig(input);await db.beginTransaction();try{
 const [owner]=await db.query('SELECT id FROM user WHERE uid=? FOR UPDATE',[ctx.uid]);if(owner.length!==1)fail('ACCESS_DENIED',403);
 const current=await settings(db,ctx);if(Number(input.revision)!==Number(current.revision))fail('SETTINGS_CHANGED',409);
 const targets=[...new Set(config.rules.map(r=>r.bookId))];if(targets.length){const [rows]=await db.query('SELECT id FROM phonebook WHERE uid=? AND id IN (?) FOR UPDATE',[ctx.uid,targets]);if(rows.length!==targets.length)fail('BOOK_NOT_FOUND',404);}
 await db.query('INSERT INTO sx_phonebook_settings(owner_hash,category_key,config_json,revision) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE config_json=VALUES(config_json),revision=revision+1',[ctx.hash,ctx.category,JSON.stringify(config)]);await db.commit();return {...config,revision:current.revision+1};
 }catch(e){await db.rollback();throw e;}}
async function move(db,ctx,input){manage(ctx);const selected=ids(input.ids),bookId=Number(input.bookId);if(!Number.isSafeInteger(bookId)||bookId<1)fail('INVALID_BOOK');await db.beginTransaction();try{
 const [[book]]=await db.query('SELECT id,name FROM phonebook WHERE uid=? AND id=? FOR UPDATE',[ctx.uid,bookId]);if(!book)fail('BOOK_NOT_FOUND',404);
 const [contacts]=await db.query('SELECT id FROM contact WHERE uid=? AND id IN (?) FOR UPDATE',[ctx.uid,selected]);if(contacts.length!==selected.length)fail('CONTACT_NOT_FOUND',404);
 await db.query('UPDATE contact SET phonebook_id=?,phonebook_name=? WHERE uid=? AND id IN (?)',[book.id,book.name,ctx.uid,selected]);await db.commit();return {count:selected.length};
 }catch(e){await db.rollback();throw e;}}
async function recipients(db,ctx){manage(ctx);
 const [agents]=await db.query("SELECT id,name,email FROM agents WHERE owner_uid=? AND is_active=1 ORDER BY name",[ctx.uid]);
 const [users]=await db.query(`SELECT u.id,u.name,u.email FROM user owner JOIN sx_legacy_ownership oo ON oo.source_table='user' AND BINARY oo.source_id=BINARY CAST(owner.id AS CHAR)
 JOIN sx_memberships om ON om.id=oo.membership_id AND om.tenant_id=oo.tenant_id AND om.role='owner' AND om.status='active'
 JOIN sx_legacy_ownership o ON o.tenant_id=oo.tenant_id AND o.source_table='user' JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=o.tenant_id AND m.status='active'
 JOIN sx_identities i ON i.id=m.identity_id AND i.status='active' JOIN user u ON BINARY CAST(u.id AS CHAR)=BINARY o.source_id AND BINARY SHA2(u.uid,256)=BINARY o.legacy_uid_hash
 WHERE owner.uid=? AND BINARY SHA2(owner.uid,256)=BINARY oo.legacy_uid_hash AND u.uid<>? ORDER BY u.name`,[ctx.uid,ctx.uid]);
 return [...agents.map(x=>({...x,type:'agents'})),...users.map(x=>({...x,type:'user'}))];
}
async function share(db,ctx,input){manage(ctx);const selected=ids(input.ids);if(!['book','contact'].includes(input.resourceType)||!['user','agents'].includes(input.recipientType))fail('INVALID_SHARE');
 await db.beginTransaction();try{
 // Revalidate the recipient against this account; read access also rechecks active membership on every request.
 const allowed=await recipients(db,ctx);if(!input.revoke&&!allowed.some(x=>x.type===input.recipientType&&Number(x.id)===Number(input.recipientId)))fail('RECIPIENT_NOT_FOUND',404);
 const table=input.resourceType==='book'?'phonebook':'contact';const [rows]=await db.query(`SELECT id FROM ${table} WHERE uid=? AND id IN (?) FOR UPDATE`,[ctx.uid,selected]);if(rows.length!==selected.length)fail('RESOURCE_NOT_FOUND',404);
 for(const id of selected){const p=[ctx.hash,input.resourceType,id,input.recipientType,Number(input.recipientId)];if(input.revoke)await db.query('DELETE FROM sx_phonebook_shares WHERE owner_hash=? AND resource_type=? AND resource_id=? AND recipient_type=? AND recipient_id=?',p);else await db.query('INSERT IGNORE INTO sx_phonebook_shares(owner_hash,resource_type,resource_id,recipient_type,recipient_id) VALUES (?,?,?,?,?)',p);}
 await db.commit();return {count:selected.length};}catch(e){await db.rollback();throw e;}}
async function shares(db,ctx){manage(ctx);const [rows]=await db.query('SELECT resource_type AS resourceType,resource_id AS resourceId,recipient_type AS recipientType,recipient_id AS recipientId FROM sx_phonebook_shares WHERE owner_hash=?',[ctx.hash]);return rows;}
async function routeOpening({uid,message,chatId,origin,sessionId,pool}){
 if(require('./qr-inbox-groups').isGroup({...message,chatId}))return {routed:false};
 if(!uid||!chatId||!message?.metaChatId||message?.route!=='INCOMING'||!['qr','meta'].includes(origin))return {routed:false};
 const mobile=String(message.senderMobile||'').replace(/\D/g,'');if(!/^\d{7,16}$/.test(mobile))return {routed:false};
 const db=await pool.getConnection();try{
 const ctx={uid,hash:hash(uid),category:await category(db,uid)};const config=await settings(db,ctx);if(!config.rules.length)return {routed:false};
 const conversation=hash(JSON.stringify([origin,String(sessionId||''),String(chatId)]));await db.beginTransaction();
 const [claim]=await db.query('INSERT IGNORE INTO sx_phonebook_openings(owner_hash,conversation_hash) VALUES (?,?)',[ctx.hash,conversation]);if(!claim.affectedRows){await db.commit();return {routed:false};}
 // The common inbox persists the current message before dispatch. Historical incoming messages prevent later messages being treated as an opening.
 const [[history]]=await db.query("SELECT metaChatId FROM beta_conversation WHERE uid=? AND chat_id=? AND route='INCOMING' ORDER BY id LIMIT 1",[uid,chatId]);
 if(history&&history.metaChatId!==String(message.metaChatId||'')){await db.commit();return {routed:false};}
 const text=normalize(message.msgContext?.text?.body||message.msgContext?.button?.text||message.msgContext?.interactive?.button_reply?.title);
 const rule=config.rules.find(r=>text.includes(r.keyword));if(!rule){await db.commit();return {routed:false};}
 const [[owner]]=await db.query('SELECT plan,plan_expire FROM user WHERE uid=? FOR UPDATE',[uid]);
 const [[book]]=await db.query('SELECT id,name FROM phonebook WHERE uid=? AND id=? FOR UPDATE',[uid,rule.bookId]);if(!book){await db.commit();return {routed:false};}
 const [[existing]]=await db.query('SELECT id FROM contact WHERE uid=? AND phonebook_id=? AND mobile=? LIMIT 1',[uid,book.id,mobile]);
 if(!existing){let plan;try{plan=JSON.parse(owner?.plan||'{}');}catch{plan={};}const limit=Number(plan.contact_limit??plan.contacts??0);const [[count]]=await db.query('SELECT COUNT(*) AS count FROM contact WHERE uid=?',[uid]);if(!owner?.plan_expire||Number(owner.plan_expire)<=Date.now()||!Number.isFinite(limit)||limit<=0||Number(count.count)>=limit){await db.commit();return {routed:false,reason:'CONTACT_LIMIT'};}
 await db.query('INSERT INTO contact(uid,phonebook_id,phonebook_name,name,mobile,var1,var2,var3,var4,var5) VALUES (?,?,?,?,?,?,?,?,?,?)',[uid,book.id,book.name,String(message.senderName||mobile).slice(0,200),mobile,'','','','','']);}
 await db.commit();return {routed:true,bookId:book.id};
 }catch(e){await db.rollback();throw e;}finally{db.release();}}
module.exports={hash,ids,normalize,validateConfig,context,sessionContext,edit,remove,visibility,settings,books,list,contactsByMobile,unique,saveSettings,move,recipients,share,shares,routeOpening};
