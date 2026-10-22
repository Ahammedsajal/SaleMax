'use strict';

const crypto=require('node:crypto');
const {decision}=require('./policy');
const TYPES=new Set(['any','apartment','house','villa','townhouse','land','commercial','office','warehouse','other']);
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const uuid=()=>crypto.randomUUID();

function authorize(context,permission){
  if(context?.audience!=='tenant'||context.tenant?.categoryKey!=='real_estate'||context.tenant?.status!=='active'||context.membership?.tenantId!==context.tenant.id||context.membership?.status!=='active')fail('CATEGORY_UNAVAILABLE',404);
  const access=decision(context,{capability:'realestate.requirements',permission});
  if(!access.allowed)fail(access.code,access.code==='PERMISSION_DENIED'?403:409);
  const leadAccess=decision(context,{capability:'crm.leads',permission:'leads.read'});
  if(!leadAccess.allowed)fail(leadAccess.code,leadAccess.code==='PERMISSION_DENIED'?403:409);
  return access;
}
async function leadOptions(db,context){
  authorize(context,'requirements.read');
  if(!/^[a-f0-9]{64}$/i.test(context.legacyUidHash||''))fail('VERIFIED_BUSINESS_OWNER_REQUIRED',403);
  const scope=leadScopeSql(context);
  const [items]=await db.query(`SELECT l.id,l.title,l.contact_name AS contactName,l.status,l.updated_at AS updatedAt FROM pipeline_leads l WHERE l.uid_hash=? AND l.status='open'${scope.sql} ORDER BY l.updated_at DESC,l.id LIMIT 300`,[context.legacyUidHash,...scope.args]);
  return {items,limit:300};
}
function clean(input,{partial=false}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_REQUIREMENT');
  const keys=new Set(partial?['status','assignedMembershipId','expectedRevision']:['leadId','transactionType','propertyType','minPriceMinor','maxPriceMinor','currency','minAreaSqm','maxAreaSqm','minBedrooms','preferredCity','assignedMembershipId']);
  if(Object.keys(input).some(key=>!keys.has(key)))fail('INVALID_REQUIREMENT');
  const out={};
  if(!partial){
    if(typeof input.leadId!=='string'||!/^[0-9a-f-]{36}$/i.test(input.leadId))fail('INVALID_REQUIREMENT_LEAD');out.leadId=input.leadId;
    if(!['sale','rent'].includes(input.transactionType))fail('INVALID_REQUIREMENT_TRANSACTION');out.transactionType=input.transactionType;
    if(!TYPES.has(input.propertyType??'any'))fail('INVALID_REQUIREMENT_PROPERTY_TYPE');out.propertyType=input.propertyType??'any';
    for(const [key,max] of [['minPriceMinor',999999999999],['maxPriceMinor',999999999999]]){const value=input[key]??null;if(value!==null&&(!Number.isSafeInteger(value)||value<0||value>max))fail('INVALID_REQUIREMENT_PRICE');out[key]=value;}
    if(out.minPriceMinor!==null&&out.maxPriceMinor!==null&&out.minPriceMinor>out.maxPriceMinor)fail('INVALID_REQUIREMENT_PRICE_RANGE');
    const currency=input.currency??'QAR';if(typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency))fail('INVALID_REQUIREMENT_CURRENCY');out.currency=currency;
    for(const [key,max] of [['minAreaSqm',10000000],['maxAreaSqm',10000000]]){const value=input[key]??null;if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>max))fail('INVALID_REQUIREMENT_AREA');out[key]=value;}
    if(out.minAreaSqm!==null&&out.maxAreaSqm!==null&&out.minAreaSqm>out.maxAreaSqm)fail('INVALID_REQUIREMENT_AREA_RANGE');
    const bedrooms=input.minBedrooms??null;if(bedrooms!==null&&(!Number.isSafeInteger(bedrooms)||bedrooms<0||bedrooms>500))fail('INVALID_REQUIREMENT_BEDROOMS');out.minBedrooms=bedrooms;
    const city=input.preferredCity??null;if(city!==null&&(typeof city!=='string'||!city.trim()||city.trim().length>100))fail('INVALID_REQUIREMENT_CITY');out.preferredCity=city?.trim()||null;
    out.assignedMembershipId=validMembershipId(input.assignedMembershipId??null);
  }else{
    if(Object.hasOwn(input,'status')){if(!['open','matched','closed'].includes(input.status))fail('INVALID_REQUIREMENT_STATUS');out.status=input.status;}
    if(Object.hasOwn(input,'assignedMembershipId'))out.assignedMembershipId=validMembershipId(input.assignedMembershipId??null);
    if(!Object.keys(out).length)fail('INVALID_REQUIREMENT');
  }
  return out;
}
function validMembershipId(value){if(value===null)return null;if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))fail('INVALID_REQUIREMENT_ASSIGNEE');return value;}
function scopeSql(context,scope,alias='r'){
  if(scope==='assigned')return {sql:` AND ${alias}.assigned_membership_id=?`,args:[context.membership.id]};
  if(scope==='team'&&context.membership.role==='manager')return {sql:` AND (${alias}.assigned_membership_id=? OR EXISTS (SELECT 1 FROM sx_sales_org_history org WHERE org.tenant_id=${alias}.tenant_id AND org.membership_id=${alias}.assigned_membership_id AND org.manager_membership_id=? AND org.ended_at IS NULL))`,args:[context.membership.id,context.membership.id]};
  if(scope==='team')return {sql:` AND (${alias}.assigned_membership_id=? OR EXISTS (SELECT 1 FROM sx_sales_org_history org WHERE org.tenant_id=${alias}.tenant_id AND org.membership_id=${alias}.assigned_membership_id AND org.team_leader_membership_id=? AND org.ended_at IS NULL))`,args:[context.membership.id,context.membership.id]};
  return {sql:'',args:[]};
}
function leadScopeSql(context,alias='l'){
  if(context.membership.role==='agent')return {sql:` AND EXISTS (SELECT 1 FROM sx_legacy_ownership own WHERE own.tenant_id=? AND own.source_table='agents' AND own.source_id=CAST(${alias}.owner_agent_id AS CHAR) AND own.membership_id=? AND own.legacy_uid_hash=${alias}.uid_hash)`,args:[context.tenant.id,context.membership.id]};
  if(context.membership.role==='manager')return {sql:` AND EXISTS (SELECT 1 FROM sx_legacy_ownership own JOIN sx_sales_org_history org ON org.tenant_id=own.tenant_id AND org.membership_id=own.membership_id AND org.manager_membership_id=? AND org.ended_at IS NULL WHERE own.tenant_id=? AND own.source_table='agents' AND own.source_id=CAST(${alias}.owner_agent_id AS CHAR) AND own.legacy_uid_hash=${alias}.uid_hash)`,args:[context.membership.id,context.tenant.id]};
  if(context.membership.role==='team_leader')return {sql:` AND EXISTS (SELECT 1 FROM sx_legacy_ownership own JOIN sx_sales_org_history org ON org.tenant_id=own.tenant_id AND org.membership_id=own.membership_id AND org.team_leader_membership_id=? AND org.ended_at IS NULL WHERE own.tenant_id=? AND own.source_table='agents' AND own.source_id=CAST(${alias}.owner_agent_id AS CHAR) AND own.legacy_uid_hash=${alias}.uid_hash)`,args:[context.membership.id,context.tenant.id]};
  return {sql:'',args:[]};
}
async function validateAssignee(db,context,id){
  if(id===null)return null;
  const manager=context.membership.role==='manager'?' AND EXISTS (SELECT 1 FROM sx_sales_org_history org WHERE org.tenant_id=m.tenant_id AND org.membership_id=m.id AND org.manager_membership_id=? AND org.ended_at IS NULL)':'';
  const args=[context.tenant.id,id];if(manager)args.push(context.membership.id);
  const [[row]]=await db.query(`SELECT m.id FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id WHERE m.tenant_id=? AND m.id=? AND m.role='agent' AND m.status='active' AND i.status='active'${manager} FOR UPDATE`,args);
  if(!row)fail('REQUIREMENT_ASSIGNEE_UNAVAILABLE',409);return row.id;
}
async function listAssignees(db,context){
  const access=authorize(context,'requirements.assign');
  const manager=context.membership.role==='manager'?' AND EXISTS (SELECT 1 FROM sx_sales_org_history org WHERE org.tenant_id=m.tenant_id AND org.membership_id=m.id AND org.manager_membership_id=? AND org.ended_at IS NULL)':'';
  const args=[context.tenant.id];if(manager)args.push(context.membership.id);
  const [items]=await db.query(`SELECT m.id AS membershipId,i.display_name AS name FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id WHERE m.tenant_id=? AND m.role='agent' AND m.status='active' AND i.status='active'${manager} ORDER BY i.display_name,m.id`,args);
  return {items,scope:access.scope};
}
async function list(db,context,query={}){
  const access=authorize(context,'requirements.read');
  if(!/^[a-f0-9]{64}$/i.test(context.legacyUidHash||''))fail('VERIFIED_BUSINESS_OWNER_REQUIRED',403);
  const page=Math.max(1,Math.min(100000,Number.parseInt(query.page,10)||1)),limit=Math.max(1,Math.min(50,Number.parseInt(query.limit,10)||25));
  const status=String(query.status||'open');if(!['open','matched','closed','all'].includes(status))fail('INVALID_REQUIREMENT_STATUS');
  const scoped=scopeSql(context,access.scope),leadScope=leadScopeSql(context),where=['r.tenant_id=?','r.legacy_uid_hash=?'],args=[context.tenant.id,context.legacyUidHash];
  if(status!=='all'){where.push('r.status=?');args.push(status);}where.push(scoped.sql.replace(/^ AND /,''));args.push(...scoped.args);
  where.push(leadScope.sql.replace(/^ AND /,''));args.push(...leadScope.args);
  const visibleClause=where.filter(Boolean).join(' AND ');
  const [[count]]=await db.query(`SELECT COUNT(*) AS total FROM sx_real_estate_requirements r JOIN pipeline_leads l ON l.uid_hash=r.legacy_uid_hash AND l.id=r.lead_id WHERE ${visibleClause}`,args);
  const [items]=await db.query(`SELECT r.id,r.lead_id AS leadId,l.title AS leadTitle,l.contact_name AS contactName,r.transaction_type AS transactionType,r.property_type AS propertyType,r.min_price_minor AS minPriceMinor,r.max_price_minor AS maxPriceMinor,r.currency,r.min_area_sqm AS minAreaSqm,r.max_area_sqm AS maxAreaSqm,r.min_bedrooms AS minBedrooms,r.preferred_city AS preferredCity,r.assigned_membership_id AS assignedMembershipId,a.display_name AS assignedName,r.status,r.revision,r.created_at AS createdAt,r.updated_at AS updatedAt FROM sx_real_estate_requirements r JOIN pipeline_leads l ON l.uid_hash=r.legacy_uid_hash AND l.id=r.lead_id LEFT JOIN sx_memberships m ON m.tenant_id=r.tenant_id AND m.id=r.assigned_membership_id LEFT JOIN sx_identities a ON a.id=m.identity_id WHERE ${visibleClause} ORDER BY r.updated_at DESC,r.id LIMIT ? OFFSET ?`,[...args,limit,(page-1)*limit]);
  return {items,total:Number(count.total),page,limit};
}
async function create(db,context,input){
  authorize(context,'requirements.manage');if(!/^[a-f0-9]{64}$/i.test(context.legacyUidHash||''))fail('VERIFIED_BUSINESS_OWNER_REQUIRED',403);
  if(Object.hasOwn(input||{},'assignedMembershipId'))authorize(context,'requirements.assign');
  const data=clean(input),hasAssignee=Object.hasOwn(input,'assignedMembershipId');await db.beginTransaction();
  try{
    const [[lead]]=await db.query(`SELECT l.id,l.owner_agent_id,o.membership_id AS leadAssignee FROM pipeline_leads l LEFT JOIN sx_legacy_ownership o ON o.tenant_id=? AND o.source_table='agents' AND o.source_id=CAST(l.owner_agent_id AS CHAR) AND o.legacy_uid_hash=l.uid_hash WHERE l.uid_hash=? AND l.id=? LIMIT 1 FOR UPDATE`,[context.tenant.id,context.legacyUidHash,data.leadId]);
    if(!lead)fail('REQUIREMENT_LEAD_NOT_FOUND',404);
    if(lead.owner_agent_id!==null&&lead.owner_agent_id!==undefined&&!lead.leadAssignee)fail('REQUIREMENT_LEAD_UNAVAILABLE',409);
    if(context.membership.role==='manager'&&!lead.leadAssignee)fail('REQUIREMENT_LEAD_NOT_FOUND',404);
    if(context.membership.role==='manager'&&lead.leadAssignee){const [[inScope]]=await db.query('SELECT 1 AS allowed FROM sx_sales_org_history WHERE tenant_id=? AND membership_id=? AND manager_membership_id=? AND ended_at IS NULL LIMIT 1',[context.tenant.id,lead.leadAssignee,context.membership.id]);if(!inScope)fail('REQUIREMENT_LEAD_NOT_FOUND',404);}
    data.assignedMembershipId=await validateAssignee(db,context,hasAssignee?data.assignedMembershipId:lead.leadAssignee??null);
    const id=uuid();
    await db.query(`INSERT INTO sx_real_estate_requirements(id,tenant_id,legacy_uid_hash,lead_id,transaction_type,property_type,min_price_minor,max_price_minor,currency,min_area_sqm,max_area_sqm,min_bedrooms,preferred_city,assigned_membership_id,created_by_identity_id,updated_by_identity_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,context.tenant.id,context.legacyUidHash,lead.id,data.transactionType,data.propertyType,data.minPriceMinor,data.maxPriceMinor,data.currency,data.minAreaSqm,data.maxAreaSqm,data.minBedrooms,data.preferredCity,data.assignedMembershipId,context.identity.id,context.identity.id]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','real-estate.requirement-created','real-estate-requirement',?,?,?)`,[uuid(),context.tenant.id,context.identity.id,id,JSON.stringify({leadId:lead.id,assignedMembershipId:data.assignedMembershipId}),uuid()]);
    await db.commit();return {id,...data,status:'open',revision:1};
  }catch(error){await db.rollback();throw error;}
}
async function update(db,context,id,input){
  const access=authorize(context,'requirements.manage');if(!/^[a-f0-9]{64}$/i.test(context.legacyUidHash||''))fail('VERIFIED_BUSINESS_OWNER_REQUIRED',403);if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isSafeInteger(input?.expectedRevision)||input.expectedRevision<1)fail('INVALID_REQUIREMENT_UPDATE');
  if(Object.hasOwn(input||{},'assignedMembershipId'))authorize(context,'requirements.assign');
  const patch=clean(input,{partial:true});await db.beginTransaction();
  try{
    const scoped=scopeSql(context,access.scope),leadScope=leadScopeSql(context);
    const [[row]]=await db.query(`SELECT r.status,r.revision FROM sx_real_estate_requirements r JOIN pipeline_leads l ON l.uid_hash=r.legacy_uid_hash AND l.id=r.lead_id WHERE r.tenant_id=? AND r.legacy_uid_hash=? AND r.id=?${scoped.sql}${leadScope.sql} FOR UPDATE`,[context.tenant.id,context.legacyUidHash,id,...scoped.args,...leadScope.args]);
    if(!row)fail('REQUIREMENT_NOT_FOUND',404);if(Number(row.revision)!==input.expectedRevision)fail('STALE_REVISION',409);
    if(row.status==='closed'&&patch.status&&patch.status!=='closed')fail('INVALID_REQUIREMENT_TRANSITION',409);
    if(Object.hasOwn(patch,'assignedMembershipId'))patch.assignedMembershipId=await validateAssignee(db,context,patch.assignedMembershipId);
    const columns={status:'status',assignedMembershipId:'assigned_membership_id'},keys=Object.keys(patch);
    await db.query(`UPDATE sx_real_estate_requirements SET ${keys.map(key=>`${columns[key]}=?`).join(',')},revision=revision+1,updated_by_identity_id=? WHERE tenant_id=? AND legacy_uid_hash=? AND id=?`,[...keys.map(key=>patch[key]),context.identity.id,context.tenant.id,context.legacyUidHash,id]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','real-estate.requirement-updated','real-estate-requirement',?,?,?)`,[uuid(),context.tenant.id,context.identity.id,id,JSON.stringify({fields:keys,revision:input.expectedRevision+1}),uuid()]);
    await db.commit();return {id,...patch,revision:input.expectedRevision+1};
  }catch(error){await db.rollback();throw error;}
}
async function matches(db,context,id){
  const access=authorize(context,'requirements.read');const listingAccess=decision(context,{capability:'realestate.listings',permission:'properties.read'});if(!listingAccess.allowed)fail(listingAccess.code,403);
  if(!/^[a-f0-9]{64}$/i.test(context.legacyUidHash||''))fail('VERIFIED_BUSINESS_OWNER_REQUIRED',403);
  const rscope=scopeSql(context,access.scope),pscope=scopeSql(context,['manager','team_leader'].includes(context.membership.role)?'team':listingAccess.scope,'p'),leadScope=leadScopeSql(context);
  const [[requirement]]=await db.query(`SELECT r.* FROM sx_real_estate_requirements r JOIN pipeline_leads l ON l.uid_hash=r.legacy_uid_hash AND l.id=r.lead_id WHERE r.tenant_id=? AND r.legacy_uid_hash=? AND r.id=?${rscope.sql}${leadScope.sql} LIMIT 1`,[context.tenant.id,context.legacyUidHash,id,...rscope.args,...leadScope.args]);
  if(!requirement)fail('REQUIREMENT_NOT_FOUND',404);
  const where=['p.tenant_id=?','p.status IN (\'active\',\'under_offer\')','r.status IN (\'open\',\'matched\')','p.transaction_type=r.transaction_type','p.currency=r.currency','(r.property_type=\'any\' OR p.property_type=r.property_type)','(r.min_price_minor IS NULL OR p.price_minor>=r.min_price_minor)','(r.max_price_minor IS NULL OR p.price_minor<=r.max_price_minor)','(r.min_area_sqm IS NULL OR p.area_sqm>=r.min_area_sqm)','(r.max_area_sqm IS NULL OR p.area_sqm<=r.max_area_sqm)','(r.min_bedrooms IS NULL OR p.bedrooms>=r.min_bedrooms)','(r.preferred_city IS NULL OR p.city=r.preferred_city)'];
  const [rows]=await db.query(`SELECT p.id,p.reference_code AS referenceCode,p.title_en AS titleEn,p.title_ar AS titleAr,p.property_type AS propertyType,p.transaction_type AS transactionType,p.price_minor AS priceMinor,p.currency,p.area_sqm AS areaSqm,p.bedrooms,p.city,p.assigned_membership_id AS assignedMembershipId FROM sx_real_estate_properties p JOIN sx_real_estate_requirements r ON r.tenant_id=p.tenant_id WHERE ${where.join(' AND ')}${pscope.sql} AND r.tenant_id=? AND r.legacy_uid_hash=? AND r.id=? ORDER BY p.price_minor,p.id LIMIT 50`,[context.tenant.id,...pscope.args,context.tenant.id,context.legacyUidHash,id]);
  return {items:rows,limit:50};
}
module.exports={TYPES,authorize,clean,scopeSql,leadScopeSql,leadOptions,listAssignees,list,create,update,matches};
