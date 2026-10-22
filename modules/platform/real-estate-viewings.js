'use strict';

const crypto=require('node:crypto');
const {decision}=require('./policy');
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const uuid=()=>crypto.randomUUID();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OUTCOMES=new Set(['interested','follow_up','declined','leased_or_purchased','unknown']);
const sqlUtc=value=>value.toISOString().slice(0,23).replace('T',' ');

function authorize(context,permission){
  if(context?.audience!=='tenant'||context.tenant?.categoryKey!=='real_estate'||context.tenant?.categoryVersion!==3||context.tenant?.status!=='active'||context.membership?.tenantId!==context.tenant.id||context.membership?.status!=='active')fail('CATEGORY_UNAVAILABLE',404);
  const access=decision(context,{capability:'realestate.viewings',permission});if(!access.allowed)fail(access.code,access.code==='PERMISSION_DENIED'?403:409);
  const leadAccess=decision(context,{capability:'crm.leads',permission:'leads.read'});if(!leadAccess.allowed)fail(leadAccess.code,leadAccess.code==='PERMISSION_DENIED'?403:409);
  const propertyAccess=decision(context,{capability:'realestate.listings',permission:'properties.read'});if(!propertyAccess.allowed)fail(propertyAccess.code,propertyAccess.code==='PERMISSION_DENIED'?403:409);
  return access;
}
function parseTime(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))fail('INVALID_VIEWING_TIME');
  const milliseconds=Date.parse(value);if(!Number.isFinite(milliseconds))fail('INVALID_VIEWING_TIME');return new Date(milliseconds);
}
function clean(input,{partial=false}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_VIEWING');
  const allowed=new Set(partial?['startsAt','endsAt','assignedMembershipId','status','outcome','notes','expectedRevision']:['leadId','propertyId','requirementId','startsAt','endsAt','assignedMembershipId','notes']);
  if(Object.keys(input).some(key=>!allowed.has(key)))fail('INVALID_VIEWING');
  const out={};
  if(!partial){
    if(typeof input.leadId!=='string'||!UUID.test(input.leadId))fail('INVALID_VIEWING_LEAD');out.leadId=input.leadId;
    if(typeof input.propertyId!=='string'||!UUID.test(input.propertyId))fail('INVALID_VIEWING_PROPERTY');out.propertyId=input.propertyId;
    const requirementId=input.requirementId??null;if(requirementId!==null&&(typeof requirementId!=='string'||!UUID.test(requirementId)))fail('INVALID_VIEWING_REQUIREMENT');out.requirementId=requirementId;
    out.startsAt=parseTime(input.startsAt);out.endsAt=parseTime(input.endsAt);
    const minutes=(out.endsAt-out.startsAt)/60000;if(minutes<15||minutes>480||minutes%15!==0)fail('INVALID_VIEWING_DURATION');
    out.assignedMembershipId=input.assignedMembershipId??null;
    if(out.assignedMembershipId!==null&&(typeof out.assignedMembershipId!=='string'||!UUID.test(out.assignedMembershipId)))fail('INVALID_VIEWING_ASSIGNEE');
    const notes=input.notes??'';if(typeof notes!=='string'||notes.length>500)fail('INVALID_VIEWING_NOTES');out.notes=notes.trim();
  }else{
    if(Object.hasOwn(input,'startsAt')||Object.hasOwn(input,'endsAt')){
      if(!Object.hasOwn(input,'startsAt')||!Object.hasOwn(input,'endsAt'))fail('INVALID_VIEWING_TIME');
      out.startsAt=parseTime(input.startsAt);out.endsAt=parseTime(input.endsAt);const minutes=(out.endsAt-out.startsAt)/60000;if(minutes<15||minutes>480||minutes%15!==0)fail('INVALID_VIEWING_DURATION');
    }
    if(Object.hasOwn(input,'assignedMembershipId')){const value=input.assignedMembershipId??null;if(value!==null&&(typeof value!=='string'||!UUID.test(value)))fail('INVALID_VIEWING_ASSIGNEE');out.assignedMembershipId=value;}
    if(Object.hasOwn(input,'status')){if(!['completed','cancelled','no_show'].includes(input.status))fail('INVALID_VIEWING_STATUS');out.status=input.status;}
    if(Object.hasOwn(input,'outcome')){if(input.outcome!==null&&!OUTCOMES.has(input.outcome))fail('INVALID_VIEWING_OUTCOME');out.outcome=input.outcome;}
    if(Object.hasOwn(input,'notes')){if(typeof input.notes!=='string'||input.notes.length>500)fail('INVALID_VIEWING_NOTES');out.notes=input.notes.trim();}
    if(!Object.keys(out).length)fail('INVALID_VIEWING');
  }
  return out;
}
function leadScope(context,alias='l'){
  if(context.membership.role==='agent')return {sql:` AND EXISTS(SELECT 1 FROM sx_legacy_ownership own WHERE own.tenant_id=? AND own.source_table='agents' AND own.source_id=CAST(${alias}.owner_agent_id AS CHAR) AND own.membership_id=? AND own.legacy_uid_hash=${alias}.uid_hash)`,args:[context.tenant.id,context.membership.id]};
  if(context.membership.role==='manager')return {sql:` AND EXISTS(SELECT 1 FROM sx_legacy_ownership own JOIN sx_sales_org_history org ON org.tenant_id=own.tenant_id AND org.membership_id=own.membership_id AND org.manager_membership_id=? AND org.ended_at IS NULL WHERE own.tenant_id=? AND own.source_table='agents' AND own.source_id=CAST(${alias}.owner_agent_id AS CHAR) AND own.legacy_uid_hash=${alias}.uid_hash)`,args:[context.membership.id,context.tenant.id]};
  if(context.membership.role==='team_leader')return {sql:` AND EXISTS(SELECT 1 FROM sx_legacy_ownership own JOIN sx_sales_org_history org ON org.tenant_id=own.tenant_id AND org.membership_id=own.membership_id AND org.team_leader_membership_id=? AND org.ended_at IS NULL WHERE own.tenant_id=? AND own.source_table='agents' AND own.source_id=CAST(${alias}.owner_agent_id AS CHAR) AND own.legacy_uid_hash=${alias}.uid_hash)`,args:[context.membership.id,context.tenant.id]};
  return {sql:'',args:[]};
}
function teamMember(context,alias='v'){
  if(context.membership.role==='manager')return {sql:` AND (${alias}.assigned_membership_id=? OR EXISTS(SELECT 1 FROM sx_sales_org_history org WHERE org.tenant_id=${alias}.tenant_id AND org.membership_id=${alias}.assigned_membership_id AND org.manager_membership_id=? AND org.ended_at IS NULL))`,args:[context.membership.id,context.membership.id]};
  if(context.membership.role==='team_leader')return {sql:` AND (${alias}.assigned_membership_id=? OR EXISTS(SELECT 1 FROM sx_sales_org_history org WHERE org.tenant_id=${alias}.tenant_id AND org.membership_id=${alias}.assigned_membership_id AND org.team_leader_membership_id=? AND org.ended_at IS NULL))`,args:[context.membership.id,context.membership.id]};
  if(context.membership.role==='agent')return {sql:` AND ${alias}.assigned_membership_id=?`,args:[context.membership.id]};
  return {sql:'',args:[]};
}
function propertyScope(context,alias='p'){
  if(context.membership.role==='agent')return {sql:` AND ${alias}.assigned_membership_id=?`,args:[context.membership.id]};
  if(context.membership.role==='manager')return {sql:` AND (${alias}.assigned_membership_id IS NULL OR ${alias}.assigned_membership_id=? OR EXISTS(SELECT 1 FROM sx_sales_org_history org WHERE org.tenant_id=${alias}.tenant_id AND org.membership_id=${alias}.assigned_membership_id AND org.manager_membership_id=? AND org.ended_at IS NULL))`,args:[context.membership.id,context.membership.id]};
  if(context.membership.role==='team_leader')return {sql:` AND (${alias}.assigned_membership_id=? OR EXISTS(SELECT 1 FROM sx_sales_org_history org WHERE org.tenant_id=${alias}.tenant_id AND org.membership_id=${alias}.assigned_membership_id AND org.team_leader_membership_id=? AND org.ended_at IS NULL))`,args:[context.membership.id,context.membership.id]};
  return {sql:'',args:[]};
}
async function listAssignees(db,context){
  const access=authorize(context,'viewings.assign');const manager=context.membership.role==='manager'?' AND EXISTS(SELECT 1 FROM sx_sales_org_history org WHERE org.tenant_id=m.tenant_id AND org.membership_id=m.id AND org.manager_membership_id=? AND org.ended_at IS NULL)':'';
  const args=[context.tenant.id];if(manager)args.push(context.membership.id);
  const [items]=await db.query(`SELECT m.id AS membershipId,i.display_name AS name FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id WHERE m.tenant_id=? AND m.role='agent' AND m.status='active' AND i.status='active'${manager} ORDER BY i.display_name,m.id`,args);
  return {items,scope:access.scope};
}
async function listLeads(db,context){
  authorize(context,'viewings.read');if(!/^[a-f0-9]{64}$/i.test(context.legacyUidHash||''))fail('VERIFIED_BUSINESS_OWNER_REQUIRED',403);
  const scope=leadScope(context);const [items]=await db.query(`SELECT l.id,l.title,l.contact_name AS contactName,l.updated_at AS updatedAt FROM pipeline_leads l WHERE l.uid_hash=? AND l.status='open'${scope.sql} ORDER BY l.updated_at DESC,l.id LIMIT 300`,[context.legacyUidHash,...scope.args]);return {items,limit:300};
}
async function listProperties(db,context){
  authorize(context,'viewings.read');const scope=propertyScope(context);const [items]=await db.query(`SELECT p.id,p.reference_code AS referenceCode,p.title_en AS titleEn,p.title_ar AS titleAr,p.city,p.status,p.assigned_membership_id AS assignedMembershipId FROM sx_real_estate_properties p WHERE p.tenant_id=? AND p.status IN ('active','under_offer')${scope.sql} ORDER BY p.updated_at DESC,p.id LIMIT 300`,[context.tenant.id,...scope.args]);return {items,limit:300};
}
async function list(db,context,query={}){
  const access=authorize(context,'viewings.read');if(!/^[a-f0-9]{64}$/i.test(context.legacyUidHash||''))fail('VERIFIED_BUSINESS_OWNER_REQUIRED',403);
  const start=query.from?parseTime(query.from):null,end=query.to?parseTime(query.to):null;if(start&&end&&start>=end)fail('INVALID_VIEWING_TIME_RANGE');
  const where=['v.tenant_id=?','v.legacy_uid_hash=?'],args=[context.tenant.id,context.legacyUidHash];
  if(query.status&&query.status!=='all'){if(!['scheduled','completed','cancelled','no_show'].includes(query.status))fail('INVALID_VIEWING_STATUS');where.push('v.status=?');args.push(query.status);}
  if(start){where.push('v.ends_at_utc>?');args.push(sqlUtc(start));}if(end){where.push('v.starts_at_utc<?');args.push(sqlUtc(end));}
  const memberScope=teamMember(context),lead=leadScope(context);where.push(memberScope.sql.replace(/^ AND /,''),lead.sql.replace(/^ AND /,''));args.push(...memberScope.args,...lead.args);
  const page=Math.max(1,Math.min(10000,Number.parseInt(query.page,10)||1)),limit=Math.max(1,Math.min(100,Number.parseInt(query.limit,10)||50)),clause=where.filter(Boolean).join(' AND ');
  const [[count]]=await db.query(`SELECT COUNT(*) AS total FROM sx_real_estate_viewings v JOIN pipeline_leads l ON l.uid_hash=v.legacy_uid_hash AND l.id=v.lead_id WHERE ${clause}`,[...args]);
  const [items]=await db.query(`SELECT v.id,v.lead_id AS leadId,l.title AS leadTitle,l.contact_name AS contactName,v.property_id AS propertyId,p.reference_code AS referenceCode,p.title_en AS titleEn,p.title_ar AS titleAr,p.city,v.requirement_id AS requirementId,v.assigned_membership_id AS assignedMembershipId,i.display_name AS assignedName,DATE_FORMAT(v.starts_at_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS startsAt,DATE_FORMAT(v.ends_at_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS endsAt,v.status,v.outcome,v.notes,v.revision FROM sx_real_estate_viewings v JOIN pipeline_leads l ON l.uid_hash=v.legacy_uid_hash AND l.id=v.lead_id JOIN sx_real_estate_properties p ON p.tenant_id=v.tenant_id AND p.id=v.property_id LEFT JOIN sx_memberships m ON m.tenant_id=v.tenant_id AND m.id=v.assigned_membership_id LEFT JOIN sx_identities i ON i.id=m.identity_id WHERE ${clause} ORDER BY v.starts_at_utc,v.id LIMIT ? OFFSET ?`,[...args,limit,(page-1)*limit]);
  return {items,total:Number(count.total),page,limit,scope:access.scope};
}
async function validateAssignee(db,context,id){
  if(context.membership.role==='agent'||context.membership.role==='team_leader'){if(id&&id!==context.membership.id)fail('VIEWING_ASSIGNEE_UNAVAILABLE',409);return context.membership.id;}
  if(id===null){if(context.membership.role==='manager')fail('INVALID_VIEWING_ASSIGNEE');return null;}
  const manager=context.membership.role==='manager'?' AND EXISTS(SELECT 1 FROM sx_sales_org_history org WHERE org.tenant_id=m.tenant_id AND org.membership_id=m.id AND org.manager_membership_id=? AND org.ended_at IS NULL)':'';const args=[context.tenant.id,id];if(manager)args.push(context.membership.id);
  const [[row]]=await db.query(`SELECT m.id FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id WHERE m.tenant_id=? AND m.id=? AND m.role='agent' AND m.status='active' AND i.status='active'${manager} FOR UPDATE`,args);if(!row)fail('VIEWING_ASSIGNEE_UNAVAILABLE',409);return row.id;
}
async function assertLead(db,context,id){
  const scope=leadScope(context);const [[lead]]=await db.query(`SELECT l.id,l.owner_agent_id,o.membership_id AS assignedMembershipId FROM pipeline_leads l LEFT JOIN sx_legacy_ownership o ON o.tenant_id=? AND o.source_table='agents' AND o.source_id=CAST(l.owner_agent_id AS CHAR) AND o.legacy_uid_hash=l.uid_hash WHERE l.uid_hash=? AND l.id=? AND l.status='open'${scope.sql} LIMIT 1 FOR UPDATE`,[context.tenant.id,context.legacyUidHash,id,...scope.args]);if(!lead)fail('VIEWING_LEAD_NOT_FOUND',404);if(lead.owner_agent_id!==null&&!lead.assignedMembershipId)fail('VIEWING_LEAD_UNAVAILABLE',409);return lead;
}
async function assertProperty(db,context,id){
  const scope=propertyScope(context);const [[property]]=await db.query(`SELECT p.id,p.status,p.assigned_membership_id AS assignedMembershipId FROM sx_real_estate_properties p WHERE p.tenant_id=? AND p.id=?${scope.sql} LIMIT 1 FOR UPDATE`,[context.tenant.id,id,...scope.args]);if(!property)fail('VIEWING_PROPERTY_NOT_FOUND',404);if(!['active','under_offer'].includes(property.status))fail('VIEWING_PROPERTY_UNAVAILABLE',409);return property;
}
async function assertRequirement(db,context,id,leadId){
  if(id===null)return null;const [[row]]=await db.query(`SELECT id FROM sx_real_estate_requirements WHERE tenant_id=? AND legacy_uid_hash=? AND lead_id=? AND id=? AND status IN ('open','matched') LIMIT 1 FOR UPDATE`,[context.tenant.id,context.legacyUidHash,leadId,id]);if(!row)fail('VIEWING_REQUIREMENT_NOT_FOUND',404);return row.id;
}
async function assertNoOverlap(db,context,propertyId,start,end,excludeId=null){
  const [rows]=await db.query(`SELECT id FROM sx_real_estate_viewings WHERE tenant_id=? AND property_id=? AND status='scheduled' AND starts_at_utc<? AND ends_at_utc>?${excludeId?' AND id<>?':''} LIMIT 1 FOR UPDATE`,excludeId?[context.tenant.id,propertyId,sqlUtc(end),sqlUtc(start),excludeId]:[context.tenant.id,propertyId,sqlUtc(end),sqlUtc(start)]);if(rows.length)fail('VIEWING_SLOT_UNAVAILABLE',409);
}
async function create(db,context,input){
  const access=authorize(context,'viewings.manage');if(!/^[a-f0-9]{64}$/i.test(context.legacyUidHash||''))fail('VERIFIED_BUSINESS_OWNER_REQUIRED',403);const data=clean(input);if(Object.hasOwn(input,'assignedMembershipId'))authorize(context,'viewings.assign');
  await db.beginTransaction();try{
    const lead=await assertLead(db,context,data.leadId),property=await assertProperty(db,context,data.propertyId);data.requirementId=await assertRequirement(db,context,data.requirementId,data.leadId);
    const assigned=await validateAssignee(db,context,data.assignedMembershipId??lead.assignedMembershipId??(context.membership.role==='agent'||context.membership.role==='team_leader'?context.membership.id:null));if(!assigned)fail('INVALID_VIEWING_ASSIGNEE');
    if(access.scope==='assigned'&&property.assignedMembershipId!==context.membership.id)fail('VIEWING_PROPERTY_NOT_FOUND',404);
    if(['agent','team_leader'].includes(context.membership.role)&&lead.assignedMembershipId!==context.membership.id)fail('VIEWING_LEAD_NOT_FOUND',404);
    await assertNoOverlap(db,context,data.propertyId,data.startsAt,data.endsAt);
    const id=uuid();await db.query(`INSERT INTO sx_real_estate_viewings(id,tenant_id,legacy_uid_hash,lead_id,property_id,requirement_id,assigned_membership_id,starts_at_utc,ends_at_utc,notes,created_by_identity_id,updated_by_identity_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[id,context.tenant.id,context.legacyUidHash,lead.id,property.id,data.requirementId,assigned,sqlUtc(data.startsAt),sqlUtc(data.endsAt),data.notes,context.identity.id,context.identity.id]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','real-estate.viewing-created','real-estate-viewing',?,?,?)`,[uuid(),context.tenant.id,context.identity.id,id,JSON.stringify({leadId:lead.id,propertyId:property.id,requirementId:data.requirementId,assignedMembershipId:assigned,startsAt:data.startsAt.toISOString(),endsAt:data.endsAt.toISOString()}),uuid()]);
    await db.commit();return {id,...data,assignedMembershipId:assigned,status:'scheduled',revision:1};
  }catch(error){await db.rollback();throw error;}
}
async function update(db,context,id,input){
  const access=authorize(context,'viewings.manage');if(!UUID.test(id)||!Number.isSafeInteger(input?.expectedRevision)||input.expectedRevision<1)fail('INVALID_VIEWING_UPDATE');if(Object.hasOwn(input||{},'assignedMembershipId'))authorize(context,'viewings.assign');const patch=clean(input,{partial:true});
  await db.beginTransaction();try{
    // Keep lock order consistent with create (lead -> property -> viewing) and
    // property closure (property -> viewing) to avoid a concurrent deadlock.
    const [[target]]=await db.query('SELECT lead_id AS leadId,property_id AS propertyId FROM sx_real_estate_viewings WHERE tenant_id=? AND legacy_uid_hash=? AND id=? LIMIT 1',[context.tenant.id,context.legacyUidHash,id]);if(!target)fail('VIEWING_NOT_FOUND',404);
    await assertLead(db,context,target.leadId);
    await assertProperty(db,context,target.propertyId);
    const [[row]]=await db.query(`SELECT v.id,v.property_id AS propertyId,v.lead_id AS leadId,v.status,v.revision,DATE_FORMAT(v.starts_at_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS startsAt,DATE_FORMAT(v.ends_at_utc,'%Y-%m-%dT%H:%i:%s.%fZ') AS endsAt,v.assigned_membership_id AS assignedMembershipId FROM sx_real_estate_viewings v JOIN pipeline_leads l ON l.uid_hash=v.legacy_uid_hash AND l.id=v.lead_id WHERE v.tenant_id=? AND v.legacy_uid_hash=? AND v.id=? AND v.property_id=?${teamMember(context).sql}${leadScope(context).sql} LIMIT 1 FOR UPDATE`,[context.tenant.id,context.legacyUidHash,id,target.propertyId,...teamMember(context).args,...leadScope(context).args]);if(!row)fail('VIEWING_NOT_FOUND',404);if(Number(row.revision)!==input.expectedRevision)fail('STALE_REVISION',409);if(row.status!=='scheduled')fail('INVALID_VIEWING_TRANSITION',409);if(!Object.keys(patch).length)fail('INVALID_VIEWING_UPDATE');
    const start=patch.startsAt||new Date(row.startsAt),end=patch.endsAt||new Date(row.endsAt);if(patch.startsAt||patch.endsAt){const minutes=(end-start)/60000;if(minutes<15||minutes>480||minutes%15!==0)fail('INVALID_VIEWING_DURATION');}
    if(patch.startsAt||patch.endsAt)await assertNoOverlap(db,context,row.propertyId,start,end,id);
    if(Object.hasOwn(patch,'assignedMembershipId'))patch.assignedMembershipId=await validateAssignee(db,context,patch.assignedMembershipId);
    const sets=[],args=[];for(const [key,column] of [['startsAt','starts_at_utc'],['endsAt','ends_at_utc'],['assignedMembershipId','assigned_membership_id'],['status','status'],['outcome','outcome'],['notes','notes']])if(Object.hasOwn(patch,key)){sets.push(`${column}=?`);args.push(key==='startsAt'||key==='endsAt'?sqlUtc(patch[key]):patch[key]);}
    if(patch.status&&patch.status!=='completed'&&patch.status!=='cancelled'&&patch.status!=='no_show')fail('INVALID_VIEWING_STATUS');if(patch.status==='scheduled')fail('INVALID_VIEWING_TRANSITION');
    if(Object.hasOwn(patch,'outcome')&&patch.status!=='completed')fail('INVALID_VIEWING_OUTCOME');
    await db.query(`UPDATE sx_real_estate_viewings SET ${sets.join(',')},revision=revision+1,updated_by_identity_id=? WHERE tenant_id=? AND id=?`,[...args,context.identity.id,context.tenant.id,id]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','real-estate.viewing-updated','real-estate-viewing',?,?,?)`,[uuid(),context.tenant.id,context.identity.id,id,JSON.stringify({fields:Object.keys(patch),revision:input.expectedRevision+1}),uuid()]);await db.commit();return {id,...patch,revision:input.expectedRevision+1};
  }catch(error){await db.rollback();throw error;}
}
module.exports={OUTCOMES,authorize,parseTime,clean,leadScope,teamMember,propertyScope,listAssignees,listLeads,listProperties,list,create,update};
