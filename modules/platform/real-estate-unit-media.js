'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const inventory=require('./real-estate-inventory');
const properties=require('./real-estate-properties');
const {decision}=require('./policy');
const ROOT=path.resolve(process.env.SALEMAX_PROPERTY_MEDIA_DIR||path.join(__dirname,'../../database/local-runtime/property-media'));
const MAX_BYTES=100*1024*1024, TENANT_QUOTA=2*1024*1024*1024, UNIT_LIMIT=30;
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const uuid=()=>crypto.randomUUID();
function safeId(value){if(typeof value!=='string'||!ID.test(value))fail('INVALID_MEDIA_ID');return value;}
async function ensureDirectory(dir){await fsp.mkdir(dir,{recursive:true,mode:0o700});const stat=await fsp.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())fail('MEDIA_STORAGE_UNAVAILABLE',503);}
async function ensureDirectories(){if(process.env.NODE_ENV==='production'&&!process.env.SALEMAX_PROPERTY_MEDIA_DIR)fail('MEDIA_STORAGE_UNAVAILABLE',503);await ensureDirectory(ROOT);await ensureDirectory(path.join(ROOT,'.tmp'));}
function tempDirectory(){return path.join(ROOT,'.tmp');}
function filePath(tenant,unit,id){for(const value of [tenant,unit,id])safeId(value);return path.join(ROOT,tenant,unit,id);}
const signatures={
  'image/jpeg':{kind:'image',check:b=>b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255},
  'image/png':{kind:'image',check:b=>b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))},
  'image/webp':{kind:'image',check:b=>b.length>=12&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'},
  'application/pdf':{kind:'document',check:b=>b.toString('ascii',0,5)==='%PDF-'},
  'video/mp4':{kind:'video',check:b=>b.length>=12&&b.toString('ascii',4,8)==='ftyp'},
  'video/quicktime':{kind:'video',check:b=>b.length>=12&&b.toString('ascii',4,8)==='ftyp'},
  'video/webm':{kind:'video',check:b=>b.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))}
};
async function inspect(file){
  if(!file||file.truncated||!Number.isSafeInteger(file.size)||file.size<8||file.size>MAX_BYTES)fail('MEDIA_SIZE_INVALID',413);
  const mime=String(file.mimetype||'').toLowerCase(),type=signatures[mime];if(!type)fail('MEDIA_TYPE_INVALID',415);
  const stat=await fsp.lstat(file.tempFilePath);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==file.size)fail('MEDIA_SIZE_INVALID',413);
  const handle=await fsp.open(file.tempFilePath,'r');try{const header=Buffer.alloc(16),{bytesRead}=await handle.read(header,0,16,0);if(!type.check(header.subarray(0,bytesRead)))fail('MEDIA_SIGNATURE_INVALID',415);}finally{await handle.close();}
  const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file.tempFilePath))hash.update(chunk);
  const name=path.basename(String(file.name||'file')).normalize('NFC').replace(/[\u0000-\u001f\u007f]/g,'').trim();if(!name||name.length>240)fail('INVALID_MEDIA_NAME');
  return {mime,kind:type.kind,size:file.size,sha256:hash.digest('hex'),name};
}
async function audit(db,ctx,action,id,changes){await db.query("INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity',?,'real-estate-unit-media',?,?,?)",[uuid(),ctx.tenant.id,ctx.identity.id,action,id,JSON.stringify(changes),uuid()]);}
function canManage(ctx){return decision(ctx,{capability:'realestate.listings',permission:'properties.manage'}).allowed;}
async function list(db,ctx,unitId){await inventory.getUnit(db,ctx,safeId(unitId));const [rows]=await db.query(`SELECT id,media_kind AS kind,mime_type AS mimeType,original_name AS name,file_size_bytes AS sizeBytes,sort_order AS sortOrder,is_cover AS isCover FROM sx_real_estate_unit_media WHERE tenant_id=? AND unit_id=? AND deleted_at IS NULL${canManage(ctx)?'':" AND media_kind<>'document'"} ORDER BY sort_order,id`,[ctx.tenant.id,unitId]);return {items:rows.map(row=>({...row,isCover:!!Number(row.isCover),sizeBytes:Number(row.sizeBytes)}))};}
async function attach(db,ctx,unitId,file){
  properties.authorize(ctx,'properties.manage');safeId(ctx.tenant.id);safeId(unitId);const info=await inspect(file),id=uuid();await ensureDirectories();
  await ensureDirectory(path.join(ROOT,ctx.tenant.id));await ensureDirectory(path.join(ROOT,ctx.tenant.id,unitId));const target=filePath(ctx.tenant.id,unitId,id);let moved=false;
  await db.beginTransaction();try{
    const [[tenant]]=await db.query("SELECT id FROM sx_tenants WHERE id=? AND status='active' FOR UPDATE",[ctx.tenant.id]);if(!tenant)fail('ACCOUNT_INACTIVE',403);
    const [[unit]]=await db.query('SELECT id FROM sx_real_estate_units WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,unitId]);if(!unit)fail('UNIT_NOT_FOUND',404);
    const [[usage]]=await db.query('SELECT COALESCE(SUM(file_size_bytes),0) AS bytes FROM sx_real_estate_unit_media WHERE tenant_id=?',[ctx.tenant.id]);
    const [[count]]=await db.query('SELECT COUNT(*) AS total,COALESCE(MAX(sort_order),-1) AS maxOrder,SUM(is_cover) AS covers FROM sx_real_estate_unit_media WHERE tenant_id=? AND unit_id=? AND deleted_at IS NULL',[ctx.tenant.id,unitId]);
    if(Number(count.total)>=UNIT_LIMIT)fail('MEDIA_LIMIT_REACHED',409);if(Number(usage.bytes)+info.size>TENANT_QUOTA)fail('MEDIA_QUOTA_EXCEEDED',409);
    await file.mv(target);moved=true;
    await db.query('INSERT INTO sx_real_estate_unit_media(id,tenant_id,unit_id,media_kind,mime_type,original_name,file_size_bytes,sha256_hex,sort_order,is_cover,created_by_identity_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',[id,ctx.tenant.id,unitId,info.kind,info.mime,info.name,info.size,info.sha256,Number(count.maxOrder)+1,info.kind==='image'&&!Number(count.covers),ctx.identity.id]);
    await audit(db,ctx,'real-estate.media-uploaded',id,{unitId,kind:info.kind,sizeBytes:info.size,sha256:info.sha256});await db.commit();return {id,kind:info.kind,name:info.name};
  }catch(error){await db.rollback();if(moved)await fsp.rm(target,{force:true}).catch(()=>{});throw error;}
}
async function getFile(db,ctx,unitId,mediaId){await inventory.getUnit(db,ctx,safeId(unitId));safeId(mediaId);const [[row]]=await db.query('SELECT media_kind AS kind,mime_type AS mimeType,original_name AS name,file_size_bytes AS sizeBytes FROM sx_real_estate_unit_media WHERE tenant_id=? AND unit_id=? AND id=? AND deleted_at IS NULL',[ctx.tenant.id,unitId,mediaId]);if(!row||(row.kind==='document'&&!canManage(ctx)))fail('MEDIA_NOT_FOUND',404);return {...row,path:filePath(ctx.tenant.id,unitId,mediaId)};}
async function remove(db,ctx,unitId,mediaId){
  properties.authorize(ctx,'properties.manage');safeId(unitId);safeId(mediaId);await db.beginTransaction();try{
    const [[unit]]=await db.query('SELECT id FROM sx_real_estate_units WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,unitId]);if(!unit)fail('UNIT_NOT_FOUND',404);
    const [[row]]=await db.query('SELECT id FROM sx_real_estate_unit_media WHERE tenant_id=? AND unit_id=? AND id=? AND deleted_at IS NULL FOR UPDATE',[ctx.tenant.id,unitId,mediaId]);if(!row)fail('MEDIA_NOT_FOUND',404);
    await db.query('UPDATE sx_real_estate_unit_media SET deleted_at=UTC_TIMESTAMP(3),is_cover=FALSE WHERE tenant_id=? AND unit_id=? AND id=?',[ctx.tenant.id,unitId,mediaId]);
    await audit(db,ctx,'real-estate.media-removed',mediaId,{unitId});await db.commit();return {removed:true};
  }catch(error){await db.rollback();throw error;}
}
async function update(db,ctx,unitId,input){
  properties.authorize(ctx,'properties.manage');safeId(unitId);
  if(!input||!Array.isArray(input.order)||input.order.length>UNIT_LIMIT||new Set(input.order).size!==input.order.length||input.order.some(id=>typeof id!=='string'||!ID.test(id))||(input.coverId!==null&&(typeof input.coverId!=='string'||!ID.test(input.coverId)))||Object.keys(input).some(k=>!['order','coverId'].includes(k)))fail('INVALID_MEDIA_ORDER');
  await db.beginTransaction();try{
    const [[unit]]=await db.query('SELECT id FROM sx_real_estate_units WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,unitId]);if(!unit)fail('UNIT_NOT_FOUND',404);
    const [rows]=await db.query('SELECT id,media_kind AS kind FROM sx_real_estate_unit_media WHERE tenant_id=? AND unit_id=? AND deleted_at IS NULL FOR UPDATE',[ctx.tenant.id,unitId]);
    const ids=new Set(rows.map(row=>row.id));if(rows.length!==input.order.length||input.order.some(id=>!ids.has(id))||(input.coverId&&!rows.some(row=>row.id===input.coverId&&row.kind==='image')))fail('INVALID_MEDIA_ORDER');
    for(const [position,id] of input.order.entries())await db.query('UPDATE sx_real_estate_unit_media SET sort_order=?,is_cover=? WHERE tenant_id=? AND unit_id=? AND id=?',[position,id===input.coverId,ctx.tenant.id,unitId,id]);
    await audit(db,ctx,'real-estate.media-ordered',unitId,{count:rows.length,coverId:input.coverId});await db.commit();return {updated:true};
  }catch(error){await db.rollback();throw error;}
}
module.exports={MAX_BYTES,ROOT,ensureDirectories,tempDirectory,inspect,list,attach,getFile,update,remove};
