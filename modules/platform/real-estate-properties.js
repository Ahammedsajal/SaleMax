'use strict';

const crypto=require('node:crypto');
const {decision}=require('./policy');

const STATUSES=new Set(['draft','active','under_offer','sold','rented','withdrawn','archived']);
const TYPES=new Set(['apartment','house','villa','townhouse','land','commercial','office','warehouse','other']);
const TRANSACTIONS=new Set(['sale','rent']);
const FIELDS=new Set(['titleEn','titleAr','propertyType','transactionType','status','priceMinor','currency','areaSqm','bedrooms','bathrooms','city','descriptionEn','descriptionAr']);
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const uuid=()=>crypto.randomUUID();

function authorize(context,permission){
  if(context?.audience!=='tenant'||context.tenant?.categoryKey!=='real_estate'||context.tenant?.status!=='active'||context.membership?.tenantId!==context.tenant.id||context.membership?.status!=='active')fail('CATEGORY_UNAVAILABLE',404);
  // No per-listing assignments exist yet, so custom permissions must not turn
  // the current agent/team scopes into unrestricted tenant-wide inventory.
  if(!['owner','manager'].includes(context.membership.role))fail('PERMISSION_DENIED',403);
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
  authorize(context,'properties.read');
  const page=Math.max(1,Math.min(100000,Number.parseInt(query.page,10)||1));
  const limit=Math.max(1,Math.min(50,Number.parseInt(query.limit,10)||25));
  const status=String(query.status||'').trim(),search=String(query.search||'').trim().slice(0,100);
  const where=['tenant_id=?'],params=[context.tenant.id];
  if(status&&status!=='all'){if(!STATUSES.has(status))fail('INVALID_PROPERTY_STATUS');where.push('status=?');params.push(status);}
  if(search){const like=`%${search.replace(/[!%_]/g,'!$&')}%`;where.push("(reference_code LIKE ? ESCAPE '!' OR title_en LIKE ? ESCAPE '!' OR title_ar LIKE ? ESCAPE '!' OR city LIKE ? ESCAPE '!')");params.push(like,like,like,like);}
  const clause=where.join(' AND ');
  const [[count]]=await db.query(`SELECT COUNT(*) AS total FROM sx_real_estate_properties WHERE ${clause}`,params);
  const [rows]=await db.query(`SELECT id,reference_code AS referenceCode,title_en AS titleEn,title_ar AS titleAr,property_type AS propertyType,transaction_type AS transactionType,status,price_minor AS priceMinor,currency,area_sqm AS areaSqm,bedrooms,bathrooms,city,description_en AS descriptionEn,description_ar AS descriptionAr,revision,created_at AS createdAt,updated_at AS updatedAt FROM sx_real_estate_properties WHERE ${clause} ORDER BY updated_at DESC,id LIMIT ? OFFSET ?`,[...params,limit,(page-1)*limit]);
  return {items:rows,total:Number(count.total),page,limit};
}
async function create(db,context,input){
  authorize(context,'properties.manage');const data=clean(input);
  if(data.status!=='draft')fail('INVALID_PROPERTY_TRANSITION',409);
  const id=uuid(),referenceCode=`RE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  await db.beginTransaction();
  try{
    await db.query(`INSERT INTO sx_real_estate_properties(id,tenant_id,reference_code,title_en,title_ar,property_type,transaction_type,status,price_minor,currency,area_sqm,bedrooms,bathrooms,city,description_en,description_ar,created_by_identity_id,updated_by_identity_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,context.tenant.id,referenceCode,data.titleEn,data.titleAr,data.propertyType,data.transactionType,data.status,data.priceMinor,data.currency,data.areaSqm,data.bedrooms,data.bathrooms,data.city,data.descriptionEn,data.descriptionAr,context.identity.id,context.identity.id]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','real-estate.property-created','real-estate-property',?,?,?)`,[uuid(),context.tenant.id,context.identity.id,id,JSON.stringify({referenceCode,propertyType:data.propertyType,transactionType:data.transactionType,status:data.status}),uuid()]);
    await db.commit();return {id,referenceCode,...data,revision:1};
  }catch(error){await db.rollback();throw error;}
}
async function update(db,context,id,input){
  authorize(context,'properties.manage');
  if(!/^[0-9a-f-]{36}$/i.test(id)||!Number.isSafeInteger(input?.expectedRevision)||input.expectedRevision<1)fail('INVALID_PROPERTY_UPDATE');
  const patch=clean(input,{partial:true});if(!Object.keys(patch).length)fail('INVALID_PROPERTY_UPDATE');
  await db.beginTransaction();
  try{
    const [[row]]=await db.query('SELECT status,transaction_type AS transactionType,revision FROM sx_real_estate_properties WHERE tenant_id=? AND id=? FOR UPDATE',[context.tenant.id,id]);
    if(!row)fail('PROPERTY_NOT_FOUND',404);if(Number(row.revision)!==input.expectedRevision)fail('STALE_REVISION',409);
    if(['sold','rented'].includes(row.status)&&Object.keys(patch).some(key=>key!=='status'))fail('INVALID_PROPERTY_TRANSITION',409);
    if(patch.status&&!transitionAllowed(row.status,patch.status))fail('INVALID_PROPERTY_TRANSITION',409);
    const transactionType=patch.transactionType||row.transactionType,status=patch.status||row.status;
    if((status==='sold'&&transactionType!=='sale')||(status==='rented'&&transactionType!=='rent'))fail('INVALID_PROPERTY_TRANSITION',409);
    if(['sold','rented'].includes(row.status)&&patch.transactionType&&patch.transactionType!==row.transactionType)fail('INVALID_PROPERTY_TRANSITION',409);
    const columns={titleEn:'title_en',titleAr:'title_ar',propertyType:'property_type',transactionType:'transaction_type',status:'status',priceMinor:'price_minor',currency:'currency',areaSqm:'area_sqm',bedrooms:'bedrooms',bathrooms:'bathrooms',city:'city',descriptionEn:'description_en',descriptionAr:'description_ar'};
    const keys=Object.keys(patch),sets=keys.map(key=>`${columns[key]}=?`);
    await db.query(`UPDATE sx_real_estate_properties SET ${sets.join(',')},revision=revision+1,updated_by_identity_id=? WHERE tenant_id=? AND id=?`,[...keys.map(key=>patch[key]),context.identity.id,context.tenant.id,id]);
    await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,?,'identity','real-estate.property-updated','real-estate-property',?,?,?)`,[uuid(),context.tenant.id,context.identity.id,id,JSON.stringify({from:row.status,to:patch.status||row.status,revision:input.expectedRevision+1,fields:keys}),uuid()]);
    await db.commit();return {id,...patch,revision:input.expectedRevision+1};
  }catch(error){await db.rollback();throw error;}
}
module.exports={STATUSES,TYPES,TRANSACTIONS,authorize,clean,transitionAllowed,list,create,update};
