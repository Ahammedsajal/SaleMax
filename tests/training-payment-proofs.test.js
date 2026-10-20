'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const proofs=require('../modules/platform/training-payment-proofs');
const {trainingCenter}=require('../modules/platform/categories');
function context(role='owner'){const tenantId=crypto.randomUUID();return {audience:'tenant',identity:{id:crypto.randomUUID()},tenant:{id:tenantId,status:'active',categoryKey:'training_center',categoryVersion:1},membership:{id:crypto.randomUUID(),tenantId,role,status:'active'},category:trainingCenter,subscription:{status:'active',capabilities:['finance.invoices','finance.payments']}};}
function png(){return Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]);}
test('payment proof accepts only supported screenshot signatures and requires private absolute storage',()=>{
  assert.deepEqual(proofs.signature(png()),{mime:'image/png',extension:'.png'});
  assert.equal(proofs.signature(Buffer.from('not an image')),null);
  assert.throws(()=>proofs.storageRoot({}),{code:'PAYMENT_PROOF_STORAGE_NOT_CONFIGURED'});
  assert.throws(()=>proofs.storageRoot({SALEMAX_PAYMENT_PROOF_ROOT:'relative/path'}),{code:'PAYMENT_PROOF_STORAGE_NOT_CONFIGURED'});
});
test('owner can attach tenant-private proof to a pending payment and access it by payment id only',async()=>{
  const ctx=context(),invoiceId=crypto.randomUUID(),paymentId=crypto.randomUUID(),root=await fs.mkdtemp(path.join(os.tmpdir(),'sx-proof-test-')),temp=path.join(root,'upload.tmp'),contents=png();await fs.writeFile(temp,contents);
  let storedRow=null;const calls=[];const db={async beginTransaction(){calls.push('begin');},async commit(){calls.push('commit');},async rollback(){calls.push('rollback');},async query(sql,params){calls.push(sql);if(sql.includes('SELECT id FROM sx_tenants'))return [[{id:ctx.tenant.id}]];if(sql.includes('SELECT id,invoice_id,status,proof_sha256'))return [[{id:paymentId,invoice_id:invoiceId,status:'pending_verification',proof_sha256:null}]];if(sql.startsWith('UPDATE sx_training_payments SET proof_storage_key')){storedRow={proof_storage_key:params[0],proof_sha256:params[1],proof_mime_type:params[2],proof_bytes:params[3],proof_uploaded_at:'2026-10-13 00:00:00'};return [{affectedRows:1}];}if(sql.includes('SELECT proof_storage_key'))return [[storedRow]];return [{affectedRows:1}];}};
  try{
    const result=await proofs.upload(db,ctx,paymentId,{tempFilePath:temp,size:contents.length,mimetype:'image/png'},{env:{SALEMAX_PAYMENT_PROOF_ROOT:root},invoiceId});
    assert.equal(result.uploaded,true);assert.equal(result.mimeType,'image/png');assert.equal(result.bytes,contents.length);assert.match(storedRow.proof_storage_key,new RegExp(`^${ctx.tenant.id}/${paymentId}/`));
    const proof=await proofs.get(db,ctx,paymentId,{env:{SALEMAX_PAYMENT_PROOF_ROOT:root}});assert.equal(proof.mimeType,'image/png');assert.deepEqual(await fs.readFile(proof.filePath),contents);assert.ok(calls.includes('commit'));
    await assert.rejects(proofs.get(db,context(),paymentId,{env:{SALEMAX_PAYMENT_PROOF_ROOT:root}}),{code:'PAYMENT_PROOF_NOT_FOUND'});
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('proof uploads reject unsupported data and roles before writing',async()=>{
  const ctx=context('agent'),root=await fs.mkdtemp(path.join(os.tmpdir(),'sx-proof-deny-')),temp=path.join(root,'upload.tmp');await fs.writeFile(temp,png());
  try{await assert.rejects(proofs.upload({query(){throw Error('unauthorized before DB')}},ctx,crypto.randomUUID(),{tempFilePath:temp,size:12,mimetype:'image/png'},{env:{SALEMAX_PAYMENT_PROOF_ROOT:root}}),{code:'PERMISSION_DENIED'});
    const owner=context(),db={query(){throw Error('type rejected before DB');},beginTransaction(){throw Error('type rejected before transaction');}};
    await assert.rejects(proofs.upload(db,owner,crypto.randomUUID(),{tempFilePath:temp,size:12,mimetype:'text/plain'},{env:{SALEMAX_PAYMENT_PROOF_ROOT:root}}),{code:'PAYMENT_PROOF_TYPE_NOT_ALLOWED'});
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
