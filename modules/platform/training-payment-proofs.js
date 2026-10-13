'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const payments=require('./training-payments');
const fail=(code,status)=>{throw Object.assign(new Error(code),{code,status});};
const LIMIT=5*1024*1024;
function signature(buffer){
  if(Buffer.isBuffer(buffer)&&buffer.length>=3&&buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff)return {mime:'image/jpeg',extension:'.jpg'};
  if(Buffer.isBuffer(buffer)&&buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:'image/png',extension:'.png'};
  if(Buffer.isBuffer(buffer)&&buffer.length>=12&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return {mime:'image/webp',extension:'.webp'};
  return null;
}
function storageRoot(env=process.env){const root=String(env.SALEMAX_PAYMENT_PROOF_ROOT||'').trim();if(!root||!path.isAbsolute(root))fail('PAYMENT_PROOF_STORAGE_NOT_CONFIGURED',503);return path.resolve(root);}
async function upload(db,ctx,paymentId,file,{env=process.env,invoiceId=null}={}){
  payments.requireRole(ctx,'payments.verify',['owner','accountant']);
  if(!/^[0-9a-f-]{36}$/i.test(paymentId||''))fail('INVALID_PAYMENT_ID',400);
  if(!file||file.truncated||!file.tempFilePath||!Number.isSafeInteger(file.size)||file.size<1||file.size>LIMIT)fail('INVALID_PAYMENT_PROOF',400);
  const bytes=await fs.readFile(file.tempFilePath);if(bytes.length!==file.size||bytes.length>LIMIT)fail('INVALID_PAYMENT_PROOF',400);
  const detected=signature(bytes);if(!detected||file.mimetype!==detected.mime)fail('PAYMENT_PROOF_TYPE_NOT_ALLOWED',415);
  const sha256=crypto.createHash('sha256').update(bytes).digest('hex'),root=storageRoot(env),tenantId=ctx.tenant.id,fileName=`${crypto.randomBytes(18).toString('hex')}${detected.extension}`,storageKey=`${tenantId}/${paymentId}/${fileName}`,destination=path.join(root,storageKey);
  await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});let stored=false;
  try{
    const handle=await fs.open(destination,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}stored=true;
    await db.beginTransaction();await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[tenantId]);const [[payment]]=await db.query('SELECT id,invoice_id,status,proof_sha256 FROM sx_training_payments WHERE tenant_id=? AND id=? FOR UPDATE',[tenantId,paymentId]);
    if(!payment||invoiceId&&payment.invoice_id!==invoiceId)fail('PAYMENT_NOT_FOUND',404);if(payment.status!=='pending_verification')fail('PAYMENT_NOT_PENDING',409);
    if(payment.proof_sha256){await db.commit();await fs.rm(destination,{force:true});stored=false;if(payment.proof_sha256===sha256)return {uploaded:true,repeated:true,sha256};fail('PAYMENT_PROOF_ALREADY_UPLOADED',409);}
    await db.query('UPDATE sx_training_payments SET proof_storage_key=?,proof_sha256=?,proof_mime_type=?,proof_bytes=?,proof_uploaded_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?',[storageKey,sha256,detected.mime,bytes.length,tenantId,paymentId]);
    const eventId=crypto.randomUUID();await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','training.payment-proof-uploaded','payment',?,?,?)`,[eventId,tenantId,ctx.identity.id,paymentId,JSON.stringify({sha256,mimeType:detected.mime,bytes:bytes.length}),eventId]);
    await db.commit();return {uploaded:true,repeated:false,sha256,mimeType:detected.mime,bytes:bytes.length};
  }catch(error){try{await db.rollback();}catch{}if(stored)await fs.rm(destination,{force:true}).catch(()=>{});throw error;}
}
async function get(db,ctx,paymentId,{env=process.env}={}){
  payments.requireRole(ctx,'payments.verify',['owner','accountant']);if(!/^[0-9a-f-]{36}$/i.test(paymentId||''))fail('INVALID_PAYMENT_ID',400);
  const [[row]]=await db.query('SELECT proof_storage_key,proof_sha256,proof_mime_type,proof_bytes,proof_uploaded_at FROM sx_training_payments WHERE tenant_id=? AND id=?',[ctx.tenant.id,paymentId]);if(!row)fail('PAYMENT_NOT_FOUND',404);if(!row.proof_storage_key)fail('PAYMENT_PROOF_NOT_FOUND',404);
  const expectedPrefix=`${ctx.tenant.id}/${paymentId}/`;if(!row.proof_storage_key.startsWith(expectedPrefix)||row.proof_storage_key.includes('..'))fail('PAYMENT_PROOF_NOT_FOUND',404);
  const root=storageRoot(env),filePath=path.resolve(root,row.proof_storage_key);if(!filePath.startsWith(root+path.sep))fail('PAYMENT_PROOF_NOT_FOUND',404);await fs.access(filePath);
  return {filePath,mimeType:row.proof_mime_type,bytes:Number(row.proof_bytes),sha256:row.proof_sha256,uploadedAt:row.proof_uploaded_at};
}
module.exports={LIMIT,signature,storageRoot,upload,get};
