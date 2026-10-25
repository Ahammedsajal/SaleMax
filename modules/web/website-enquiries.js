"use strict";
const crypto = require("node:crypto");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const fail = (code, status = 400) => {
  throw Object.assign(new Error(code), { code, status });
};
const solutions = new Set([
  "crm",
  "automation",
  "messaging",
  "campaigns",
  "training",
  "finance",
  "custom",
  "other",
]);
function clean(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("INVALID_ENQUIRY");
  const text = (key, max, required = true) => {
    const value = input[key];
    if (value === undefined && !required) return "";
    if (
      typeof value !== "string" ||
      value.length > max ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value) ||
      (required && !value.trim())
    )
      fail("INVALID_" + key.toUpperCase());
    return value.trim();
  };
  const name = text("name", 120),
    email = text("email", 254).toLowerCase(),
    mobile = text("mobile", 40);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("INVALID_EMAIL");
  // Website requests require a country code; legacy contact forms retain local-number support.
  if (
    !/^\+?[\d ()-]{7,40}$/.test(mobile) ||
    mobile.replace(/\D/g, "").length < 7 ||
    mobile.replace(/\D/g, "").length > 15
  )
    fail("INVALID_MOBILE");
  const solution = text("solution", 30, false) || "other";
  if (!solutions.has(solution)) fail("INVALID_SOLUTION");
  if (input.consent !== undefined && input.consent !== true)
    fail("CONSENT_REQUIRED");
  const token =
    input.submissionToken === undefined
      ? crypto.randomUUID()
      : input.submissionToken;
  if (
    typeof token !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      token,
    )
  )
    fail("INVALID_SUBMISSION_TOKEN");
  return {
    name,
    email,
    mobile: "+" + mobile.replace(/\D/g, ""),
    company: text("company", 160, false),
    solution,
    content: text("content", 2000),
    token: token.toLowerCase(),
    language: input.language === "ar" ? "ar" : "en",
  };
}
async function submitOnce(
  pool,
  input,
  visitorHash,
  {
    createLead = require("../../helper/pipeline/leadPipeline").createManualLead,
  } = {},
) {
  const data = clean(input),
    payloadHash = hash(JSON.stringify({ ...data, token: undefined }));
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    // The unique request row serializes simultaneous retries before either business record is created.
    await db.query(
      "INSERT INTO sx_website_enquiries(submission_token,payload_hash) VALUES (?,?) ON DUPLICATE KEY UPDATE submission_token=VALUES(submission_token)",
      [data.token, payloadHash],
    );
    const [[request]] = await db.query(
      "SELECT payload_hash,lead_id FROM sx_website_enquiries WHERE submission_token=? FOR UPDATE",
      [data.token],
    );
    if (request.payload_hash !== payloadHash) fail("SUBMISSION_CHANGED", 409);
    if (request.lead_id) {
      await db.commit();
      return { reference: data.token, repeated: true };
    }
    const window = Math.floor(Date.now() / 3600000);
    await db.query(
      "INSERT INTO sx_website_rate_limits(visitor_hash,window_start,requests) VALUES (?,?,1) ON DUPLICATE KEY UPDATE requests=requests+1",
      [visitorHash, window],
    );
    const [[rate]] = await db.query(
      "SELECT requests FROM sx_website_rate_limits WHERE visitor_hash=? AND window_start=? FOR UPDATE",
      [visitorHash, window],
    );
    if (rate.requests > 8) fail("ENQUIRY_RATE_LIMITED", 429);
    // Resolve only the explicitly designated first-party tenant, never a client-supplied tenant/owner.
    const [owners] = await db.query(
      `SELECT t.id AS tenant_id,u.uid,o.legacy_uid_hash
      FROM sx_tenants t JOIN sx_legacy_ownership o ON o.tenant_id=t.id AND o.source_table='user'
      JOIN user u ON CONVERT(CAST(u.id AS CHAR) USING utf8mb4) COLLATE utf8mb4_bin=CONVERT(o.source_id USING utf8mb4) COLLATE utf8mb4_bin JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=t.id
      JOIN sx_identities i ON i.id=m.identity_id
      WHERE t.category_key='7network_sales' AND t.status='active' AND m.role='owner' AND m.status='active' AND i.status='active'
      AND t.slug=? LIMIT 2 FOR UPDATE`,
      [
        process.env.SALEMAX_WEBSITE_SALES_TENANT_SLUG ||
          "salemax-sales-86c35173",
      ],
    );
    if (
      owners.length !== 1 ||
      owners[0].legacy_uid_hash !== hash(owners[0].uid)
    )
      fail("SALES_ROUTING_UNAVAILABLE", 503);
    const owner = owners[0];
    const summary = [
      `Website enquiry · ${data.solution}`,
      data.company && `Company: ${data.company}`,
      `Language: ${data.language}`,
      data.content,
    ]
      .filter(Boolean)
      .join("\n");
    const [contact] = await db.query(
      "INSERT INTO contact_form(email,name,mobile,content) VALUES (?,?,?,?)",
      [data.email, data.name, data.mobile, summary],
    );
    const lead = await createLead({
      uid: owner.uid,
      actorType: "system",
      role: "owner",
      connection: db,
      input: {
        title: `${data.company || data.name} · ${data.solution}`,
        contactName: data.name,
        mobile: data.mobile,
        email: data.email,
        sourceType: "public_form",
        qualificationData: {
          source: "website",
          referralSource: "7Network website",
          preferredContactMethod: "email",
        },
      },
    });
    await db.query(
      `INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,activity_type,summary,details,created_at)
      VALUES (?,?,'system','note_added',?,?,UTC_TIMESTAMP(3))`,
      [
        hash(owner.uid),
        lead.id,
        summary.slice(0, 500),
        JSON.stringify({
          source: "salemax_website",
          request: data.token,
          company: data.company,
          solution: data.solution,
          content: data.content,
          language: data.language,
        }),
      ],
    );
    await db.query(
      "UPDATE sx_website_enquiries SET contact_form_id=?,tenant_id=?,lead_id=? WHERE submission_token=?",
      [contact.insertId, owner.tenant_id, lead.id, data.token],
    );
    // Keep anonymous rate buckets bounded without removing enquiry/audit history.
    await db.query(
      "DELETE FROM sx_website_rate_limits WHERE window_start<? LIMIT 100",
      [window - 48],
    );
    await db.commit();
    return { reference: data.token, repeated: false };
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
}
async function submit(pool, input, visitorHash, options) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await submitOnce(pool, input, visitorHash, options);
    } catch (error) {
      if (
        !["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code) ||
        attempt === 2
      )
        throw error;
    }
  }
}

function cleanTenant(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_ENQUIRY');
  const allowed=new Set(['name','email','mobile','content','intent','service','event','branchSlug','serviceArea','serviceAddress','preferredDate','preferredTime','consent','submissionToken','website']);
  if(Object.keys(input).some(key=>!allowed.has(key)))fail('INVALID_ENQUIRY');
  const name=typeof input.name==='string'?input.name.trim():'';
  const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
  const mobile=typeof input.mobile==='string'?input.mobile.trim().replace(/[\s()-]/g,''):'';
  const content=typeof input.content==='string'?input.content.trim():'';
  const intent=input.intent||'consultation';
  const service=typeof input.service==='string'?input.service.trim():'';
  const event=typeof input.event==='string'?input.event.trim():'';
  const branchSlug=typeof input.branchSlug==='string'?input.branchSlug.trim().toLowerCase():'';
  const serviceArea=typeof input.serviceArea==='string'?input.serviceArea.trim():'';
  const serviceAddress=typeof input.serviceAddress==='string'?input.serviceAddress.trim():'';
  const preferredDate=typeof input.preferredDate==='string'?input.preferredDate.trim():'';
  const preferredTime=typeof input.preferredTime==='string'?input.preferredTime.trim():'';
  if(input.preferredDate!==undefined&&typeof input.preferredDate!=='string')fail('INVALID_PREFERRED_DATE');
  if(input.preferredTime!==undefined&&typeof input.preferredTime!=='string')fail('INVALID_PREFERRED_TIME');
  if(input.serviceArea!==undefined&&typeof input.serviceArea!=='string')fail('INVALID_SERVICE_AREA');
  if(input.serviceAddress!==undefined&&typeof input.serviceAddress!=='string')fail('INVALID_SERVICE_ADDRESS');
  if(input.website!==undefined&&(typeof input.website!=='string'||input.website.length>200||input.website.trim()))fail('INVALID_ENQUIRY');
  if(!name||name.length>120||/[\u0000-\u001f\u007f]/u.test(name))fail('INVALID_NAME');
  if(email&&(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))fail('INVALID_EMAIL');
  if(mobile&&!/^\+[1-9]\d{7,14}$/.test(mobile))fail('INVALID_MOBILE');
  if(!email&&!mobile)fail('CONTACT_REQUIRED');
  if(!content||content.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(content))fail('INVALID_CONTENT');
  if(service.length>200||/[\u0000-\u001f\u007f]/u.test(service))fail('INVALID_SERVICE');
  if(event.length>200||/[\u0000-\u001f\u007f]/u.test(event))fail('INVALID_EVENT');
  if(serviceArea.length>100||/[\u0000-\u001f\u007f]/u.test(serviceArea))fail('INVALID_SERVICE_AREA');
  if(serviceAddress.length>500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(serviceAddress))fail('INVALID_SERVICE_ADDRESS');
  if(branchSlug&&!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(branchSlug))fail('INVALID_BRANCH');
  if(!['consultation','quotation','booking_request','visit_request','trial_request','availability_request','event_registration_request'].includes(intent))fail('INVALID_INTENT');
  if(preferredDate&&!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate))fail('INVALID_PREFERRED_DATE');
  if(preferredDate){const parsed=new Date(`${preferredDate}T00:00:00.000Z`);if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==preferredDate)fail('INVALID_PREFERRED_DATE');}
  if(preferredTime&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(preferredTime))fail('INVALID_PREFERRED_TIME');
  if(input.consent!==true&&input.consent!=='on')fail('CONSENT_REQUIRED');
  const token=input.submissionToken;
  if(typeof token!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(token))fail('INVALID_SUBMISSION_TOKEN');
  return {name,email,mobile,content,intent,...(service?{service}:{}),...(event?{event}:{}),...(branchSlug?{branchSlug}:{}),...(serviceArea?{serviceArea}:{}),...(serviceAddress?{serviceAddress}:{}),...(preferredDate?{preferredDate}:{}),...(preferredTime?{preferredTime}:{}),consent:true,token:token.toLowerCase()};
}

async function submitTenantOnce(pool,input,visitorHash,domain,{loadBrand,loadEntitlements,createLead}={}){
  if(!domain||typeof domain.tenantId!=='string'||typeof domain.hostname!=='string'||typeof visitorHash!=='string'||!/^[0-9a-f]{64}$/i.test(visitorHash))fail('INVALID_ENQUIRY');
  const data=cleanTenant(input),payloadHash=hash(JSON.stringify({tenantId:domain.tenantId,...data,token:undefined})),db=await pool.getConnection();
  try{
    await db.beginTransaction();
    const brand=await (loadBrand||require('../platform/tenant-crm-domains').publicBrand)(db,domain.hostname);
    if(!brand||brand.tenantId!==domain.tenantId||brand.revision==null)fail('STOREFRONT_NOT_AVAILABLE',404);
    const category=require('../platform/categories').getCategory(brand.categoryKey,Number(brand.categoryVersion));
    if(!category||!category.public||!category.capabilities.includes('crm.leads'))fail('CATEGORY_UNAVAILABLE',404);
    const entitlement=await (loadEntitlements||require('../platform/plans').loadEntitlements)(db,brand.tenantId);
    if(!entitlement||!['active','trial','grace'].includes(entitlement.status)||entitlement.categoryKey!==category.key||!entitlement.capabilities.includes('crm.leads'))fail('FEATURE_UNAVAILABLE',404);
    if(data.event&&category.key!=='events_venues')fail('EVENT_UNAVAILABLE',409);
    if(['professional_services','salon_spa','home_services','fitness_coaching','events_venues'].includes(category.key)){
      const serviceCatalog=require('../platform/storefront-services').publicServices(brand.content);
      if(serviceCatalog.length&&!data.service)fail('SERVICE_REQUIRED');
      if(data.service&&!serviceCatalog.some(item=>item.value===data.service))fail('SERVICE_UNAVAILABLE',409);
    }else if(data.service)fail('SERVICE_UNAVAILABLE',409);
    if(category.key==='salon_spa'){
      if(data.intent!=='booking_request')fail('INVALID_INTENT');
      if(data.preferredDate){const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());if(data.preferredDate<today)fail('INVALID_PREFERRED_DATE');}
    }else if(category.key==='home_services'){
      if(!['quotation','visit_request'].includes(data.intent))fail('INVALID_INTENT');
      if(!data.serviceArea||!data.serviceAddress)fail('SERVICE_LOCATION_REQUIRED');
      if(data.preferredDate){const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());if(data.preferredDate<today)fail('INVALID_PREFERRED_DATE');}
    }else if(category.key==='fitness_coaching'){
      if(!['trial_request','consultation'].includes(data.intent))fail('INVALID_INTENT');
      if(data.intent!=='trial_request'&&(data.preferredDate||data.preferredTime))fail('INVALID_INTENT');
      if(data.preferredTime&&!data.preferredDate)fail('PREFERRED_DATE_REQUIRED');
      if(data.preferredDate){const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());if(data.preferredDate<today)fail('INVALID_PREFERRED_DATE');}
    }else if(category.key==='events_venues'){
      if(!['availability_request','event_registration_request','quotation'].includes(data.intent))fail('INVALID_INTENT');
      if(data.intent==='quotation'&&(data.preferredDate||data.preferredTime))fail('INVALID_INTENT');
      if(data.preferredTime&&!data.preferredDate)fail('PREFERRED_DATE_REQUIRED');
      if(data.preferredDate){const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());if(data.preferredDate<today)fail('INVALID_PREFERRED_DATE');}
    }else if(!['consultation','quotation'].includes(data.intent)||data.preferredDate||data.preferredTime||data.serviceArea||data.serviceAddress||data.event)fail('INVALID_INTENT');
    let selectedEvent=null;
    if(data.event){
      if(category.key!=='events_venues')fail('EVENT_UNAVAILABLE',409);
      const sections=Array.isArray(brand.content?.sections)?brand.content.sections:[];
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      selectedEvent=sections.filter(section=>section?.type==='events').flatMap(section=>Array.isArray(section.items)?section.items:[]).find(item=>[item?.title,item?.titleAr].includes(data.event)&&(!item?.expiresOn||item.expiresOn>=today));
      if(!selectedEvent)fail('EVENT_UNAVAILABLE',409);
    }
    const branch=data.branchSlug?await require('../platform/tenant-storefront-branches').resolvePublicBranch(db,brand.tenantId,data.branchSlug):null;
    if(data.branchSlug&&!branch)fail('BRANCH_UNAVAILABLE',409);
    if(data.branchSlug&&!['professional_services','salon_spa','home_services','fitness_coaching','events_venues'].includes(category.key))fail('BRANCH_UNAVAILABLE',409);
    if(category.key==='home_services'&&(!branch||!branch.fulfillmentModes.some(mode=>['onsite','in_person'].includes(mode))||!branch.serviceAreas.some(area=>area.toLocaleLowerCase('en').trim()===data.serviceArea.toLocaleLowerCase('en').trim())))fail('SERVICE_AREA_UNAVAILABLE',409);
    const [owners]=await db.query(`SELECT t.id AS tenantId,u.uid,own.legacy_uid_hash AS uidHash
      FROM sx_tenants t JOIN sx_legacy_ownership own ON own.tenant_id=t.id AND own.source_table='user'
      JOIN sx_memberships m ON m.tenant_id=t.id AND m.id=own.membership_id AND m.role='owner' AND m.status='active'
      JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
      JOIN user u ON CONVERT(CAST(u.id AS CHAR) USING utf8mb4) COLLATE utf8mb4_bin=CONVERT(own.source_id USING utf8mb4) COLLATE utf8mb4_bin
      JOIN sx_tenant_crm_domains d ON d.tenant_id=t.id AND d.hostname=? AND d.status='active' AND d.dns_health_status='healthy' AND d.tls_ready_at IS NOT NULL
      WHERE t.id=? AND t.status='active' LIMIT 2 FOR UPDATE`,[domain.hostname,brand.tenantId]);
    if(owners.length!==1||owners[0].tenantId!==domain.tenantId||owners[0].uidHash!==hash(owners[0].uid))fail('BUSINESS_LINK_INVALID',409);
    await db.query('INSERT INTO sx_website_enquiries(submission_token,payload_hash,tenant_id) VALUES (?,?,?) ON DUPLICATE KEY UPDATE submission_token=VALUES(submission_token)',[data.token,payloadHash,brand.tenantId]);
    const [[request]]=await db.query('SELECT payload_hash,tenant_id AS tenantId,lead_id AS leadId FROM sx_website_enquiries WHERE submission_token=? FOR UPDATE',[data.token]);
    if(request.tenantId!==brand.tenantId||request.payload_hash!==payloadHash)fail('SUBMISSION_CHANGED',409);
    if(request.leadId){await db.commit();return {reference:data.token,repeated:true};}
    const window=Math.floor(Date.now()/3600000);
    await db.query('INSERT INTO sx_website_rate_limits(visitor_hash,window_start,requests) VALUES (?,?,1) ON DUPLICATE KEY UPDATE requests=requests+1',[visitorHash,window]);
    const [[rate]]=await db.query('SELECT requests FROM sx_website_rate_limits WHERE visitor_hash=? AND window_start=? FOR UPDATE',[visitorHash,window]);
    if(Number(rate?.requests)>8)fail('ENQUIRY_RATE_LIMITED',429);
    const requestLabel=data.intent==='quotation'?'Quotation request':data.intent==='booking_request'?'Appointment request':data.intent==='visit_request'?'Visit request':data.intent==='trial_request'?'Fitness trial request':data.intent==='availability_request'?'Event availability request':data.intent==='event_registration_request'?'Event registration enquiry':'Consultation request';
    const eventName=selectedEvent?(selectedEvent.title||selectedEvent.titleAr):'';
    const title=`${requestLabel}${data.service?` · ${data.service}`:''}${eventName?` · ${eventName}`:''}${branch?` · ${branch.slug}`:''} · ${data.name}`.slice(0,180);
    const lead=await (createLead||require('../../helper/pipeline/leadPipeline').createManualLead)({uid:owners[0].uid,actorType:'system',actorId:null,role:'owner',connection:db,input:{title,contactName:data.name,mobile:data.mobile||null,email:data.email||null,sourceType:'public_form',...(branch?.routedAgentId?{ownerAgentId:branch.routedAgentId}:{}),qualificationData:{source:'website',referralSource:`Tenant storefront · ${data.intent}`,...(data.service?{requestedService:data.service}:{}),...(eventName?{requestedEvent:eventName,requestedEventAr:selectedEvent.titleAr||null}:{}),...(data.serviceArea?{requestedServiceArea:data.serviceArea}:{}),...(data.preferredDate?{requestedDate:data.preferredDate}:{}),...(data.preferredTime?{requestedTime:data.preferredTime}:{}),...(branch?{requestedBranch:branch.slug,...(branch.routingMembershipId?{routedMembershipId:branch.routingMembershipId}:{})}:{})}}});
    // Keep the guest's actual request with the Pipeline record. The title is
    // intentionally short; this note retains the complete bounded message.
    await db.query(`INSERT INTO pipeline_activity(uid_hash,lead_id,actor_type,activity_type,summary,details,created_at)
      VALUES (?,?,'system','note_added',?,?,UTC_TIMESTAMP(3))`,[
      hash(owners[0].uid),lead.id,`${requestLabel} from ${data.name}`.slice(0,500),
      JSON.stringify({source:'tenant_storefront',hostname:domain.hostname,intent:data.intent,...(data.service?{service:data.service}:{}),...(eventName?{event:eventName,eventAr:selectedEvent.titleAr||null}:{}),...(data.serviceArea?{serviceArea:data.serviceArea}:{}),...(data.serviceAddress?{serviceAddress:data.serviceAddress}:{}),...(data.preferredDate?{preferredDate:data.preferredDate}:{}),...(data.preferredTime?{preferredTime:data.preferredTime}:{}),...(branch?{branchSlug:branch.slug,routingMembershipId:branch.routingMembershipId,routedAgentId:branch.routedAgentId}:{}),content:data.content,submissionToken:data.token}),
    ]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (UUID(),?,NULL,'system','tenant.storefront.enquiry-created','lead',?,?,UUID())`,[brand.tenantId,lead.id,JSON.stringify({intent:data.intent,source:'tenant_storefront'})]);
    await db.query("UPDATE sx_website_enquiries SET lead_id=?,consented_at=UTC_TIMESTAMP(3),consent_version='tenant-enquiry-v1' WHERE submission_token=? AND tenant_id=?",[lead.id,data.token,brand.tenantId]);
    await db.query('DELETE FROM sx_website_rate_limits WHERE window_start<? LIMIT 100',[window-48]);
    await db.commit();return {reference:data.token,repeated:false};
  }catch(error){try{await db.rollback();}catch{}throw error;}finally{db.release();}
}

async function submitTenant(pool,input,visitorHash,domain,options){
  for(let attempt=0;attempt<3;attempt++){
    try{return await submitTenantOnce(pool,input,visitorHash,domain,options);}
    catch(error){if(!['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(error.code)||attempt===2)throw error;}
  }
}
module.exports = { clean, submit, cleanTenant, submitTenant, solutions };
