'use strict';
const crypto=require('node:crypto');
const generator=require('./invoice-generator');
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
const isUuid=value=>typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value);
async function mutate(db,ctx,{uid,id,input,action}){
  generator.requireRole(ctx,true);
  if(!isUuid(id)||!input||!isUuid(input.requestKey)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1)fail('INVALID_INVOICE_EDIT',400);
  const normalized=action==='updated'?generator.normalizeInput(input):null;
  const payloadHash=crypto.createHash('sha256').update(JSON.stringify({id,action,expectedRevision:input.expectedRevision,payloadHash:normalized?.payloadHash||null})).digest('hex');
  await db.beginTransaction();try{
    // Conversion takes this same tenant lock before linking a generated document.
    const [[tenant]]=await db.query("SELECT id FROM sx_tenants WHERE id=? AND status='active' FOR UPDATE",[ctx.tenant.id]);if(!tenant)fail('BUSINESS_INACTIVE');
    const [[priorRequest]]=await db.query('SELECT document_id,payload_hash,result_snapshot FROM sx_invoice_generator_document_history WHERE tenant_id=? AND request_key=?',[ctx.tenant.id,input.requestKey]);
    if(priorRequest){if(priorRequest.document_id!==id||priorRequest.payload_hash!==payloadHash)fail('INVOICE_REQUEST_KEY_CONFLICT');await db.commit();return {...(typeof priorRequest.result_snapshot==='string'?JSON.parse(priorRequest.result_snapshot):priorRequest.result_snapshot),repeated:true};}
    const [[document]]=await db.query('SELECT d.snapshot,COALESCE(ds.revision,1) AS revision,ds.deleted_at FROM sx_invoice_generator_documents d LEFT JOIN sx_invoice_generator_document_state ds ON ds.tenant_id=d.tenant_id AND ds.document_id=d.id WHERE d.tenant_id=? AND d.id=? FOR UPDATE',[ctx.tenant.id,id]);
    if(!document||document.deleted_at)fail('INVOICE_NOT_FOUND',404);
    if(Number(document.revision)!==input.expectedRevision)fail('STALE_INVOICE_REVISION');
    const [[linked]]=await db.query('SELECT invoice_id FROM sx_training_generated_invoice_links WHERE tenant_id=? AND generated_document_id=? FOR UPDATE',[ctx.tenant.id,id]);if(linked)fail('INVOICE_LINKED_READ_ONLY');
    const [[replacement]]=await db.query('SELECT replacement_invoice_id FROM sx_invoice_generator_replacements WHERE tenant_id=? AND prior_invoice_id=?',[ctx.tenant.id,id]);if(replacement)fail('INVOICE_REPLACED_READ_ONLY');
    const prior=typeof document.snapshot==='string'?JSON.parse(document.snapshot):document.snapshot,revision=Number(document.revision)+1;
    let result;
    if(action==='updated'){
      const current=await generator.lockedSettings(db,ctx),draft=await generator.buildDocument(db,ctx,{uid,normalized,current});
      result={...draft.snapshot,id,invoiceNumber:prior.invoiceNumber,issuedAt:prior.issuedAt,revision,updatedAt:new Date().toISOString(),canEdit:true,canDelete:true};
      await db.query('UPDATE sx_invoice_generator_documents SET customer_type=?,customer_id=?,customer_name=?,course_id=?,course_name=?,amount_minor=?,snapshot=? WHERE tenant_id=? AND id=?',[normalized.customerType,normalized.customerId,normalized.customerName,draft.primaryCourseId,draft.courseName,result.totalMinor,JSON.stringify(result),ctx.tenant.id,id]);
    }else result={id,invoiceNumber:prior.invoiceNumber,revision,deleted:true};
    await db.query('INSERT INTO sx_invoice_generator_document_state(tenant_id,document_id,revision,deleted_at,updated_by_identity_id) VALUES(?,?,?,IF(?,UTC_TIMESTAMP(3),NULL),?) ON DUPLICATE KEY UPDATE revision=VALUES(revision),deleted_at=VALUES(deleted_at),updated_by_identity_id=VALUES(updated_by_identity_id),updated_at=UTC_TIMESTAMP(3)',[ctx.tenant.id,id,revision,action==='deleted',ctx.identity.id]);
    await db.query('INSERT INTO sx_invoice_generator_document_history(id,tenant_id,document_id,request_key,payload_hash,prior_revision,action,prior_snapshot,result_snapshot,actor_identity_id) VALUES(?,?,?,?,?,?,?,?,?,?)',[crypto.randomUUID(),ctx.tenant.id,id,input.requestKey,payloadHash,document.revision,action,JSON.stringify(prior),JSON.stringify(result),ctx.identity.id]);
    await db.commit();return result;
  }catch(error){await db.rollback();throw error;}
}
const update=(db,ctx,options)=>mutate(db,ctx,{...options,action:'updated'});
const remove=(db,ctx,options)=>mutate(db,ctx,{...options,action:'deleted'});
module.exports={update,remove};
