'use strict';
const crypto=require('node:crypto');
const access=require('./policy');
const contract=require('./finance-contract');

const fail=(code,details)=>{throw Object.assign(new Error(code),{code,details});};
const uuid=()=>crypto.randomUUID();
function text(value,max,code,{optional=false}={}){
  if(value===null&&optional)return null;
  if(typeof value!=='string')fail(code);
  const result=value.trim();if(result.length>max||(!optional&&!result))fail(code);return result||null;
}
function normalize(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_FINANCE_POLICY');
  const allowed=new Set(['legalName','legalRegistrationNumber','legalAddress','invoicePrefix','taxMode','taxRateBps','revenueMethod','issueApprover','manualSecondApprovalAboveMinor']);
  if(Object.keys(input).some(key=>!allowed.has(key)))fail('INVALID_FINANCE_POLICY');
  const taxMode=input.taxMode??'unset',revenueMethod=input.revenueMethod??'unset',issueApprover=input.issueApprover??'unset';
  if(!['unset','no_tax','exclusive','inclusive'].includes(taxMode)||!['unset','deferred_until_delivery','over_time'].includes(revenueMethod)||!['unset','owner','accountant'].includes(issueApprover))fail('INVALID_FINANCE_POLICY');
  const rate=input.taxRateBps??null;if(rate!==null&&(!Number.isSafeInteger(rate)||rate<0||rate>10000))fail('INVALID_TAX_RATE');
  const threshold=input.manualSecondApprovalAboveMinor??null;if(threshold!==null&&(!Number.isSafeInteger(threshold)||threshold<0||threshold>100000000000))fail('INVALID_SECOND_APPROVAL_THRESHOLD');
  if(['exclusive','inclusive'].includes(taxMode)&&rate===null)fail('TAX_RATE_REQUIRED');
  if(taxMode==='no_tax'&&rate!==null)fail('TAX_RATE_NOT_APPLICABLE');
  if(taxMode==='unset'&&rate!==null)fail('TAX_MODE_REQUIRED');
  const legalName=text(input.legalName??'',200,'INVALID_LEGAL_NAME',{optional:true})||'',invoicePrefix=text(input.invoicePrefix??'',16,'INVALID_INVOICE_PREFIX',{optional:true})||'';if(invoicePrefix&&!/^[A-Z0-9-]{2,16}$/.test(invoicePrefix))fail('INVALID_INVOICE_PREFIX');
  const data={jurisdiction:'QA',currency:'QAR',legalName,legalRegistrationNumber:text(input.legalRegistrationNumber??null,100,'INVALID_REGISTRATION_NUMBER',{optional:true}),legalAddress:text(input.legalAddress??null,1000,'INVALID_LEGAL_ADDRESS',{optional:true}),invoicePrefix,taxMode,taxRateBps:rate,revenueMethod,issueApprover,manualSecondApprovalAboveMinor:threshold};
  return data;
}
function requireAccess(ctx,permission){
  if(!ctx||ctx.audience!=='tenant'||ctx.tenant?.categoryKey!=='training_center'||Number(ctx.tenant?.categoryVersion)!==1||ctx.tenant.status!=='active'||ctx.membership?.status!=='active'||ctx.membership.tenantId!==ctx.tenant.id)fail('TENANT_CONTEXT_REQUIRED');
  if(permission==='read'&&!['owner','accountant'].includes(ctx.membership.role))fail('PERMISSION_DENIED');
  const requests=[{capability:'tenant.settings',permission:permission==='configure'?'tenant.manage':'tenant.read'},{capability:'finance.invoices',permission:permission==='approve'?'invoices.issue':'invoices.read'}];
  if(permission==='approve')requests.push({capability:'finance.invoices',permission:'invoices.issue'});
  for(const request of requests){const result=access.decision(ctx,request);if(!result.allowed)fail(result.code);}
  if(permission==='configure'&&ctx.membership.role!=='owner')fail('PERMISSION_DENIED');
  if(permission==='approve'&&ctx.membership.role!=='accountant')fail('ACCOUNTANT_REQUIRED');
  if(!ctx.identity?.id)fail('IDENTITY_REQUIRED');
}
function shape(row){
  if(!row)return null;
  return {id:row.id,version:Number(row.version),revision:Number(row.revision),status:row.status,jurisdiction:row.jurisdiction,currency:row.currency,legalName:row.legal_name,legalRegistrationNumber:row.legal_registration_number,legalAddress:row.legal_address,invoicePrefix:row.invoice_prefix,taxMode:row.tax_mode,taxRateBps:row.tax_rate_bps===null?null:Number(row.tax_rate_bps),revenueMethod:row.revenue_method,issueApprover:row.issue_approver,manualSecondApprovalAboveMinor:row.manual_second_approval_above_minor===null?null:Number(row.manual_second_approval_above_minor),createdAt:row.created_at,submittedAt:row.submitted_at,reviewedByIdentityId:row.reviewed_by_identity_id,reviewedByRole:row.reviewed_by_role,reviewedAt:row.reviewed_at,reviewReason:row.review_reason,createdByIdentityId:row.created_by_identity_id};
}
const fields='id,tenant_id,version,revision,status,jurisdiction,currency,legal_name,legal_registration_number,legal_address,invoice_prefix,tax_mode,tax_rate_bps,revenue_method,issue_approver,manual_second_approval_above_minor,created_by_identity_id,submitted_at,reviewed_by_identity_id,reviewed_by_role,reviewed_at,review_reason,created_at';
async function get(db,ctx){
  requireAccess(ctx,'read');const tenantId=ctx.tenant.id;
  const [rows]=await db.query(`SELECT ${fields} FROM sx_training_finance_policies WHERE tenant_id=? ORDER BY version DESC LIMIT 2`,[tenantId]);
  const [approvedRows]=await db.query(`SELECT ${fields} FROM sx_training_finance_policies WHERE tenant_id=? AND status='approved' ORDER BY version DESC LIMIT 1`,[tenantId]);
  const current=shape(rows[0]),active=shape(approvedRows[0]);
  const policyGate=contract.postingReadiness(active?{...active,status:'approved',approvedByRole:active.reviewedByRole,approvedBy:active.reviewedByIdentityId}:null);
  return {current,active,configurationIssues:current?contract.policyConfigurationIssues(current):['FINANCE_POLICY_NOT_CONFIGURED'],policyReady:policyGate.ready,posting:{ready:false,policyReady:policyGate.ready,reasons:[...policyGate.reasons,'FINANCE_POSTING_MODULES_NOT_IMPLEMENTED']}};
}
async function history(db,ctx){
  requireAccess(ctx,'read');const [rows]=await db.query(`SELECT ${fields} FROM sx_training_finance_policies WHERE tenant_id=? ORDER BY version DESC LIMIT 50`,[ctx.tenant.id]);return rows.map(shape);
}
async function saveDraft(db,ctx,{expectedPolicyId=null,expectedRevision=0,input}){
  requireAccess(ctx,'configure');if(expectedPolicyId!==null&&(typeof expectedPolicyId!=='string'||!/^[0-9a-f-]{36}$/i.test(expectedPolicyId)))fail('INVALID_FINANCE_POLICY_REVISION');if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('INVALID_FINANCE_POLICY_REVISION');const data=normalize(input);
  await db.beginTransaction();try{
    await db.query('SELECT id FROM sx_tenants WHERE id=? FOR UPDATE',[ctx.tenant.id]);const [rows]=await db.query(`SELECT id,version,revision,status FROM sx_training_finance_policies WHERE tenant_id=? ORDER BY version DESC LIMIT 1 FOR UPDATE`,[ctx.tenant.id]);const latest=rows[0]||null;
    if((latest?.id||null)!==expectedPolicyId||Number(latest?.revision||0)!==expectedRevision)fail('STALE_FINANCE_POLICY');
    if(latest?.status==='pending_accountant')fail('FINANCE_POLICY_REVIEW_PENDING');
    let id,version,revision;
    if(latest?.status==='draft'){
      id=latest.id;version=Number(latest.version);revision=Number(latest.revision)+1;
      await db.query(`UPDATE sx_training_finance_policies SET revision=?,legal_name=?,legal_registration_number=?,legal_address=?,invoice_prefix=?,tax_mode=?,tax_rate_bps=?,revenue_method=?,issue_approver=?,manual_second_approval_above_minor=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND status='draft'`,[revision,data.legalName,data.legalRegistrationNumber,data.legalAddress,data.invoicePrefix,data.taxMode,data.taxRateBps,data.revenueMethod,data.issueApprover,data.manualSecondApprovalAboveMinor,ctx.tenant.id,id]);
    }else{
      id=uuid();version=Number(latest?.version||0)+1;revision=1;
      await db.query(`INSERT INTO sx_training_finance_policies(id,tenant_id,version,revision,status,jurisdiction,currency,legal_name,legal_registration_number,legal_address,invoice_prefix,tax_mode,tax_rate_bps,revenue_method,issue_approver,manual_second_approval_above_minor,created_by_identity_id) VALUES (?,?,?,1,'draft','QA','QAR',?,?,?,?,?,?,?,?,?,?)`,[id,ctx.tenant.id,version,data.legalName,data.legalRegistrationNumber,data.legalAddress,data.invoicePrefix,data.taxMode,data.taxRateBps,data.revenueMethod,data.issueApprover,data.manualSecondApprovalAboveMinor,ctx.identity.id]);
    }
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','training.finance-policy-draft-saved','finance-policy',?,?,?)`,[uuid(),ctx.tenant.id,ctx.identity.id,id,JSON.stringify({version,revision,status:'draft'}),uuid()]);
    const [[row]]=await db.query(`SELECT ${fields} FROM sx_training_finance_policies WHERE tenant_id=? AND id=?`,[ctx.tenant.id,id]);await db.commit();return shape(row);
  }catch(error){await db.rollback();throw error;}
}
async function submit(db,ctx,{id,expectedRevision}){
  requireAccess(ctx,'configure');if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)||!Number.isSafeInteger(expectedRevision)||expectedRevision<1)fail('INVALID_FINANCE_POLICY_REVISION');
  await db.beginTransaction();try{
    const [[row]]=await db.query(`SELECT ${fields} FROM sx_training_finance_policies WHERE tenant_id=? AND id=? FOR UPDATE`,[ctx.tenant.id,id]);if(!row)fail('FINANCE_POLICY_NOT_FOUND');if(row.status==='pending_accountant'&&Number(row.revision)===expectedRevision+1&&row.created_by_identity_id===ctx.identity.id){await db.commit();return {...shape(row),repeated:true};}if(row.status!=='draft')fail('FINANCE_POLICY_NOT_DRAFT');if(Number(row.revision)!==expectedRevision)fail('STALE_FINANCE_POLICY');const data=shape(row),issues=contract.policyConfigurationIssues(data);if(issues.length)fail('FINANCE_POLICY_INCOMPLETE',issues);
    await db.query(`UPDATE sx_training_finance_policies SET status='pending_accountant',revision=revision+1,submitted_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND status='draft'`,[ctx.tenant.id,id]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','training.finance-policy-submitted','finance-policy',?,?,?)`,[uuid(),ctx.tenant.id,ctx.identity.id,id,JSON.stringify({version:Number(row.version),revision:expectedRevision+1}),uuid()]);
    const [[updated]]=await db.query(`SELECT ${fields} FROM sx_training_finance_policies WHERE tenant_id=? AND id=?`,[ctx.tenant.id,id]);await db.commit();return shape(updated);
  }catch(error){await db.rollback();throw error;}
}
async function decide(db,ctx,{id,expectedRevision,decision,reason=''}){
  requireAccess(ctx,'approve');if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)||!Number.isSafeInteger(expectedRevision)||expectedRevision<1||!['approved','rejected'].includes(decision)||typeof reason!=='string'||reason.length>1000)fail('INVALID_FINANCE_POLICY_DECISION');const note=reason.trim();if(decision==='rejected'&&note.length<3)fail('FINANCE_POLICY_REJECTION_REASON_REQUIRED');
  await db.beginTransaction();try{
    const [[row]]=await db.query(`SELECT ${fields} FROM sx_training_finance_policies WHERE tenant_id=? AND id=? FOR UPDATE`,[ctx.tenant.id,id]);if(!row)fail('FINANCE_POLICY_NOT_FOUND');
    if(['approved','rejected','superseded'].includes(row.status)&&row.reviewed_by_identity_id===ctx.identity.id&&row.reviewed_by_role==='accountant'&&((decision==='approved'&&['approved','superseded'].includes(row.status))||(decision==='rejected'&&row.status==='rejected'))&&String(row.review_reason||'')===note){await db.commit();return {...shape(row),repeated:true};}
    if(row.status!=='pending_accountant')fail('FINANCE_POLICY_NOT_PENDING');if(Number(row.revision)!==expectedRevision)fail('STALE_FINANCE_POLICY');
    const data=shape(row);if(decision==='approved'){const issues=contract.policyConfigurationIssues(data);if(issues.length)fail('FINANCE_POLICY_INCOMPLETE',issues);await db.query(`UPDATE sx_training_finance_policies SET status='superseded',updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND status='approved'`,[ctx.tenant.id]);}
    await db.query(`UPDATE sx_training_finance_policies SET status=?,revision=revision+1,reviewed_by_identity_id=?,reviewed_by_role='accountant',reviewed_at=UTC_TIMESTAMP(3),review_reason=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND status='pending_accountant'`,[decision,ctx.identity.id,note||null,ctx.tenant.id,id]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity',?,'finance-policy',?,?,?)`,[uuid(),ctx.tenant.id,ctx.identity.id,`training.finance-policy-${decision}`,id,JSON.stringify({version:Number(row.version),revision:expectedRevision+1,reason:note||null}),uuid()]);
    const [[updated]]=await db.query(`SELECT ${fields} FROM sx_training_finance_policies WHERE tenant_id=? AND id=?`,[ctx.tenant.id,id]);await db.commit();return shape(updated);
  }catch(error){await db.rollback();throw error;}
}
module.exports={normalize,requireAccess,get,history,saveDraft,submit,decide};
