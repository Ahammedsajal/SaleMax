'use strict';

const crypto=require('node:crypto');
const {decision}=require('./policy');

const MAX_MILLI=999999999999999999n;
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function authorize(ctx,permission){
  if(ctx?.audience!=='tenant'||ctx.tenant?.categoryKey!=='retail_shop'||ctx.tenant?.categoryVersion!==1||ctx.tenant?.status!=='active'||ctx.membership?.tenantId!==ctx.tenant.id||ctx.membership?.status!=='active')fail('CATEGORY_UNAVAILABLE',404);
  const access=decision(ctx,{capability:'retail.inventory',permission});
  if(!access.allowed)fail(access.code,access.code==='PERMISSION_DENIED'?403:409);
  return access;
}
function quantityMilli(value,{allowZero=false}={}){
  if(typeof value!=='string'||!/^[-+]?(?:0|[1-9]\d{0,14})(?:\.\d{1,3})?$/.test(value))fail('INVALID_STOCK_QUANTITY');
  const negative=value.startsWith('-'),unsigned=value.replace(/^[-+]/,'');
  const [whole,fraction='']=unsigned.split('.');
  const milli=BigInt(whole)*1000n+BigInt((fraction+'000').slice(0,3));
  if((milli===0n&&!allowZero)||milli>MAX_MILLI)fail('INVALID_STOCK_QUANTITY');
  return negative?-milli:milli;
}
function formatQuantity(value){const milli=typeof value==='bigint'?value:quantityMilli(String(value),{allowZero:true}),negative=milli<0n,absolute=negative?-milli:milli;return `${negative?'-':''}${absolute/1000n}.${String(absolute%1000n).padStart(3,'0')}`;}
function cleanLocation(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['code','nameEn','nameAr'].includes(key)))fail('INVALID_INVENTORY_LOCATION');
  const code=typeof input.code==='string'?input.code.trim().toUpperCase():'';
  const nameEn=typeof input.nameEn==='string'?input.nameEn.trim():'';
  const nameAr=typeof input.nameAr==='string'?input.nameAr.trim():'';
  if(!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(code)||!nameEn||nameEn.length>120||!nameAr||nameAr.length>120)fail('INVALID_INVENTORY_LOCATION');
  return {code,nameEn,nameAr};
}
function cleanAdjustment(input){
  const allowed=['locationId','productId','quantityDelta','reason','note','requestKey','expectedRevision'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!allowed.includes(key)))fail('INVALID_STOCK_ADJUSTMENT');
  if(!uuid(input.locationId)||!uuid(input.productId)||!uuid(input.requestKey))fail('INVALID_STOCK_ADJUSTMENT');
  const deltaMilli=quantityMilli(input.quantityDelta);
  if(!['opening_balance','stock_count','correction'].includes(input.reason))fail('INVALID_STOCK_REASON');
  const note=typeof input.note==='string'?input.note.trim():'';
  if(note.length>240||!note)fail('INVALID_STOCK_NOTE');
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||input.expectedRevision>0xffffffff)fail('INVALID_STOCK_REVISION');
  return {locationId:input.locationId.toLowerCase(),productId:input.productId.toLowerCase(),deltaMilli,reason:input.reason,note,requestKey:input.requestKey.toLowerCase(),expectedRevision:input.expectedRevision};
}
function adjustmentHash(data){return crypto.createHash('sha256').update(JSON.stringify({locationId:data.locationId,productId:data.productId,delta:formatQuantity(data.deltaMilli),reason:data.reason,note:data.note})).digest('hex');}
function mapLocation(row){return {id:row.id,code:row.code,nameEn:row.nameEn,nameAr:row.nameAr,status:row.status,createdAt:row.createdAt};}
function mapMovement(row){return {id:row.id,productId:row.productId,locationId:row.locationId,quantityDelta:formatQuantity(row.quantityDelta),quantityAfter:formatQuantity(row.quantityAfter),revision:Number(row.revision),reason:row.reason,note:row.note,actorName:row.actorName||null,createdAt:row.createdAt};}

async function listLocations(db,ctx){
  authorize(ctx,'inventory.read');
  const [rows]=await db.query("SELECT id,code,name_en AS nameEn,name_ar AS nameAr,status,created_at AS createdAt FROM sx_retail_locations WHERE tenant_id=? ORDER BY (status='active') DESC,code,id LIMIT 100",[ctx.tenant.id]);
  return rows.map(mapLocation);
}
async function createLocation(db,ctx,input){
  authorize(ctx,'inventory.adjust');
  const data=cleanLocation(input),id=crypto.randomUUID();let begun=false;
  try{
    await db.beginTransaction();begun=true;
    await db.query("INSERT INTO sx_retail_locations(id,tenant_id,code,name_en,name_ar,status,created_by_membership_id,created_by_identity_id) VALUES (?,?,?,?,?,'active',?,?)",[id,ctx.tenant.id,data.code,data.nameEn,data.nameAr,ctx.membership.id,ctx.identity.id]);
    await db.query("INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','retail.inventory-location-created','retail-inventory-location',?,?,?)",[crypto.randomUUID(),ctx.tenant.id,ctx.identity.id,id,JSON.stringify({code:data.code}),crypto.randomUUID()]);
    await db.commit();begun=false;
  }catch(error){if(begun)try{await db.rollback();}catch{}if(error?.code==='ER_DUP_ENTRY')fail('LOCATION_CODE_EXISTS',409);throw error;}
  return {id,...data,status:'active'};
}
async function listStock(db,ctx,{locationId,search='',page=1,limit=30}={}){
  authorize(ctx,'inventory.read');
  if(!uuid(locationId))fail('INVALID_INVENTORY_LOCATION');
  locationId=locationId.toLowerCase();
  page=Math.max(1,Math.min(100000,Number.parseInt(page,10)||1));limit=Math.max(1,Math.min(100,Number.parseInt(limit,10)||30));
  search=String(search||'').trim().slice(0,100);
  const [[location]]=await db.query("SELECT id FROM sx_retail_locations WHERE tenant_id=? AND id=? AND status='active' LIMIT 1",[ctx.tenant.id,locationId]);
  if(!location)fail('INVENTORY_LOCATION_NOT_FOUND',404);
  let count,rows;
  if(search){
    const pattern=`${search.replace(/[!%_]/g,'!$&')}%`;
    const searchSql=`SELECT id FROM sx_product_catalog WHERE tenant_id=? AND status='active' AND code LIKE ? ESCAPE '!' UNION DISTINCT SELECT id FROM sx_product_catalog WHERE tenant_id=? AND status='active' AND name_en LIKE ? ESCAPE '!' UNION DISTINCT SELECT id FROM sx_product_catalog WHERE tenant_id=? AND status='active' AND name_ar LIKE ? ESCAPE '!'`;
    const searchArgs=[ctx.tenant.id,pattern,ctx.tenant.id,pattern,ctx.tenant.id,pattern];
    [[count]]=await db.query(`SELECT COUNT(*) AS total FROM (${searchSql}) AS matched_products`,searchArgs);
    [rows]=await db.query(`SELECT p.id AS productId,p.code,p.name_en AS nameEn,p.name_ar AS nameAr,COALESCE(b.quantity_on_hand,0) AS quantityOnHand,COALESCE(b.revision,0) AS revision FROM (${searchSql}) AS matched_products JOIN sx_product_catalog p ON p.tenant_id=? AND p.id=matched_products.id AND p.status='active' LEFT JOIN sx_retail_inventory_balances b ON b.tenant_id=p.tenant_id AND b.product_id=p.id AND b.location_id=? ORDER BY p.code,p.id LIMIT ? OFFSET ?`,[...searchArgs,ctx.tenant.id,locationId,limit,(page-1)*limit]);
  }else{
    [[count]]=await db.query("SELECT COUNT(*) AS total FROM sx_product_catalog p WHERE p.tenant_id=? AND p.status='active'",[ctx.tenant.id]);
    [rows]=await db.query("SELECT p.id AS productId,p.code,p.name_en AS nameEn,p.name_ar AS nameAr,COALESCE(b.quantity_on_hand,0) AS quantityOnHand,COALESCE(b.revision,0) AS revision FROM sx_product_catalog p LEFT JOIN sx_retail_inventory_balances b ON b.tenant_id=p.tenant_id AND b.product_id=p.id AND b.location_id=? WHERE p.tenant_id=? AND p.status='active' ORDER BY p.code,p.id LIMIT ? OFFSET ?",[locationId,ctx.tenant.id,limit,(page-1)*limit]);
  }
  return {items:rows.map(row=>({...row,quantityOnHand:formatQuantity(row.quantityOnHand),revision:Number(row.revision)})),locationId,page,limit,total:Number(count.total),pages:Math.ceil(Number(count.total)/limit)};
}
async function findReplay(db,ctx,data,payloadHash){
  const [[row]]=await db.query('SELECT id,location_id AS locationId,product_id AS productId,payload_hash AS payloadHash,quantity_delta AS quantityDelta,quantity_after AS quantityAfter,revision,reason,note,created_at AS createdAt FROM sx_retail_stock_movements WHERE tenant_id=? AND request_key=? LIMIT 1',[ctx.tenant.id,data.requestKey]);
  if(!row)return null;
  if(String(row.locationId).toLowerCase()!==data.locationId.toLowerCase()||String(row.productId).toLowerCase()!==data.productId.toLowerCase()||row.payloadHash!==payloadHash)fail('IDEMPOTENCY_CONFLICT',409);
  const [[balance]]=await db.query('SELECT quantity_on_hand AS quantityOnHand,revision FROM sx_retail_inventory_balances WHERE tenant_id=? AND location_id=? AND product_id=?',[ctx.tenant.id,data.locationId,data.productId]);
  return {replayed:true,movement:mapMovement(row),balance:{quantityOnHand:formatQuantity(balance?.quantityOnHand||0),revision:Number(balance?.revision||0)}};
}
async function adjust(db,ctx,input){
  authorize(ctx,'inventory.adjust');
  const data=cleanAdjustment(input),payloadHash=adjustmentHash(data);let begun=false;
  try{
    await db.beginTransaction();begun=true;
    const replay=await findReplay(db,ctx,data,payloadHash);if(replay){await db.commit();begun=false;return replay;}
    const [[location]]=await db.query("SELECT id FROM sx_retail_locations WHERE tenant_id=? AND id=? AND status='active' FOR UPDATE",[ctx.tenant.id,data.locationId]);
    if(!location)fail('INVENTORY_LOCATION_NOT_FOUND',404);
    const [[product]]=await db.query('SELECT id FROM sx_product_catalog WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,data.productId]);
    if(!product)fail('PRODUCT_NOT_FOUND',404);
    await db.query('INSERT INTO sx_retail_inventory_balances(tenant_id,location_id,product_id,quantity_on_hand,revision,updated_by_membership_id,updated_by_identity_id) VALUES (?,?,?,0,0,?,?) ON DUPLICATE KEY UPDATE revision=revision',[ctx.tenant.id,data.locationId,data.productId,ctx.membership.id,ctx.identity.id]);
    const [[balance]]=await db.query('SELECT quantity_on_hand AS quantityOnHand,revision FROM sx_retail_inventory_balances WHERE tenant_id=? AND location_id=? AND product_id=? FOR UPDATE',[ctx.tenant.id,data.locationId,data.productId]);
    if(!balance)fail('INVENTORY_BALANCE_UNAVAILABLE',503);
    const current=quantityMilli(String(balance.quantityOnHand),{allowZero:true});
    const revision=Number(balance.revision);
    if(revision!==data.expectedRevision)fail('STALE_INVENTORY_REVISION',409);
    if(revision>=0xffffffff)fail('INVENTORY_REVISION_LIMIT',409);
    if(data.reason==='opening_balance'&&revision!==0)fail('OPENING_BALANCE_ALREADY_SET',409);
    const after=current+data.deltaMilli;if(after<0n)fail('INSUFFICIENT_STOCK',409);if(after>MAX_MILLI)fail('STOCK_QUANTITY_LIMIT',400);
    const nextRevision=revision+1,id=crypto.randomUUID(),delta=formatQuantity(data.deltaMilli),quantityAfter=formatQuantity(after);
    await db.query('UPDATE sx_retail_inventory_balances SET quantity_on_hand=?,revision=?,updated_by_membership_id=?,updated_by_identity_id=? WHERE tenant_id=? AND location_id=? AND product_id=?',[quantityAfter,nextRevision,ctx.membership.id,ctx.identity.id,ctx.tenant.id,data.locationId,data.productId]);
    await db.query('INSERT INTO sx_retail_stock_movements(id,tenant_id,location_id,product_id,request_key,payload_hash,quantity_delta,quantity_after,revision,reason,note,actor_membership_id,actor_identity_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,ctx.tenant.id,data.locationId,data.productId,data.requestKey,payloadHash,delta,quantityAfter,nextRevision,data.reason,data.note,ctx.membership.id,ctx.identity.id]);
    await db.query("INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','retail.stock-adjusted','retail-stock',?,?,?)",[crypto.randomUUID(),ctx.tenant.id,ctx.identity.id,`${data.locationId}:${data.productId}`,JSON.stringify({quantityDelta:delta,quantityAfter,revision:nextRevision,reason:data.reason}),crypto.randomUUID()]);
    const [[persisted]]=await db.query('SELECT created_at AS createdAt FROM sx_retail_stock_movements WHERE tenant_id=? AND id=?',[ctx.tenant.id,id]);
    await db.commit();begun=false;
    return {replayed:false,movement:{id,locationId:data.locationId,productId:data.productId,quantityDelta:delta,quantityAfter,revision:nextRevision,reason:data.reason,note:data.note,createdAt:persisted?.createdAt||null},balance:{quantityOnHand:quantityAfter,revision:nextRevision}};
  }catch(error){if(begun)try{await db.rollback();}catch{}if(error?.code==='ER_DUP_ENTRY'){
      const replay=await findReplay(db,ctx,data,payloadHash);if(replay)return replay;
    }throw error;
  }
}
async function listMovements(db,ctx,{productId,locationId,page=1,limit=30}={}){
  authorize(ctx,'inventory.read');if(!uuid(productId)||!uuid(locationId))fail('INVALID_STOCK_FILTER');
  productId=productId.toLowerCase();locationId=locationId.toLowerCase();
  page=Math.max(1,Math.min(100000,Number.parseInt(page,10)||1));limit=Math.max(1,Math.min(100,Number.parseInt(limit,10)||30));
  const where='m.tenant_id=? AND m.product_id=? AND m.location_id=?',args=[ctx.tenant.id,productId,locationId];
  const [[count]]=await db.query(`SELECT COUNT(*) AS total FROM sx_retail_stock_movements m WHERE ${where}`,args);
  const [rows]=await db.query(`SELECT m.id,m.location_id AS locationId,m.product_id AS productId,m.quantity_delta AS quantityDelta,m.quantity_after AS quantityAfter,m.revision,m.reason,m.note,i.display_name AS actorName,m.created_at AS createdAt FROM sx_retail_stock_movements m LEFT JOIN sx_memberships a ON a.tenant_id=m.tenant_id AND a.id=m.actor_membership_id LEFT JOIN sx_identities i ON i.id=a.identity_id WHERE ${where} ORDER BY m.revision DESC,m.id LIMIT ? OFFSET ?`,[...args,limit,(page-1)*limit]);
  return {items:rows.map(mapMovement),page,limit,total:Number(count.total),pages:Math.ceil(Number(count.total)/limit)};
}
module.exports={authorize,quantityMilli,formatQuantity,cleanLocation,cleanAdjustment,listLocations,createLocation,listStock,adjust,listMovements};
