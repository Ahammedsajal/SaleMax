'use strict';

const crypto=require('node:crypto');
const {categoryKeyMatches}=require('./categories');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(code,status)=>{throw Object.assign(new Error(code),{code,status});};

async function resolveAccessibleLead(db,context,leadId){
  if(!UUID.test(String(leadId||'')))fail('INVALID_CALL_LEAD_ID',400);
  if(!categoryKeyMatches(context?.tenant?.categoryKey,'7network_sales'))fail('CALL_LEAD_CATEGORY_UNAVAILABLE',409);
  const [owners]=await db.query(`SELECT u.uid,o.legacy_uid_hash AS legacyUidHash FROM sx_legacy_ownership o
    JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED)
    JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id AND m.role='owner' AND m.status='active'
    WHERE o.tenant_id=? AND o.source_table='user' LIMIT 2`,[context.tenant.id]);
  if(owners.length!==1||!owners[0].uid||owners[0].legacyUidHash!==crypto.createHash('sha256').update(String(owners[0].uid),'utf8').digest('hex'))fail('CALL_LEAD_SCOPE_UNAVAILABLE',409);
  const ownerUid=owners[0].uid,uidHash=crypto.createHash('sha256').update(String(ownerUid),'utf8').digest('hex');
  let allowedAgentIds=null;
  if(context.membership.role==='agent'){
    const [agents]=await db.query(`SELECT a.id,a.uid,o.legacy_uid_hash AS legacyUidHash FROM agents a
      JOIN sx_legacy_ownership o ON o.source_table='agents' AND o.source_id=CAST(a.id AS CHAR) AND o.tenant_id=?
      JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id AND m.role='agent' AND m.status='active'
      WHERE a.owner_uid=? AND a.is_active=1 AND m.id=? LIMIT 2`,[context.tenant.id,ownerUid,context.membership.id]);
    if(agents.length!==1||agents[0].legacyUidHash!==crypto.createHash('sha256').update(String(agents[0].uid),'utf8').digest('hex'))fail('CALL_LEAD_NOT_ACCESSIBLE',404);
    allowedAgentIds=[Number(agents[0].id)];
  }else if(context.membership.role==='manager'||context.membership.role==='team_leader'){
    const scopeColumn=context.membership.role==='manager'?'manager_membership_id':'team_leader_membership_id';
    const [agents]=await db.query(`SELECT DISTINCT a.id,a.uid,o.legacy_uid_hash AS legacyUidHash FROM sx_sales_org_history h
      JOIN sx_memberships m ON m.tenant_id=h.tenant_id AND m.id=h.membership_id AND m.role='agent' AND m.status='active'
      JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id AND o.source_table='agents'
      JOIN agents a ON a.id=CAST(o.source_id AS UNSIGNED) AND a.owner_uid=? AND a.is_active=1
      WHERE h.tenant_id=? AND h.ended_at IS NULL AND h.${scopeColumn}=?`,[ownerUid,context.tenant.id,context.membership.id]);
    allowedAgentIds=agents.filter(row=>row.legacyUidHash===crypto.createHash('sha256').update(String(row.uid),'utf8').digest('hex')).map(row=>Number(row.id));
  }else if(context.membership.role!=='owner')fail('PERMISSION_DENIED',403);
  const [leads]=await db.query(`SELECT id,owner_agent_id,mobile FROM pipeline_leads
    WHERE uid_hash=? AND id=? LIMIT 1 FOR UPDATE`,[uidHash,leadId]);
  const lead=leads[0];
  if(!lead||(allowedAgentIds!==null&&(!lead.owner_agent_id||!allowedAgentIds.includes(Number(lead.owner_agent_id)))))fail('CALL_LEAD_NOT_ACCESSIBLE',404);
  return {leadId:lead.id,leadUidHash:uidHash,destination:String(lead.mobile||'').trim()};
}

async function resolveLeadLink(db,context,leadId){
  const lead=await resolveAccessibleLead(db,context,leadId);
  const [[suppression]]=await db.query(`SELECT id FROM pipeline_activity WHERE uid_hash=? AND lead_id=?
    AND activity_type='contact_outcome' AND summary='Contact outcome: do_not_call' LIMIT 1`,[lead.leadUidHash,lead.leadId]);
  if(suppression)fail('CALL_LEAD_DO_NOT_CALL',409);
  if(!/^\+[1-9][0-9]{7,14}$/.test(lead.destination))fail('CALL_LEAD_PHONE_INVALID',409);
  return lead;
}

async function resolveOutboundRecipient(db,context,input){
  const sales=categoryKeyMatches(context?.tenant?.categoryKey,'7network_sales');
  if(sales&&!input?.leadId)fail('OUTBOUND_LEAD_REQUIRED',400);
  const leadLink=input?.leadId?await resolveLeadLink(db,context,input.leadId):null;
  const destination=sales?leadLink.destination:input?.destination;
  if(typeof destination!=='string'||!/^\+[1-9][0-9]{7,14}$/.test(destination))fail('INVALID_OUTBOUND_CALL',400);
  return {leadLink,destination};
}

function phoneDigitsForMatch(value){
  const raw=String(value||'').trim();
  if(!raw||raw.length>64)return null;
  let digits=raw.replace(/\D/g,'');
  if(digits.startsWith('00'))digits=digits.slice(2);
  return /^[0-9]{7,15}$/.test(digits)&&!/^0+$/.test(digits)?digits:null;
}

async function findUniqueLeadLinkByNumber(db,{tenantId,categoryKey,number}={}){
  const digits=phoneDigitsForMatch(number);
  if(!digits||!tenantId||!categoryKeyMatches(categoryKey,'7network_sales'))return null;
  const [owners]=await db.query(`SELECT u.uid,o.legacy_uid_hash AS legacyUidHash FROM sx_legacy_ownership o
    JOIN user u ON u.id=CAST(o.source_id AS UNSIGNED)
    JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id AND m.role='owner' AND m.status='active'
    WHERE o.tenant_id=? AND o.source_table='user' LIMIT 2`,[tenantId]);
  if(owners.length!==1||!owners[0].uid
    ||owners[0].legacyUidHash!==crypto.createHash('sha256').update(String(owners[0].uid),'utf8').digest('hex'))return null;
  const uidHash=crypto.createHash('sha256').update(String(owners[0].uid),'utf8').digest('hex');
  const normalizedMobile=`CASE WHEN LEFT(REGEXP_REPLACE(COALESCE(l.mobile,''),'[^0-9]',''),2)='00'
    THEN SUBSTRING(REGEXP_REPLACE(COALESCE(l.mobile,''),'[^0-9]',''),3)
    ELSE REGEXP_REPLACE(COALESCE(l.mobile,''),'[^0-9]','') END`;
  const [matches]=await db.query(`SELECT l.id FROM pipeline_leads l
    WHERE l.uid_hash=? AND ${normalizedMobile}=? LIMIT 2`,[uidHash,digits]);
  if(matches.length!==1)return null;
  return {leadUidHash:uidHash,leadId:matches[0].id};
}

async function resolveAccessibleLeadLinkByNumber(db,{tenantId,categoryKey,membershipId,role,number}={}){
  const candidate=await findUniqueLeadLinkByNumber(db,{tenantId,categoryKey,number});
  if(!candidate)return null;
  try{
    const accessible=await resolveAccessibleLead(db,{tenant:{id:tenantId,categoryKey},membership:{id:membershipId,role}},candidate.leadId);
    return {leadUidHash:accessible.leadUidHash,leadId:accessible.leadId};
  }catch(error){
    if(['CALL_LEAD_NOT_ACCESSIBLE','CALL_LEAD_SCOPE_UNAVAILABLE','CALL_LEAD_CATEGORY_UNAVAILABLE','PERMISSION_DENIED'].includes(error.code))return null;
    throw error;
  }
}

module.exports={resolveLeadLink,resolveAccessibleLead,resolveOutboundRecipient,phoneDigitsForMatch,findUniqueLeadLinkByNumber,
  resolveAccessibleLeadLinkByNumber};
