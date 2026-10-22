'use strict';

const {decision}=require('./policy');
const {salemaxSales,categoryKeyMatches}=require('./categories');

const fail=code=>{throw Object.assign(new Error(code),{code});};
const secretKey=/password|secret|token|authorization|credential|recording|transcript|media|proof|signature|private.?key|cookie/i;
const safeDate=value=>{
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))fail('INVALID_AUDIT_FILTER');
  const date=new Date(`${value}T00:00:00.000Z`);
  if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==value)fail('INVALID_AUDIT_FILTER');
  return value;
};
function assertAccess(ctx){
  if(ctx?.audience!=='tenant'||!categoryKeyMatches(ctx.category?.key,salemaxSales.key)||ctx.category?.version!==salemaxSales.version||!categoryKeyMatches(ctx.tenant?.categoryKey,salemaxSales.key)||Number(ctx.tenant?.categoryVersion)!==salemaxSales.version)fail('CATEGORY_UNAVAILABLE');
  if(ctx.membership?.role!=='owner')fail('PERMISSION_DENIED');
  if(Array.isArray(ctx.membership.assignedNavigation)&&!ctx.membership.assignedNavigation.includes('sales-audit'))fail('PERMISSION_DENIED');
  const access=decision(ctx,{capability:'tenant.settings',permission:'tenant.manage'});
  if(!access.allowed)fail(access.code);
  if(!ctx.identity?.id||!ctx.membership?.id)fail('PERMISSION_DENIED');
}
function scrub(value,depth=0){
  if(value===null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string')return value.slice(0,500);
  if(Array.isArray(value))return value.slice(0,20).map(item=>scrub(item,depth+1));
  if(!value||typeof value!=='object'||depth>=4)return undefined;
  const result={};
  for(const [key,item] of Object.entries(value).slice(0,40)){
    if(secretKey.test(key))continue;
    const clean=scrub(item,depth+1);
    if(clean!==undefined)result[key]=clean;
  }
  return result;
}
function jsonValue(value){
  if(value&&typeof value==='object')return value;
  if(typeof value==='string')try{return JSON.parse(value)}catch{return {summary:value.slice(0,500)}};
  return {};
}
function cursorEncode(row){
  const value=row.occurredAt??row.occurred_at;
  const occurredAt=value instanceof Date?value.toISOString():new Date(String(value).replace(' ','T')+'Z').toISOString();
  return Buffer.from(JSON.stringify({occurredAt,id:row.id}),'utf8').toString('base64url');
}
function cursorDecode(value){
  if(value===undefined||value===null||value==='')return null;
  if(typeof value!=='string'||value.length>512)fail('INVALID_AUDIT_CURSOR');
  let data;try{data=JSON.parse(Buffer.from(value,'base64url').toString('utf8'))}catch{fail('INVALID_AUDIT_CURSOR');}
  if(!data||typeof data.occurredAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.occurredAt)||typeof data.id!=='string'||!/^[0-9a-f-]{36}$/i.test(data.id))fail('INVALID_AUDIT_CURSOR');
  const date=new Date(data.occurredAt);if(Number.isNaN(date.getTime())||date.toISOString()!==data.occurredAt)fail('INVALID_AUDIT_CURSOR');
  return {occurredAt:data.occurredAt.slice(0,23).replace('T',' '),id:data.id};
}
function nextDay(date){const d=new Date(`${date}T00:00:00.000Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
async function list(db,ctx,{from,to,action,limit=50,before}={}){
  assertAccess(ctx);
  const start=safeDate(from),end=safeDate(to);
  if(start&&end&&start>end)fail('INVALID_AUDIT_FILTER');
  if(action!==undefined&&action!==null&&action!==''&&(typeof action!=='string'||action.length>100||!/^[a-zA-Z0-9._:-]+$/.test(action)))fail('INVALID_AUDIT_FILTER');
  const pageSize=Number(limit);
  if(!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)fail('INVALID_AUDIT_FILTER');
  const cursor=cursorDecode(before),where=['e.tenant_id=?'],params=[ctx.tenant.id];
  if(start){where.push('e.occurred_at>=?');params.push(`${start} 00:00:00.000`);}
  if(end){where.push('e.occurred_at<?');params.push(`${nextDay(end)} 00:00:00.000`);}
  if(action){where.push('e.action=?');params.push(action);}
  if(cursor){where.push('(e.occurred_at<? OR (e.occurred_at=? AND e.id<?))');params.push(cursor.occurredAt,cursor.occurredAt,cursor.id);}
  const [rows]=await db.query(`SELECT e.id,e.actor_kind AS actorKind,e.action,e.resource_type AS resourceType,
      e.reason,e.changes,e.occurred_at AS occurredAt,i.display_name AS actorName
    FROM sx_audit_events e LEFT JOIN sx_identities i ON i.id=e.actor_identity_id
    WHERE ${where.join(' AND ')}
    ORDER BY e.occurred_at DESC,e.id DESC LIMIT ?`,[...params,pageSize+1]);
  const hasMore=rows.length>pageSize,page=rows.slice(0,pageSize);
  return {items:page.map(row=>({id:row.id,actorKind:row.actorKind,actorName:row.actorName|| (row.actorKind==='system'?'System':'Former user'),action:row.action,resourceType:row.resourceType,reason:typeof row.reason==='string'?row.reason.slice(0,500):null,changes:scrub(jsonValue(row.changes)),occurredAt:row.occurredAt instanceof Date?row.occurredAt.toISOString():new Date(row.occurredAt).toISOString()})),nextCursor:hasMore?cursorEncode(page[page.length-1]):null};
}
module.exports={list,assertAccess,scrub,cursorDecode};
