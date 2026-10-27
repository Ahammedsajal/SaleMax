'use strict';

const crypto=require('node:crypto');
const {decision}=require('./policy');

const STATUSES=new Set(['draft','review','active','paused','reserved','under_offer','sold','rented','expired','withdrawn','archived']);
const TYPES=new Set(['apartment','house','villa','villa_apartment','townhouse','penthouse','land','commercial','office','warehouse','other']);
const TRANSACTIONS=new Set(['sale','rent']);
const FIELDS=new Set(['titleEn','titleAr','propertyType','transactionType','status','priceMinor','currency','areaSqm','bedrooms','bathrooms','city','descriptionEn','descriptionAr','assignedMembershipId','minimumTermMonths','depositMinor','paymentFrequency','chequeCount','tenantFeeMinor','feePayer','includedServices','freeMonths','promotionTerms']);
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const uuid=()=>crypto.randomUUID();

function authorize(context,permission){
  if(context?.audience!=='tenant'||context.tenant?.categoryKey!=='real_estate'||context.tenant?.status!=='active'||context.membership?.tenantId!==context.tenant.id||context.membership?.status!=='active')fail('CATEGORY_UNAVAILABLE',404);
  const access=decision(context,{capability:'realestate.listings',permission});
  if(!access.allowed)fail(access.code,access.code==='PERMISSION_DENIED'?403:409);
  return context;
}
function clean(input,{partial=false}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_PROPERTY');
  const allowed=new Set(partial?[...FIELDS,'expectedRevision']:FIELDS);
  if(Object.keys(input).some(key=>!allowed.has(key)))fail('INVALID_PROPERTY');
  if(!partial&&['minimumTermMonths','depositMinor','paymentFrequency','chequeCount','tenantFeeMinor','feePayer','includedServices','freeMonths','promotionTerms'].some(key=>Object.hasOwn(input,key)))fail('INVALID_PROPERTY');
  const out={};
  const text=(key,max,required=true)=>{
    if(partial&&!Object.hasOwn(input,key))return;
    const value=input[key];
    if(typeof value!=='string'||(required&&!value.trim())||value.trim().length>max)fail('INVALID_PROPERTY');
    out[key]=value.trim();
  };
  text('titleEn',160,!partial);text('titleAr',160,!partial);
  if(!partial||Object.hasOwn(input,'assignedMembershipId')){
    const value=input.assignedMembershipId??null;
    if(value!==null&&(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))fail('INVALID_PROPERTY_ASSIGNEE');
    out.assignedMembershipId=value;
  }
  for(const [key,set] of [['propertyType',TYPES],['transactionType',TRANSACTIONS]]){
    if(partial&&!Object.hasOwn(input,key))continue;
    if(!set.has(input[key]))fail(`INVALID_${key==='propertyType'?'PROPERTY_TYPE':'TRANSACTION_TYPE'}`);
    out[key]=input[key];
  }
  if(partial&&!Object.hasOwn(input,'status')){}else{const value=input.status??'draft';if(!STATUSES.has(value))fail('INVALID_PROPERTY_STATUS');out.status=value;}
  if(partial&&!Object.hasOwn(input,'priceMinor')){}else{const value=input.priceMinor;if(!Number.isSafeInteger(value)||value<0||value>999999999999)fail('INVALID_PROPERTY_PRICE');out.priceMinor=value;}
  if(partial&&!Object.hasOwn(input,'currency')){}else{const value=input.currency??'QAR';if(typeof value!=='string'||!/^[A-Z]{3}$/.test(value))fail('INVALID_PROPERTY_CURRENCY');out.currency=value;}
  if(partial&&!Object.hasOwn(input,'areaSqm')){}else{const value=input.areaSqm??null;if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>10000000))fail('INVALID_PROPERTY_AREA');out.areaSqm=value;}
  for(const key of ['bedrooms','bathrooms']){if(partial&&!Object.hasOwn(input,key))continue;const value=input[key]??null;if(value!==null&&(!Number.isSafeInteger(value)||value<0||value>500))fail('INVALID_PROPERTY_ROOM_COUNT');out[key]=value;}
  text('city',100,!partial);text('descriptionEn',5000,!partial);text('descriptionAr',5000,!partial);
  for(const key of ['minimumTermMonths','chequeCount','freeMonths'])if(Object.hasOwn(input,key)){const value=input[key];if(value!==null&&(!Number.isSafeInteger(value)||value<(key==='freeMonths'?0:1)||value>1200))fail('INVALID_PROPERTY');out[key]=value;}
  for(const key of ['depositMinor','tenantFeeMinor'])if(Object.hasOwn(input,key)){const value=input[key];if(value!==null&&(!Number.isSafeInteger(value)||value<0||value>999999999999))fail('INVALID_PROPERTY_PRICE');out[key]=value;}
  for(const [key,values] of [['paymentFrequency',['monthly','quarterly','yearly','other']],['feePayer',['unknown','tenant','owner','manager','none']]])if(Object.hasOwn(input,key)){if(!values.includes(input[key]))fail('INVALID_PROPERTY');out[key]=input[key];}
  if(Object.hasOwn(input,'promotionTerms'))out.promotionTerms=textValue(input.promotionTerms,1000);
  if(Object.hasOwn(input,'includedServices')){if(!Array.isArray(input.includedServices)||input.includedServices.length>5||input.includedServices.some(x=>!['electricity','water','cooling','internet','maintenance'].includes(x))||new Set(input.includedServices).size!==input.includedServices.length)fail('INVALID_PROPERTY');out.includedServices=JSON.stringify(input.includedServices);}
  return out;
}
function textValue(value,max){if(typeof value!=='string'||value.trim().length>max)fail('INVALID_PROPERTY');return value.trim();}
function transitionAllowed(from,to){
  if(from===to)return true;
  const allowed={draft:['review','active','archived'],review:['draft','active','archived'],active:['paused','under_offer','sold','rented','expired','withdrawn','archived'],paused:['active','withdrawn','archived'],reserved:['paused','withdrawn','archived'],under_offer:['active','sold','rented','withdrawn','archived'],expired:['draft','archived'],withdrawn:['draft','active','archived'],sold:['archived'],rented:['archived'],archived:[]};
  return Boolean(allowed[from]?.includes(to));
}
async function list(db,context,query={}){
  authorize(context,'properties.read');const scope=decision(context,{capability:'realestate.listings',permission:'properties.read'}).scope;
  const page=Math.max(1,Math.min(100000,Number.parseInt(query.page,10)||1));
  const limit=Math.max(1,Math.min(50,Number.parseInt(query.limit,10)||25));
  const status=String(query.status||'').trim(),search=String(query.search||'').trim().slice(0,100);
  const where=['p.tenant_id=?'],params=[context.tenant.id];
  if(query.unitId){if(typeof query.unitId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query.unitId))fail('INVALID_PROPERTY');where.push('p.unit_id=?');params.push(query.unitId);}
  if(scope==='assigned'){where.push('p.assigned_membership_id=?');params.push(context.membership.id);}
  else if(scope==='team'){
    where.push(`(p.assigned_membership_id=? OR EXISTS (SELECT 1 FROM sx_sales_org_history org WHERE org.tenant_id=p.tenant_id AND org.membership_id=p.assigned_membership_id AND org.team_leader_membership_id=? AND org.ended_at IS NULL))`);
    params.push(context.membership.id,context.membership.id);
  }
  if(status&&status!=='all'){if(!STATUSES.has(status))fail('INVALID_PROPERTY_STATUS');where.push('p.status=?');params.push(status);}
  if(search){const like=`%${search.replace(/[!%_]/g,'!$&')}%`;where.push("(p.reference_code LIKE ? ESCAPE '!' OR p.title_en LIKE ? ESCAPE '!' OR p.title_ar LIKE ? ESCAPE '!' OR EXISTS (SELECT 1 FROM sx_real_estate_units search_unit WHERE search_unit.tenant_id=p.tenant_id AND search_unit.id=p.unit_id AND search_unit.area LIKE ? ESCAPE '!'))");params.push(like,like,like,like);}
  const clause=where.join(' AND ');
  const [[count]]=await db.query(`SELECT COUNT(*) AS total FROM sx_real_estate_properties p WHERE ${clause}`,params);
  const [rows]=await db.query(`SELECT p.id,p.unit_id AS unitId,p.reference_code AS referenceCode,p.title_en AS titleEn,p.title_ar AS titleAr,CASE WHEN u.id IS NULL THEN p.property_type ELSE u.property_type END AS propertyType,p.transaction_type AS transactionType,p.status,p.price_minor AS priceMinor,p.currency,CASE WHEN u.id IS NULL THEN p.area_sqm ELSE u.area_sqm END AS areaSqm,CASE WHEN u.id IS NULL THEN p.bedrooms ELSE u.bedrooms END AS bedrooms,CASE WHEN u.id IS NULL THEN p.bathrooms ELSE u.bathrooms END AS bathrooms,CASE WHEN u.id IS NULL THEN p.city ELSE u.area END AS city,u.availability AS unitAvailability,p.minimum_term_months AS minimumTermMonths,p.deposit_minor AS depositMinor,p.payment_frequency AS paymentFrequency,p.cheque_count AS chequeCount,p.tenant_fee_minor AS tenantFeeMinor,p.fee_payer AS feePayer,p.included_services AS includedServices,p.free_months AS freeMonths,p.promotion_terms AS promotionTerms,p.description_en AS descriptionEn,p.description_ar AS descriptionAr,p.assigned_membership_id AS assignedMembershipId,assignee.display_name AS assignedName,p.revision,p.created_at AS createdAt,p.updated_at AS updatedAt FROM sx_real_estate_properties p LEFT JOIN sx_real_estate_units u ON u.tenant_id=p.tenant_id AND u.id=p.unit_id LEFT JOIN sx_memberships assigned ON assigned.tenant_id=p.tenant_id AND assigned.id=p.assigned_membership_id LEFT JOIN sx_identities assignee ON assignee.id=assigned.identity_id WHERE ${clause} ORDER BY p.updated_at DESC,p.id LIMIT ? OFFSET ?`,[...params,limit,(page-1)*limit]);
  return {items:rows,total:Number(count.total),page,limit};
}
async function validateAssignee(db,context,membershipId){
  if(membershipId===null)return null;
  const role=context.membership.role;
  const managerScope=role==='manager'?' AND EXISTS (SELECT 1 FROM sx_sales_org_history org WHERE org.tenant_id=m.tenant_id AND org.membership_id=m.id AND org.manager_membership_id=? AND org.ended_at IS NULL)':'';
  const args=[context.tenant.id,membershipId];if(managerScope)args.push(context.membership.id);
  const [[member]]=await db.query(`SELECT m.id FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id WHERE m.tenant_id=? AND m.id=? AND m.role='agent' AND m.status='active' AND i.status='active'${managerScope} FOR UPDATE`,args);
  if(!member)fail('PROPERTY_ASSIGNEE_UNAVAILABLE',409);
  return member.id;
}
async function listAssignees(db,context){
  authorize(context,'properties.assign');const scope=decision(context,{capability:'realestate.listings',permission:'properties.assign'}).scope;
  const managerScope=context.membership.role==='manager'?' AND EXISTS (SELECT 1 FROM sx_sales_org_history org WHERE org.tenant_id=m.tenant_id AND org.membership_id=m.id AND org.manager_membership_id=? AND org.ended_at IS NULL)':'';
  const args=[context.tenant.id];if(managerScope)args.push(context.membership.id);
  const [rows]=await db.query(`SELECT m.id AS membershipId,i.display_name AS name FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id WHERE m.tenant_id=? AND m.role='agent' AND m.status='active' AND i.status='active'${managerScope} ORDER BY i.display_name,m.id`,args);
  return {items:rows,scope};
}
async function create(db,context,input){
  authorize(context,'properties.manage');const data=clean(input);
  if(data.status!=='draft')fail('INVALID_PROPERTY_TRANSITION',409);
  const id=uuid(),referenceCode=`RE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  await db.beginTransaction();
  try{
    data.assignedMembershipId=await validateAssignee(db,context,data.assignedMembershipId);
    await db.query(`INSERT INTO sx_real_estate_units(id,tenant_id,reference_code,name,property_type,area,area_sqm,bedrooms,bathrooms,assigned_membership_id,created_by_identity_id,updated_by_identity_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,[id,context.tenant.id,referenceCode,data.titleEn,data.propertyType,data.city,data.areaSqm,data.bedrooms,data.bathrooms,null,context.identity.id,context.identity.id]);
    await db.query(`INSERT INTO sx_real_estate_properties(id,tenant_id,unit_id,reference_code,title_en,title_ar,property_type,transaction_type,status,price_minor,currency,area_sqm,bedrooms,bathrooms,city,description_en,description_ar,assigned_membership_id,created_by_identity_id,updated_by_identity_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,context.tenant.id,id,referenceCode,data.titleEn,data.titleAr,data.propertyType,data.transactionType,data.status,data.priceMinor,data.currency,data.areaSqm,data.bedrooms,data.bathrooms,data.city,data.descriptionEn,data.descriptionAr,data.assignedMembershipId,context.identity.id,context.identity.id]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','real-estate.property-created','real-estate-property',?,?,?)`,[uuid(),context.tenant.id,context.identity.id,id,JSON.stringify({referenceCode,propertyType:data.propertyType,transactionType:data.transactionType,status:data.status,assignedMembershipId:data.assignedMembershipId}),uuid()]);
    await db.commit();return {id,referenceCode,...data,revision:1};
  }catch(error){await db.rollback();throw error;}
}
async function update(db,context,id,input){
  authorize(context,'properties.manage');
  if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isSafeInteger(input?.expectedRevision)||input.expectedRevision<1)fail('INVALID_PROPERTY_UPDATE');
  const patch=clean(input,{partial:true});if(!Object.keys(patch).length)fail('INVALID_PROPERTY_UPDATE');
  await db.beginTransaction();
  try{
    const [[link]]=await db.query('SELECT unit_id AS unitId FROM sx_real_estate_properties WHERE tenant_id=? AND id=?',[context.tenant.id,id]);
    if(!link)fail('PROPERTY_NOT_FOUND',404);
    if(!link.unitId)fail('PROPERTY_UNIT_REQUIRED',409);
    const [[unit]]=await db.query('SELECT availability FROM sx_real_estate_units WHERE tenant_id=? AND id=? FOR UPDATE',[context.tenant.id,link.unitId]);
    if(!unit)fail('PROPERTY_UNIT_REQUIRED',409);
    const [[row]]=await db.query('SELECT status,transaction_type AS transactionType,revision FROM sx_real_estate_properties WHERE tenant_id=? AND id=? FOR UPDATE',[context.tenant.id,id]);
    if(!row)fail('PROPERTY_NOT_FOUND',404);if(Number(row.revision)!==input.expectedRevision)fail('STALE_REVISION',409);
    if(['sold','rented'].includes(row.status)&&Object.keys(patch).some(key=>key!=='status'))fail('INVALID_PROPERTY_TRANSITION',409);
    if(patch.status&&!transitionAllowed(row.status,patch.status))fail('INVALID_PROPERTY_TRANSITION',409);
    const transactionType=patch.transactionType||row.transactionType,status=patch.status||row.status;
    if((status==='sold'&&transactionType!=='sale')||(status==='rented'&&transactionType!=='rent'))fail('INVALID_PROPERTY_TRANSITION',409);
    if(['sold','rented'].includes(row.status)&&patch.transactionType&&patch.transactionType!==row.transactionType)fail('INVALID_PROPERTY_TRANSITION',409);
    if(patch.status==='active')require('./real-estate-inventory-rules').assertListingCanActivate(unit.availability);
    if(patch.status==='rented'&&unit.availability!=='available'&&unit.availability!=='reserved')fail('UNIT_NOT_AVAILABLE',409);
    if(patch.status==='sold'&&unit.availability!=='available'&&unit.availability!=='reserved')fail('UNIT_NOT_AVAILABLE',409);
    if(Object.hasOwn(patch,'assignedMembershipId'))patch.assignedMembershipId=await validateAssignee(db,context,patch.assignedMembershipId);
    const columns={titleEn:'title_en',titleAr:'title_ar',propertyType:'property_type',transactionType:'transaction_type',status:'status',priceMinor:'price_minor',currency:'currency',areaSqm:'area_sqm',bedrooms:'bedrooms',bathrooms:'bathrooms',city:'city',descriptionEn:'description_en',descriptionAr:'description_ar',assignedMembershipId:'assigned_membership_id',minimumTermMonths:'minimum_term_months',depositMinor:'deposit_minor',paymentFrequency:'payment_frequency',chequeCount:'cheque_count',tenantFeeMinor:'tenant_fee_minor',feePayer:'fee_payer',includedServices:'included_services',freeMonths:'free_months',promotionTerms:'promotion_terms'};
    const keys=Object.keys(patch),sets=keys.map(key=>`${columns[key]}=?`);
    const unitColumns={propertyType:'property_type',areaSqm:'area_sqm',bedrooms:'bedrooms',bathrooms:'bathrooms',city:'area'};
    const unitKeys=keys.filter(key=>Object.hasOwn(unitColumns,key));
    if(unitKeys.length)await db.query(`UPDATE sx_real_estate_units SET ${unitKeys.map(key=>`${unitColumns[key]}=?`).join(',')},revision=revision+1,updated_by_identity_id=? WHERE tenant_id=? AND id=?`,[...unitKeys.map(key=>patch[key]),context.identity.id,context.tenant.id,link.unitId]);
    await db.query(`UPDATE sx_real_estate_properties SET ${sets.join(',')},revision=revision+1,updated_by_identity_id=? WHERE tenant_id=? AND id=?`,[...keys.map(key=>patch[key]),context.identity.id,context.tenant.id,id]);
    if(patch.status==='rented'){
      await db.query("UPDATE sx_real_estate_units SET availability='rented',revision=revision+1,updated_by_identity_id=? WHERE tenant_id=? AND id=?",[context.identity.id,context.tenant.id,link.unitId]);
      await db.query("UPDATE sx_real_estate_properties SET status=CASE WHEN transaction_type='sale' THEN 'paused' ELSE 'rented' END,revision=revision+1,updated_by_identity_id=? WHERE tenant_id=? AND unit_id=? AND id<>? AND status IN ('active','reserved','under_offer')",[context.identity.id,context.tenant.id,link.unitId,id]);
    }
    if(patch.status==='sold'){
      await db.query("UPDATE sx_real_estate_units SET availability='unavailable',revision=revision+1,updated_by_identity_id=? WHERE tenant_id=? AND id=?",[context.identity.id,context.tenant.id,link.unitId]);
      await db.query("UPDATE sx_real_estate_properties SET status='paused',revision=revision+1,updated_by_identity_id=? WHERE tenant_id=? AND unit_id=? AND id<>? AND status IN ('active','reserved','under_offer')",[context.identity.id,context.tenant.id,link.unitId,id]);
    }
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','real-estate.property-updated','real-estate-property',?,?,?)`,[uuid(),context.tenant.id,context.identity.id,id,JSON.stringify({from:row.status,to:patch.status||row.status,revision:input.expectedRevision+1,fields:keys,assignedMembershipId:patch.assignedMembershipId}),uuid()]);
    await db.commit();return {id,...patch,revision:input.expectedRevision+1};
  }catch(error){await db.rollback();throw error;}
}
module.exports={STATUSES,TYPES,TRANSACTIONS,authorize,clean,transitionAllowed,list,listAssignees,create,update};
