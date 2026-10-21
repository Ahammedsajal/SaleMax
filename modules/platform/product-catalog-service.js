'use strict';

const crypto=require('node:crypto');
const {decision}=require('./policy');
const catalog=require('./product-catalog');

const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
const uuid=()=>crypto.randomUUID();
const validId=value=>typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value);
const text=(value,max,code)=>{if(typeof value!=='string')fail(code,400);const result=value.trim();if(!result||result.length>max)fail(code,400);return result;};
const money=value=>{if(!Number.isSafeInteger(value)||value<0||value>100000000000)fail('INVALID_PRICE',400);return value;};
const date=(value,field)=>{if(value==null||value==='')return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail(`INVALID_${field}`,400);const parsed=new Date(`${value}T00:00:00Z`);if(Number.isNaN(parsed.valueOf())||parsed.toISOString().slice(0,10)!==value)fail(`INVALID_${field}`,400);return value;};

function object(ctx,permission){
  if(!ctx||ctx.audience!=='tenant'||ctx.tenant?.status!=='active'||ctx.membership?.status!=='active'||ctx.membership?.tenantId!==ctx.tenant?.id)fail('TENANT_CONTEXT_REQUIRED',401);
  if(catalog.kind(ctx)!=='products')fail('CATEGORY_UNAVAILABLE',403);
  const result=decision(ctx,{capability:'products.catalog',permission});
  if(!result.allowed)fail(result.code,403);
}

function productInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_PRODUCT',400);
  const code=text(input.sku??input.code,40,'INVALID_SKU').toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code))fail('INVALID_SKU',400);
  const itemKind=input.itemKind??input.kind??null;
  if(itemKind!==null&&!['product','service','unclassified'].includes(itemKind))fail('INVALID_PRODUCT_KIND',400);
  const tags=input.tags??[];
  if(!Array.isArray(tags)||tags.length>30||tags.some(tag=>typeof tag!=='string'||!tag.trim()||tag.trim().length>60))fail('INVALID_PRODUCT_TAGS',400);
  const descriptionEn=input.descriptionEn??'',descriptionAr=input.descriptionAr??'';
  if(typeof descriptionEn!=='string'||descriptionEn.length>5000||typeof descriptionAr!=='string'||descriptionAr.length>5000)fail('INVALID_PRODUCT_DESCRIPTION',400);
  return {code,itemKind,nameEn:text(input.nameEn??input.titleEn,200,'INVALID_PRODUCT_NAME'),nameAr:text(input.nameAr??input.titleAr,200,'INVALID_PRODUCT_NAME'),descriptionEn:descriptionEn.trim(),descriptionAr:descriptionAr.trim(),tags:[...new Set(tags.map(tag=>tag.trim()))]};
}

function offerInput(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('INVALID_OFFER',400);
  const price=money(input.priceMinor),currency=String(input.currency||'QAR').toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency))fail('INVALID_CURRENCY',400);
  const from=date(input.validFrom,'OFFER_START_DATE'),until=date(input.validUntil,'OFFER_END_DATE');
  if(from&&until&&until<from)fail('INVALID_OFFER_DATES',400);
  const inclusions=input.inclusions??[];
  if(!Array.isArray(inclusions)||inclusions.length>30||inclusions.some(value=>typeof value!=='string'||!value.trim()||value.trim().length>200))fail('INVALID_OFFER_INCLUSIONS',400);
  const terms=input.paymentTerms??{count:1,interval:'once'},count=terms?.count??1,interval=terms?.interval??(count===1?'once':'monthly');
  if(!terms||typeof terms!=='object'||Array.isArray(terms)||Object.keys(terms).some(key=>!['count','interval'].includes(key))||!Number.isSafeInteger(count)||count<1||count>12||!['once','weekly','monthly'].includes(interval)||(count===1&&interval!=='once')||(count>1&&interval==='once'))fail('INVALID_PAYMENT_TERMS',400);
  return {price,currency,from,until,inclusions:inclusions.map(value=>value.trim()),count,interval};
}

async function tx(db,fn){await db.beginTransaction();try{const result=await fn();await db.commit();return result;}catch(error){await db.rollback();throw error;}}
async function audit(db,ctx,action,id,changes){await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity',?,'product',?,?,?)`,[uuid(),ctx.tenant.id,ctx.identity.id,action,id,JSON.stringify(changes),uuid()]);}
async function verifyTenant(db,ctx){const [[tenant]]=await db.query('SELECT id,status,category_key,category_version FROM sx_tenants WHERE id=? FOR UPDATE',[ctx.tenant.id]);if(!tenant||tenant.status!=='active'||tenant.category_key!==ctx.category.key||Number(tenant.category_version)!==ctx.category.version)fail('CATEGORY_UNAVAILABLE',409);}

async function list(db,ctx,{page=1,limit=20,search='',status=''}={}){
  object(ctx,'products.read');
  if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('INVALID_PAGING',400);
  if(typeof search!=='string'||search.length>100)fail('INVALID_SEARCH',400);
  if(status&&!['draft','active','retired'].includes(status))fail('INVALID_STATUS',400);
  const term=`%${search.trim().replace(/[\\%_]/g,'\\$&')}%`,where="tenant_id=? AND deleted_at IS NULL AND (?='' OR status=?) AND (?='' OR code LIKE ? OR name_en LIKE ? OR name_ar LIKE ?)",params=[ctx.tenant.id,status,status,search.trim(),term,term,term];
  const [[total]]=await db.query(`SELECT COUNT(*) AS total FROM sx_product_catalog WHERE ${where}`,params);
  const [rows]=await db.query(`SELECT p.id,p.code,p.code AS sku,p.item_kind AS itemKind,p.name_en AS nameEn,p.name_ar AS nameAr,p.description_en AS descriptionEn,p.description_ar AS descriptionAr,p.tags_json AS tagsJson,p.status,p.revision,p.updated_at AS updatedAt,(SELECT COUNT(*) FROM sx_product_offers o WHERE o.tenant_id=p.tenant_id AND o.course_id=p.id) AS offerVersionCount,(SELECT o.price_minor FROM sx_product_offers o WHERE o.tenant_id=p.tenant_id AND o.course_id=p.id ORDER BY o.version DESC LIMIT 1) AS priceMinor,(SELECT o.currency FROM sx_product_offers o WHERE o.tenant_id=p.tenant_id AND o.course_id=p.id ORDER BY o.version DESC LIMIT 1) AS currency,(SELECT o.version FROM sx_product_offers o WHERE o.tenant_id=p.tenant_id AND o.course_id=p.id ORDER BY o.version DESC LIMIT 1) AS offerVersion FROM sx_product_catalog p WHERE ${where} ORDER BY p.updated_at DESC,p.id LIMIT ? OFFSET ?`,[...params,limit,(page-1)*limit]);
  return {items:rows.map(row=>({...row,revision:Number(row.revision),offerVersionCount:Number(row.offerVersionCount),tags:typeof row.tagsJson==='string'?JSON.parse(row.tagsJson):row.tagsJson||[],tagsJson:undefined,batchCount:0})),total:Number(total.total),page,limit};
}

async function create(db,ctx,input){
  object(ctx,'products.manage');const product=productInput(input),offer=input.offer?offerInput(input.offer):null;product.itemKind=product.itemKind||'service';
  if(product.itemKind==='unclassified')fail('INVALID_PRODUCT_KIND',400);
  return tx(db,async()=>{await verifyTenant(db,ctx);const id=uuid();await db.query(`INSERT INTO sx_product_catalog(id,tenant_id,code,item_kind,name_en,name_ar,description_en,description_ar,tags_json,status,revision,created_by_identity_id,updated_by_identity_id) VALUES (?,?,?,?,?,?,?,?,?,'draft',1,?,?)`,[id,ctx.tenant.id,product.code,product.itemKind,product.nameEn,product.nameAr,product.descriptionEn,product.descriptionAr,JSON.stringify(product.tags),ctx.identity.id,ctx.identity.id]);if(offer)await insertOffer(db,ctx,id,1,offer);await audit(db,ctx,'sales.product-created',id,{sku:product.code,itemKind:product.itemKind,offerVersion:offer?1:null});return {id,revision:1,offerVersion:offer?1:null};});
}

async function insertOffer(db,ctx,id,version,offer){await db.query(`INSERT INTO sx_product_offers(id,tenant_id,course_id,version,currency,price_minor,registration_fee_minor,payment_term_count,payment_interval,valid_from,valid_until,inclusions,created_by_identity_id) VALUES (?,?,?,?,?,?,0,?,?,?,?,?,?)`,[uuid(),ctx.tenant.id,id,version,offer.currency,offer.price,offer.count,offer.interval,offer.from,offer.until,JSON.stringify(offer.inclusions),ctx.identity.id]);}

async function update(db,ctx,id,expectedRevision,input){
  object(ctx,'products.manage');if(!validId(id)||!Number.isSafeInteger(expectedRevision)||expectedRevision<1)fail('INVALID_REVISION',400);const product=productInput(input);
  return tx(db,async()=>{const [[row]]=await db.query('SELECT revision,status,item_kind AS itemKind,tags_json AS tagsJson FROM sx_product_catalog WHERE tenant_id=? AND id=? AND deleted_at IS NULL FOR UPDATE',[ctx.tenant.id,id]);if(!row)fail('PRODUCT_NOT_FOUND',404);if(row.status==='retired')fail('PRODUCT_RETIRED',409);if(Number(row.revision)!==expectedRevision)fail('STALE_REVISION',409);const itemKind=product.itemKind||row.itemKind,tags=input.tags===undefined?(typeof row.tagsJson==='string'?JSON.parse(row.tagsJson):row.tagsJson||[]):product.tags;await db.query('UPDATE sx_product_catalog SET code=?,item_kind=?,name_en=?,name_ar=?,description_en=?,description_ar=?,tags_json=?,revision=revision+1,updated_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?',[product.code,itemKind,product.nameEn,product.nameAr,product.descriptionEn,product.descriptionAr,JSON.stringify(tags),ctx.identity.id,ctx.tenant.id,id]);await audit(db,ctx,'sales.product-updated',id,{revision:expectedRevision+1,itemKind});return {id,revision:expectedRevision+1};});
}

async function offers(db,ctx,id){object(ctx,'products.read');if(!validId(id))fail('INVALID_ID',400);const [rows]=await db.query('SELECT id,version,currency,price_minor AS priceMinor,payment_term_count AS paymentTermCount,payment_interval AS paymentInterval,valid_from AS validFrom,valid_until AS validUntil,inclusions,status,created_at AS createdAt FROM sx_product_offers WHERE tenant_id=? AND course_id=? ORDER BY version DESC',[ctx.tenant.id,id]);if(!rows.length){const [[item]]=await db.query('SELECT id FROM sx_product_catalog WHERE tenant_id=? AND id=? AND deleted_at IS NULL',[ctx.tenant.id,id]);if(!item)fail('PRODUCT_NOT_FOUND',404);}return rows.map(row=>({...row,version:Number(row.version),paymentTermCount:Number(row.paymentTermCount),inclusions:typeof row.inclusions==='string'?JSON.parse(row.inclusions):row.inclusions}));}

async function addOffer(db,ctx,id,input){object(ctx,'products.manage');if(!validId(id))fail('INVALID_ID',400);const offer=offerInput(input);return tx(db,async()=>{const [[item]]=await db.query('SELECT id,status FROM sx_product_catalog WHERE tenant_id=? AND id=? AND deleted_at IS NULL FOR UPDATE',[ctx.tenant.id,id]);if(!item)fail('PRODUCT_NOT_FOUND',404);if(item.status==='retired')fail('PRODUCT_RETIRED',409);const [[last]]=await db.query('SELECT COALESCE(MAX(version),0) AS version FROM sx_product_offers WHERE tenant_id=? AND course_id=?',[ctx.tenant.id,id]);const version=Number(last.version)+1;await db.query("UPDATE sx_product_offers SET status='retired' WHERE tenant_id=? AND course_id=? AND status='active'",[ctx.tenant.id,id]);await insertOffer(db,ctx,id,version,offer);await audit(db,ctx,'sales.product-price-created',id,{offerVersion:version,currency:offer.currency,priceMinor:offer.price});return {productId:id,version};});}

async function publish(db,ctx,id,expectedRevision){object(ctx,'products.manage');return changeStatus(db,ctx,id,expectedRevision,'active','sales.product-published',true);}
async function restoreAndPublish(db,ctx,id,expectedRevision){object(ctx,'products.manage');return changeStatus(db,ctx,id,expectedRevision,'active','sales.product-restored',true,'retired');}
async function retire(db,ctx,id,expectedRevision){object(ctx,'products.manage');return changeStatus(db,ctx,id,expectedRevision,'retired','sales.product-retired',false);}
async function changeStatus(db,ctx,id,expectedRevision,status,action,needsOffer,expectedStatus=null){if(!validId(id)||!Number.isSafeInteger(expectedRevision)||expectedRevision<1)fail('INVALID_REVISION',400);return tx(db,async()=>{const [[item]]=await db.query('SELECT revision,status,item_kind AS itemKind FROM sx_product_catalog WHERE tenant_id=? AND id=? AND deleted_at IS NULL FOR UPDATE',[ctx.tenant.id,id]);if(!item)fail('PRODUCT_NOT_FOUND',404);if(expectedStatus&&item.status!==expectedStatus)fail('PRODUCT_NOT_RETIRED',409);if(!expectedStatus&&item.status==='retired'&&status==='retired')return {id,status,revision:Number(item.revision),repeated:true};if(Number(item.revision)!==expectedRevision)fail('STALE_REVISION',409);if(needsOffer&&item.itemKind==='unclassified')fail('PRODUCT_TYPE_REVIEW_REQUIRED',409);if(needsOffer){const today=new Intl.DateTimeFormat('en-CA',{timeZone:ctx.tenant.timezone||'Asia/Qatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const [[offer]]=await db.query("SELECT id FROM sx_product_offers WHERE tenant_id=? AND course_id=? AND status='active' AND (valid_from IS NULL OR valid_from<=?) AND (valid_until IS NULL OR valid_until>=?) LIMIT 1",[ctx.tenant.id,id,today,today]);if(!offer)fail('ACTIVE_PRICE_REQUIRED',409);}const revision=Number(item.revision)+1;await db.query('UPDATE sx_product_catalog SET status=?,revision=?,updated_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=?',[status,revision,ctx.identity.id,ctx.tenant.id,id]);await audit(db,ctx,action,id,{status,revision});return {id,status,revision};});}

async function remove(db,ctx,id){object(ctx,'products.manage');if(!validId(id))fail('INVALID_ID',400);return tx(db,async()=>{const [[item]]=await db.query('SELECT id,code,status,deleted_at AS deletedAt FROM sx_product_catalog WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,id]);if(!item||item.deletedAt)fail('PRODUCT_NOT_FOUND',404);await db.query('UPDATE sx_product_catalog SET deleted_at=UTC_TIMESTAMP(3),revision=revision+1,updated_by_identity_id=?,updated_at=UTC_TIMESTAMP(3) WHERE tenant_id=? AND id=? AND deleted_at IS NULL',[ctx.identity.id,ctx.tenant.id,id]);await audit(db,ctx,'sales.product-removed',id,{sku:item.code,status:item.status,historyPreserved:true});return {id,deleted:true,historyPreserved:true};});}

module.exports={object,productInput,offerInput,list,create,update,offers,addOffer,publish,restoreAndPublish,retire,remove};
