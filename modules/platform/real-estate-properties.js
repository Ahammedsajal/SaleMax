'use strict';

const crypto=require('node:crypto');
const {decision}=require('./policy');

const STATUSES=new Set(['draft','active','under_offer','sold','rented','withdrawn','archived']);
const TYPES=new Set(['apartment','house','villa','townhouse','land','commercial','office','warehouse','other']);
const TRANSACTIONS=new Set(['sale','rent']);
const FIELDS=new Set(['titleEn','titleAr','propertyType','transactionType','status','priceMinor','currency','areaSqm','bedrooms','bathrooms','city','branchId','descriptionEn','descriptionAr','assignedMembershipId']);
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
  if(!partial||Object.hasOwn(input,'branchId')){
    const value=input.branchId??null;
    if(value!==null&&(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))fail('INVALID_PROPERTY_BRANCH');
    out.branchId=value;
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
  return out;
}
function transitionAllowed(from,to){
  if(from===to)return true;
  const allowed={draft:['active','archived'],active:['under_offer','sold','rented','withdrawn','archived'],under_offer:['active','sold','rented','withdrawn','archived'],withdrawn:['draft','active','archived'],sold:['archived'],rented:['archived'],archived:[]};
  return Boolean(allowed[from]?.includes(to));
}
async function list(db,context,query={}){
  authorize(context,'properties.read');const scope=decision(context,{capability:'realestate.listings',permission:'properties.read'}).scope;
  const page=Math.max(1,Math.min(100000,Number.parseInt(query.page,10)||1));
  const limit=Math.max(1,Math.min(50,Number.parseInt(query.limit,10)||25));
  const status=String(query.status||'').trim(),search=String(query.search||'').trim().slice(0,100);
  const where=['p.tenant_id=?'],params=[context.tenant.id];
  if(scope==='assigned'){where.push('(p.assigned_membership_id=? OR (p.assigned_membership_id IS NULL AND branch.routing_membership_id=?))');params.push(context.membership.id,context.membership.id);}
  else if(scope==='team'){
    where.push(`(p.assigned_membership_id=? OR EXISTS (SELECT 1 FROM sx_sales_org_history org WHERE org.tenant_id=p.tenant_id AND org.membership_id=p.assigned_membership_id AND org.team_leader_membership_id=? AND org.ended_at IS NULL) OR (p.assigned_membership_id IS NULL AND (branch.routing_membership_id=? OR EXISTS (SELECT 1 FROM sx_sales_org_history org WHERE org.tenant_id=p.tenant_id AND org.membership_id=branch.routing_membership_id AND org.team_leader_membership_id=? AND org.ended_at IS NULL))))`);
    params.push(context.membership.id,context.membership.id,context.membership.id,context.membership.id);
  }
  if(status&&status!=='all'){if(!STATUSES.has(status))fail('INVALID_PROPERTY_STATUS');where.push('p.status=?');params.push(status);}
  if(search){const like=`%${search.replace(/[!%_]/g,'!$&')}%`;where.push("(p.reference_code LIKE ? ESCAPE '!' OR p.title_en LIKE ? ESCAPE '!' OR p.title_ar LIKE ? ESCAPE '!' OR p.city LIKE ? ESCAPE '!' OR branch.name_en LIKE ? ESCAPE '!' OR branch.name_ar LIKE ? ESCAPE '!')");params.push(like,like,like,like,like,like);}
  const clause=where.join(' AND ');
  const branchJoin='LEFT JOIN sx_tenant_branches branch ON branch.tenant_id=p.tenant_id AND branch.id=p.branch_id';
  const [[count]]=await db.query(`SELECT COUNT(*) AS total FROM sx_real_estate_properties p ${branchJoin} WHERE ${clause}`,params);
  const [rows]=await db.query(`SELECT p.id,p.reference_code AS referenceCode,p.title_en AS titleEn,p.title_ar AS titleAr,p.property_type AS propertyType,p.transaction_type AS transactionType,p.status,p.price_minor AS priceMinor,p.currency,p.area_sqm AS areaSqm,p.bedrooms,p.bathrooms,p.city,p.branch_id AS branchId,branch.name_en AS branchNameEn,branch.name_ar AS branchNameAr,p.description_en AS descriptionEn,p.description_ar AS descriptionAr,p.assigned_membership_id AS assignedMembershipId,assignee.display_name AS assignedName,p.revision,p.created_at AS createdAt,p.updated_at AS updatedAt FROM sx_real_estate_properties p ${branchJoin} LEFT JOIN sx_memberships assigned ON assigned.tenant_id=p.tenant_id AND assigned.id=p.assigned_membership_id LEFT JOIN sx_identities assignee ON assignee.id=assigned.identity_id WHERE ${clause} ORDER BY p.updated_at DESC,p.id LIMIT ? OFFSET ?`,[...params,limit,(page-1)*limit]);
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
async function validateBranch(db,context,branchId){
  if(branchId===null)return null;
  const [[branch]]=await db.query("SELECT id FROM sx_tenant_branches WHERE tenant_id=? AND id=? AND status='active' LIMIT 1 FOR UPDATE",[context.tenant.id,branchId]);
  if(!branch)fail('PROPERTY_BRANCH_UNAVAILABLE',409);
  return branch.id;
}
async function listBranches(db,context){
  authorize(context,'properties.manage');
  const [rows]=await db.query("SELECT id,slug,name_en AS nameEn,name_ar AS nameAr FROM sx_tenant_branches WHERE tenant_id=? AND status='active' ORDER BY name_en,id",[context.tenant.id]);
  return {items:rows};
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
    data.branchId=await validateBranch(db,context,data.branchId);
    await db.query(`INSERT INTO sx_real_estate_properties(id,tenant_id,reference_code,title_en,title_ar,property_type,transaction_type,status,price_minor,currency,area_sqm,bedrooms,bathrooms,city,branch_id,description_en,description_ar,assigned_membership_id,created_by_identity_id,updated_by_identity_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,context.tenant.id,referenceCode,data.titleEn,data.titleAr,data.propertyType,data.transactionType,data.status,data.priceMinor,data.currency,data.areaSqm,data.bedrooms,data.bathrooms,data.city,data.branchId,data.descriptionEn,data.descriptionAr,data.assignedMembershipId,context.identity.id,context.identity.id]);
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
    const [[row]]=await db.query('SELECT status,transaction_type AS transactionType,branch_id AS branchId,revision FROM sx_real_estate_properties WHERE tenant_id=? AND id=? FOR UPDATE',[context.tenant.id,id]);
    if(!row)fail('PROPERTY_NOT_FOUND',404);if(Number(row.revision)!==input.expectedRevision)fail('STALE_REVISION',409);
    if(['sold','rented'].includes(row.status)&&Object.keys(patch).some(key=>key!=='status'))fail('INVALID_PROPERTY_TRANSITION',409);
    if(patch.status&&!transitionAllowed(row.status,patch.status))fail('INVALID_PROPERTY_TRANSITION',409);
    const transactionType=patch.transactionType||row.transactionType,status=patch.status||row.status;
    if((status==='sold'&&transactionType!=='sale')||(status==='rented'&&transactionType!=='rent'))fail('INVALID_PROPERTY_TRANSITION',409);
    if(['sold','rented'].includes(row.status)&&patch.transactionType&&patch.transactionType!==row.transactionType)fail('INVALID_PROPERTY_TRANSITION',409);
    if(Object.hasOwn(patch,'assignedMembershipId'))patch.assignedMembershipId=await validateAssignee(db,context,patch.assignedMembershipId);
    if(Object.hasOwn(patch,'branchId'))patch.branchId=await validateBranch(db,context,patch.branchId);
    const columns={titleEn:'title_en',titleAr:'title_ar',propertyType:'property_type',transactionType:'transaction_type',status:'status',priceMinor:'price_minor',currency:'currency',areaSqm:'area_sqm',bedrooms:'bedrooms',bathrooms:'bathrooms',city:'city',branchId:'branch_id',descriptionEn:'description_en',descriptionAr:'description_ar',assignedMembershipId:'assigned_membership_id'};
    const keys=Object.keys(patch),sets=keys.map(key=>`${columns[key]}=?`);
    await db.query(`UPDATE sx_real_estate_properties SET ${sets.join(',')},revision=revision+1,updated_by_identity_id=? WHERE tenant_id=? AND id=?`,[...keys.map(key=>patch[key]),context.identity.id,context.tenant.id,id]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','real-estate.property-updated','real-estate-property',?,?,?)`,[uuid(),context.tenant.id,context.identity.id,id,JSON.stringify({from:row.status,to:patch.status||row.status,revision:input.expectedRevision+1,fields:keys,assignedMembershipId:patch.assignedMembershipId}),uuid()]);
    await db.commit();return {id,...patch,revision:input.expectedRevision+1};
  }catch(error){await db.rollback();throw error;}
}
module.exports={STATUSES,TYPES,TRANSACTIONS,authorize,clean,transitionAllowed,list,listAssignees,listBranches,validateBranch,create,update};
