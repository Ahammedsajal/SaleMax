'use strict';

const crypto=require('node:crypto');
const categories=require('./categories');
const plans=require('./plans');
const properties=require('./real-estate-properties');
const {decision}=require('./policy');
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const uuid=()=>crypto.randomUUID();
const sha=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const CONSENT_TEXT='I agree that this business may contact me about this property viewing request.';
const CONSENT_TEXT_AR='أوافق على أن تتواصل معي المؤسسة بشأن طلب معاينة هذا العقار.';
const STATUSES=new Set(['requested','contacted','declined','cancelled']);
const qatarToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

function normalize(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_VIEWING_REQUEST');
  const allowed=new Set(['contactName','phone','email','preferredDate','message','consent','submissionToken']);
  if(Object.keys(input).some(key=>!allowed.has(key)))fail('INVALID_VIEWING_REQUEST');
  const contactName=typeof input.contactName==='string'?input.contactName.trim():'';
  const phone=typeof input.phone==='string'?input.phone.trim().replace(/[\s()-]/g,''):'';
  const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
  const preferredDate=input.preferredDate==null||input.preferredDate===''?null:input.preferredDate;
  const message=typeof input.message==='string'?input.message.trim():'';
  if(!contactName||contactName.length>120)fail('INVALID_VIEWING_CONTACT');
  if(phone&&!/^\+[1-9]\d{7,14}$/.test(phone))fail('INVALID_VIEWING_PHONE');
  if(email&&(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))fail('INVALID_VIEWING_EMAIL');
  if(!phone&&!email)fail('VIEWING_CONTACT_REQUIRED');
  if(preferredDate!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)||Number.isNaN(Date.parse(`${preferredDate}T00:00:00Z`))||new Date(`${preferredDate}T00:00:00Z`).toISOString().slice(0,10)!==preferredDate))fail('INVALID_VIEWING_DATE');
  if(preferredDate!==null&&preferredDate<qatarToday())fail('VIEWING_DATE_IN_PAST');
  if(message.length>1000)fail('INVALID_VIEWING_MESSAGE');
  if(input.consent!==true)fail('VIEWING_CONSENT_REQUIRED');
  if(typeof input.submissionToken!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(input.submissionToken))fail('INVALID_VIEWING_REQUEST');
  return {contactName,phone,email,preferredDate,message,submissionToken:input.submissionToken};
}

function publicCategory(tenant){
  const category=categories.getCategory(tenant.categoryKey,Number(tenant.categoryVersion));
  if(!category||!category.public||category.key!=='real_estate'||!category.capabilities.includes('realestate.listings'))fail('CATEGORY_UNAVAILABLE',404);
  return category;
}

async function publicProperty(db,tenantSlug,propertyId){
  if(typeof tenantSlug!=='string'||!/^[-a-z0-9]{1,80}$/.test(tenantSlug)||typeof propertyId!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(propertyId))fail('PROPERTY_NOT_AVAILABLE',404);
  const [[tenant]]=await db.query(`SELECT t.id AS tenantId,t.slug,t.name,t.status,t.category_key AS categoryKey,t.category_version AS categoryVersion,s.published_revision AS storefrontRevision,s.published_json AS publishedContent
    FROM sx_tenants t JOIN sx_tenant_storefronts s ON s.tenant_id=t.id AND s.published_revision>0
    WHERE t.slug=? AND t.status='active' AND EXISTS(SELECT 1 FROM sx_tenant_crm_domains d WHERE d.tenant_id=t.id AND d.status='active' AND d.dns_health_status='healthy' AND d.tls_ready_at IS NOT NULL)
    LIMIT 1`,[tenantSlug.toLowerCase()]);
  if(!tenant)return null;publicCategory(tenant);
  const published=typeof tenant.publishedContent==='string'?JSON.parse(tenant.publishedContent):tenant.publishedContent;
  if(published?.showPropertyCatalog!==true)return null;
  const entitlement=await plans.loadEntitlements(db,tenant.tenantId);
  if(!entitlement||!['active','trial','grace'].includes(entitlement.status)||entitlement.categoryKey!=='real_estate'||!entitlement.capabilities.includes('realestate.listings'))return null;
  const [[property]]=await db.query(`SELECT p.id,p.reference_code AS referenceCode,p.title_en AS titleEn,p.title_ar AS titleAr,p.property_type AS propertyType,p.transaction_type AS transactionType,p.price_minor AS priceMinor,p.currency,p.area_sqm AS areaSqm,p.bedrooms,p.bathrooms,p.city,IF(b.public_enabled=1,b.name_en,NULL) AS branchNameEn,IF(b.public_enabled=1,b.name_ar,NULL) AS branchNameAr,IF(b.public_enabled=1,b.address_en,NULL) AS branchAddressEn,IF(b.public_enabled=1,b.address_ar,NULL) AS branchAddressAr,p.description_en AS descriptionEn,p.description_ar AS descriptionAr
    FROM sx_real_estate_properties p LEFT JOIN sx_tenant_branches b ON b.tenant_id=p.tenant_id AND b.id=p.branch_id AND b.status='active'
    WHERE p.tenant_id=? AND p.id=? AND p.status='active' AND (p.branch_id IS NULL OR b.id IS NOT NULL) LIMIT 1`,[tenant.tenantId,propertyId.toLowerCase()]);
  if(!property)return null;
  return {tenant:{name:tenant.name,slug:tenant.slug},property:{...property,priceMinor:Number(property.priceMinor),areaSqm:property.areaSqm==null?null:Number(property.areaSqm)},bookingMode:'request_only'};
}

async function submitPublic(pool,{tenantSlug,propertyId,input,visitorHash}){
  if(typeof tenantSlug!=='string'||!/^[-a-z0-9]{1,80}$/.test(tenantSlug)||typeof propertyId!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(propertyId)||typeof visitorHash!=='string'||!/^[0-9a-f]{64}$/i.test(visitorHash))fail('INVALID_VIEWING_REQUEST');
  propertyId=propertyId.toLowerCase();tenantSlug=tenantSlug.toLowerCase();
  const data=normalize(input),idempotencyHash=sha(data.submissionToken),db=await pool.getConnection();let begun=false;
  try{
    await db.beginTransaction();begun=true;
    const [[tenant]]=await db.query(`SELECT t.id AS tenantId,t.slug,t.name,t.status,t.category_key AS categoryKey,t.category_version AS categoryVersion,s.published_json AS publishedContent,
      u.uid,own.legacy_uid_hash AS ownerUidHash
      FROM sx_tenants t JOIN sx_tenant_storefronts s ON s.tenant_id=t.id AND s.published_revision>0
      JOIN sx_legacy_ownership own ON own.tenant_id=t.id AND own.source_table='user'
      JOIN sx_memberships m ON m.tenant_id=t.id AND m.id=own.membership_id AND m.role='owner' AND m.status='active'
      JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
      JOIN user u ON CAST(u.id AS CHAR)=own.source_id
      WHERE t.slug=? AND t.status='active' LIMIT 1 FOR UPDATE`,[tenantSlug]);
    if(!tenant)fail('TENANT_NOT_FOUND',404);
    publicCategory(tenant);
    const published=typeof tenant.publishedContent==='string'?JSON.parse(tenant.publishedContent):tenant.publishedContent;
    if(published?.showPropertyCatalog!==true)fail('FEATURE_UNAVAILABLE',404);
    if(!tenant.ownerUidHash||sha(tenant.uid)!==tenant.ownerUidHash)fail('BUSINESS_LINK_INVALID',409);
    const entitlement=await plans.loadEntitlements(db,tenant.tenantId);
    if(!entitlement||!['active','trial','grace'].includes(entitlement.status)||entitlement.categoryKey!=='real_estate'||!entitlement.capabilities.includes('realestate.listings'))fail('FEATURE_UNAVAILABLE',404);
    const [[prior]]=await db.query('SELECT property_id AS propertyId,reference_code AS referenceCode FROM sx_real_estate_viewing_requests WHERE tenant_id=? AND idempotency_hash=? LIMIT 1 FOR UPDATE',[tenant.tenantId,idempotencyHash]);
    if(prior){if(prior.propertyId!==propertyId)fail('IDEMPOTENCY_CONFLICT',409);await db.commit();begun=false;return {referenceCode:prior.referenceCode,repeated:true,status:'requested',bookingMode:'request_only'};}
    const [[property]]=await db.query(`SELECT p.id,p.reference_code AS referenceCode,p.title_en AS titleEn,p.status,p.assigned_membership_id AS assignedMembershipId,p.branch_id AS branchId
      FROM sx_real_estate_properties p WHERE p.tenant_id=? AND p.id=? FOR UPDATE`,[tenant.tenantId,propertyId]);
    if(!property||property.status!=='active')fail('PROPERTY_NOT_AVAILABLE',404);
    if(property.branchId){const [[branch]]=await db.query("SELECT routing_membership_id AS routingMembershipId FROM sx_tenant_branches WHERE tenant_id=? AND id=? AND status='active' FOR UPDATE",[tenant.tenantId,property.branchId]);if(!branch)fail('PROPERTY_NOT_AVAILABLE',404);property.branchRoutingMembershipId=branch.routingMembershipId;}
    const [[rate]]=await db.query(`SELECT COUNT(*) AS total FROM sx_real_estate_viewing_requests
      WHERE tenant_id=? AND visitor_hash=? AND created_at>=TIMESTAMPADD(HOUR,-1,UTC_TIMESTAMP(3))`,[tenant.tenantId,visitorHash]);
    if(Number(rate.total)>=5)fail('VIEWING_RATE_LIMITED',429);
    let ownerAgentId;
    const routedMembershipId=property.assignedMembershipId||property.branchRoutingMembershipId;
    let assignedMembershipId=null;
    if(routedMembershipId){const [[route]]=await db.query("SELECT id FROM sx_memberships WHERE tenant_id=? AND id=? AND role IN ('manager','agent') AND status='active' LIMIT 1 FOR UPDATE",[tenant.tenantId,routedMembershipId]);if(route)assignedMembershipId=route.id;}
    if(assignedMembershipId){const [[agent]]=await db.query(`SELECT a.id FROM sx_legacy_ownership o
      JOIN agents a ON o.source_table='agents' AND CAST(a.id AS CHAR)=o.source_id AND o.tenant_id=?
        AND o.membership_id=? AND o.legacy_uid_hash=SHA2(a.uid,256)
      WHERE a.owner_uid=? AND a.role='agent' AND a.is_active=1 LIMIT 1`,[tenant.tenantId,assignedMembershipId,tenant.uid]);if(agent)ownerAgentId=Number(agent.id);}
    const requestId=uuid(),referenceCode=`VR-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const lead=await require('../../helper/pipeline/leadPipeline').createManualLead({uid:tenant.uid,actorType:'system',actorId:null,role:'owner',connection:db,input:{title:`Viewing request · ${property.referenceCode}`,contactName:data.contactName,learnerName:data.contactName,mobile:data.phone,email:data.email,sourceType:'public_form',...(ownerAgentId?{ownerAgentId}:{})}});
    await db.query(`INSERT INTO sx_real_estate_viewing_requests
      (id,tenant_id,property_id,lead_id,assigned_membership_id,reference_code,contact_name,phone,email,preferred_date,message,consent_text_en,consent_text_ar,consented_at,idempotency_hash,visitor_hash)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),?,?)`,[requestId,tenant.tenantId,propertyId,lead.id,assignedMembershipId,referenceCode,data.contactName,data.phone,data.email,data.preferredDate,data.message,CONSENT_TEXT,CONSENT_TEXT_AR,idempotencyHash,visitorHash]);
    await db.commit();begun=false;return {referenceCode,repeated:false,status:'requested',bookingMode:'request_only'};
  }catch(error){if(begun)try{await db.rollback();}catch{}if(error.code==='ER_DUP_ENTRY')fail('VIEWING_REQUEST_CONFLICT',409);throw error;}finally{db.release();}
}

function assertStaff(ctx,permission){properties.authorize(ctx,permission);return ctx;}
function requestScope(ctx){return decision(ctx,{capability:'realestate.listings',permission:'properties.read'}).scope;}
async function list(db,ctx,{status='all',limit=50}={}){
  assertStaff(ctx,'properties.read');if(status!=='all'&&!STATUSES.has(status))fail('INVALID_VIEWING_STATUS');
  const count=Math.min(100,Math.max(1,Number.parseInt(limit,10)||50)),where=['r.tenant_id=?'],params=[ctx.tenant.id],scope=requestScope(ctx);
  const routed='COALESCE(r.assigned_membership_id,p.assigned_membership_id,b.routing_membership_id)';
  if(scope==='assigned'){where.push(`${routed}=?`);params.push(ctx.membership.id);}
  else if(scope==='team'){where.push(`(${routed}=? OR EXISTS(SELECT 1 FROM sx_sales_org_history org WHERE org.tenant_id=p.tenant_id AND org.membership_id=${routed} AND org.team_leader_membership_id=? AND org.ended_at IS NULL))`);params.push(ctx.membership.id,ctx.membership.id);}
  if(status!=='all'){where.push('r.status=?');params.push(status);}
  const [rows]=await db.query(`SELECT r.id,r.reference_code AS referenceCode,r.property_id AS propertyId,p.reference_code AS propertyReferenceCode,p.title_en AS propertyTitleEn,p.title_ar AS propertyTitleAr,b.name_en AS branchNameEn,b.name_ar AS branchNameAr,r.lead_id AS leadId,r.assigned_membership_id AS assignedMembershipId,assignee.display_name AS assignedName,r.contact_name AS contactName,r.phone,r.email,DATE_FORMAT(r.preferred_date,'%Y-%m-%d') AS preferredDate,r.message,r.status,r.revision,r.created_at AS createdAt
    FROM sx_real_estate_viewing_requests r JOIN sx_real_estate_properties p ON p.tenant_id=r.tenant_id AND p.id=r.property_id LEFT JOIN sx_tenant_branches b ON b.tenant_id=p.tenant_id AND b.id=p.branch_id LEFT JOIN sx_memberships assigned ON assigned.tenant_id=r.tenant_id AND assigned.id=r.assigned_membership_id LEFT JOIN sx_identities assignee ON assignee.id=assigned.identity_id
    WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC,r.id LIMIT ?`,[...params,count]);return rows;
}
async function updateStatus(db,ctx,id,input){
  assertStaff(ctx,'properties.requests.manage');
  if(typeof id!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(id)||!input||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||!['contacted','declined','cancelled'].includes(input.status))fail('INVALID_VIEWING_UPDATE');
  if(Object.keys(input).some(key=>!['status','expectedRevision'].includes(key)))fail('INVALID_VIEWING_UPDATE');
  await db.beginTransaction();try{
    const [[current]]=await db.query(`SELECT r.status,r.revision,r.assigned_membership_id AS requestAssignedMembershipId,p.assigned_membership_id AS assignedMembershipId,p.branch_id AS branchId FROM sx_real_estate_viewing_requests r JOIN sx_real_estate_properties p ON p.tenant_id=r.tenant_id AND p.id=r.property_id WHERE r.tenant_id=? AND r.id=? FOR UPDATE`,[ctx.tenant.id,id]);
    if(!current)fail('VIEWING_REQUEST_NOT_FOUND',404);if(Number(current.revision)!==input.expectedRevision)fail('STALE_REVISION',409);
    let branchRoute=null;if(current.branchId){const [[branch]]=await db.query("SELECT routing_membership_id AS routingMembershipId FROM sx_tenant_branches WHERE tenant_id=? AND id=? AND status='active' LIMIT 1",[ctx.tenant.id,current.branchId]);branchRoute=branch?.routingMembershipId||null;}
    const routedMembershipId=current.requestAssignedMembershipId||current.assignedMembershipId||branchRoute;
    const scope=requestScope(ctx);if(scope==='assigned'&&routedMembershipId!==ctx.membership.id)fail('VIEWING_REQUEST_NOT_FOUND',404);
    if(scope==='team'&&routedMembershipId!==ctx.membership.id){const [[member]]=await db.query('SELECT id FROM sx_sales_org_history WHERE tenant_id=? AND membership_id=? AND team_leader_membership_id=? AND ended_at IS NULL LIMIT 1',[ctx.tenant.id,routedMembershipId,ctx.membership.id]);if(!member)fail('VIEWING_REQUEST_NOT_FOUND',404);}
    const allowed={requested:['contacted','declined','cancelled'],contacted:['declined','cancelled'],declined:[],cancelled:[]};if(!allowed[current.status]?.includes(input.status))fail('INVALID_VIEWING_TRANSITION',409);
    const revision=input.expectedRevision+1;await db.query('UPDATE sx_real_estate_viewing_requests SET status=?,revision=?,reviewed_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?',[input.status,revision,ctx.identity.id,ctx.tenant.id,id]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','real-estate.viewing-request-updated','real-estate-viewing-request',?,?,?)`,[uuid(),ctx.tenant.id,ctx.identity.id,id,JSON.stringify({from:current.status,to:input.status,revision}),uuid()]);
    await db.commit();return {id,status:input.status,revision,bookingMode:'request_only'};
  }catch(error){await db.rollback();throw error;}
}

module.exports={STATUSES,CONSENT_TEXT,CONSENT_TEXT_AR,normalize,publicProperty,submitPublic,list,updateStatus};
