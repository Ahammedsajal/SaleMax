'use strict';
const crypto=require('node:crypto');
const logoMedia=require('./tenant-crm-logo-media');
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const uuid=()=>crypto.randomUUID();
function text(value,max,field){if(typeof value!=='string'||value.length>max)fail(`INVALID_${field}`);return value.trim();}
function secureUrl(value,field,{maps=false}={}){
  const raw=text(value,2048,field);if(!raw)return '';
  let parsed;try{parsed=new URL(raw);}catch{fail(`INVALID_${field}`);}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password)fail(`INVALID_${field}`);
  if(maps&&!(/^(?:(?:maps|www)\.)?google\.[a-z]{2,}(?:\.[a-z]{2,})?$/i.test(parsed.hostname)||parsed.hostname==='maps.app.goo.gl'))fail(`INVALID_${field}`);
  return parsed.toString();
}
function normalize(value){
  if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_PROFILE');
  const email=text(value.email??'',254,'EMAIL');
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('INVALID_EMAIL');
  const phone=text(value.phone??'',80,'PHONE');
  if(phone&&!/^\+?[0-9 ()-]{5,80}$/.test(phone))fail('INVALID_PHONE');
  return {
    businessNameEn:text(value.businessNameEn??'',200,'BUSINESS_NAME'),businessNameAr:text(value.businessNameAr??'',200,'BUSINESS_NAME'),
    crNumber:text(value.crNumber??'',100,'CR_NUMBER'),email,phone,websiteUrl:secureUrl(value.websiteUrl??'','WEBSITE_URL'),
    addressEn:text(value.addressEn??'',1000,'ADDRESS'),addressAr:text(value.addressAr??'',1000,'ADDRESS'),
    googleMapsUrl:secureUrl(value.googleMapsUrl??'','MAPS_URL',{maps:true}),
    metaTitleEn:text(value.metaTitleEn??'',200,'META_TITLE'),metaTitleAr:text(value.metaTitleAr??'',200,'META_TITLE'),
    metaDescriptionEn:text(value.metaDescriptionEn??'',500,'META_DESCRIPTION'),metaDescriptionAr:text(value.metaDescriptionAr??'',500,'META_DESCRIPTION')
  };
}
function fromRow(row,tenantName=''){
  return {businessNameEn:row?.businessNameEn||tenantName,businessNameAr:row?.businessNameAr||'',crNumber:row?.crNumber||'',email:row?.email||'',phone:row?.phone||'',websiteUrl:row?.websiteUrl||'',addressEn:row?.addressEn||'',addressAr:row?.addressAr||'',googleMapsUrl:row?.googleMapsUrl||'',metaTitleEn:row?.metaTitleEn||'',metaTitleAr:row?.metaTitleAr||'',metaDescriptionEn:row?.metaDescriptionEn||'',metaDescriptionAr:row?.metaDescriptionAr||'',logoUrl:row?.logoUrl||'',faviconUrl:row?.faviconUrl||'',revision:Number(row?.revision||0),updatedAt:row?.updatedAt||null};
}
async function get(db,ctx){
  if(ctx?.audience!=='tenant'||ctx.tenant?.id!==ctx.membership?.tenantId||ctx.membership?.status!=='active'||ctx.membership?.role!=='owner')fail('PERMISSION_DENIED',403);
  const [[row]]=await db.query(`SELECT p.business_name_en AS businessNameEn,p.business_name_ar AS businessNameAr,p.cr_number AS crNumber,p.email,p.phone,p.website_url AS websiteUrl,p.address_en AS addressEn,p.address_ar AS addressAr,p.google_maps_url AS googleMapsUrl,p.logo_url AS logoUrl,p.favicon_url AS faviconUrl,p.meta_title_en AS metaTitleEn,p.meta_title_ar AS metaTitleAr,p.meta_description_en AS metaDescriptionEn,p.meta_description_ar AS metaDescriptionAr,p.revision,p.updated_at AS updatedAt,t.name AS tenantName FROM sx_tenants t LEFT JOIN sx_tenant_business_profiles p ON p.tenant_id=t.id WHERE t.id=? AND t.status='active'`,[ctx.tenant.id]);
  if(!row)fail('TENANT_CONTEXT_REQUIRED',403);return fromRow(row,row.tenantName);
}
async function save(db,ctx,expectedRevision,value,{logoFile=null,faviconFile=null,clearLogo=false,clearFavicon=false}={}){
  if(ctx?.audience!=='tenant'||ctx.tenant?.id!==ctx.membership?.tenantId||ctx.membership?.status!=='active'||ctx.membership?.role!=='owner')fail('PERMISSION_DENIED',403);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('INVALID_REVISION');
  if((logoFile&&clearLogo)||(faviconFile&&clearFavicon))fail('INVALID_ASSET_UPDATE');
  if(faviconFile&&!['image/png','image/webp'].includes(String(faviconFile.mimetype||'').toLowerCase()))fail('INVALID_FAVICON_TYPE',415);
  const nextProfile=normalize(value);let storedLogo=null,storedFavicon=null;
  try{
    if(logoFile)storedLogo=await logoMedia.store(logoFile,ctx.tenant.id);
    if(faviconFile)storedFavicon=await logoMedia.store(faviconFile,ctx.tenant.id);
    await db.beginTransaction();
    try{
      await db.query("SELECT id FROM sx_tenants WHERE id=? AND status='active' FOR UPDATE",[ctx.tenant.id]);
      const [[old]]=await db.query('SELECT logo_url AS logoUrl,favicon_url AS faviconUrl,revision FROM sx_tenant_business_profiles WHERE tenant_id=? FOR UPDATE',[ctx.tenant.id]);
      const current=Number(old?.revision||0);if(current!==expectedRevision)fail('STALE_REVISION',409);
      const logoUrl=storedLogo?.url??(clearLogo?'':old?.logoUrl||'');
      const faviconUrl=storedFavicon?.url??(clearFavicon?'':old?.faviconUrl||'');
      const revision=current+1;
      await db.query(`INSERT INTO sx_tenant_business_profiles
        (tenant_id,business_name_en,business_name_ar,cr_number,email,phone,website_url,address_en,address_ar,google_maps_url,logo_url,favicon_url,meta_title_en,meta_title_ar,meta_description_en,meta_description_ar,revision,updated_by_identity_id,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE business_name_en=VALUES(business_name_en),business_name_ar=VALUES(business_name_ar),cr_number=VALUES(cr_number),email=VALUES(email),phone=VALUES(phone),website_url=VALUES(website_url),address_en=VALUES(address_en),address_ar=VALUES(address_ar),google_maps_url=VALUES(google_maps_url),logo_url=VALUES(logo_url),favicon_url=VALUES(favicon_url),meta_title_en=VALUES(meta_title_en),meta_title_ar=VALUES(meta_title_ar),meta_description_en=VALUES(meta_description_en),meta_description_ar=VALUES(meta_description_ar),revision=VALUES(revision),updated_by_identity_id=VALUES(updated_by_identity_id),updated_at=UTC_TIMESTAMP(3)`,[ctx.tenant.id,nextProfile.businessNameEn,nextProfile.businessNameAr,nextProfile.crNumber,nextProfile.email,nextProfile.phone,nextProfile.websiteUrl,nextProfile.addressEn,nextProfile.addressAr,nextProfile.googleMapsUrl,logoUrl,faviconUrl,nextProfile.metaTitleEn,nextProfile.metaTitleAr,nextProfile.metaDescriptionEn,nextProfile.metaDescriptionAr,revision,ctx.identity.id]);
      await db.query(`INSERT INTO sx_tenant_crm_branding(tenant_id,logo_url,revision,updated_by_identity_id,updated_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE logo_url=VALUES(logo_url),revision=VALUES(revision),updated_by_identity_id=VALUES(updated_by_identity_id),updated_at=UTC_TIMESTAMP(3)`,[ctx.tenant.id,logoUrl,revision,ctx.identity.id]);
      await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity','tenant.business-profile.updated','tenant-business-profile',?,?,?)`,[uuid(),ctx.tenant.id,ctx.identity.id,ctx.tenant.id,JSON.stringify({revision,logoChanged:!!storedLogo||clearLogo,faviconChanged:!!storedFavicon||clearFavicon,fields:['businessNameEn','businessNameAr','crNumber','email','phone','websiteUrl','addressEn','addressAr','googleMapsUrl','metaTitleEn','metaTitleAr','metaDescriptionEn','metaDescriptionAr']}),uuid()]);
      await db.commit();
      if(old?.logoUrl&&old.logoUrl!==logoUrl)await logoMedia.removeManaged(old.logoUrl,ctx.tenant.id);
      if(old?.faviconUrl&&old.faviconUrl!==faviconUrl)await logoMedia.removeManaged(old.faviconUrl,ctx.tenant.id);
      return {...nextProfile,logoUrl,faviconUrl,revision};
    }catch(error){await db.rollback();throw error;}
  }catch(error){if(storedLogo)await logoMedia.removeManaged(storedLogo.url,ctx.tenant.id);if(storedFavicon)await logoMedia.removeManaged(storedFavicon.url,ctx.tenant.id);throw error;}
}
async function publicBrand(db,hostname){
  const [[row]]=await db.query(`SELECT d.tenant_id AS tenantId,t.name AS tenantName,p.business_name_en AS businessNameEn,p.business_name_ar AS businessNameAr,p.logo_url AS profileLogoUrl,p.favicon_url AS faviconUrl,p.meta_title_en AS metaTitleEn,p.meta_title_ar AS metaTitleAr,p.meta_description_en AS metaDescriptionEn,p.meta_description_ar AS metaDescriptionAr,c.logo_url AS legacyLogoUrl FROM sx_tenant_crm_domains d JOIN sx_tenants t ON t.id=d.tenant_id LEFT JOIN sx_tenant_business_profiles p ON p.tenant_id=t.id LEFT JOIN sx_tenant_crm_branding c ON c.tenant_id=t.id WHERE d.hostname=? AND d.status='active' AND d.tls_ready_at IS NOT NULL AND d.dns_health_status<>'stale' AND t.status='active' LIMIT 1`,[hostname]);
  if(!row)return null;return {tenantId:row.tenantId,name:row.businessNameEn||row.tenantName,nameEn:row.businessNameEn||row.tenantName,nameAr:row.businessNameAr||'',logoUrl:row.profileLogoUrl||row.legacyLogoUrl||'',faviconUrl:row.faviconUrl||row.profileLogoUrl||row.legacyLogoUrl||'',metaTitleEn:row.metaTitleEn||'',metaTitleAr:row.metaTitleAr||'',metaDescriptionEn:row.metaDescriptionEn||'',metaDescriptionAr:row.metaDescriptionAr||''};
}
async function getPublicForTenant(db,tenantId){
  const [[row]]=await db.query(`SELECT t.name AS tenantName,p.business_name_en AS businessNameEn,p.business_name_ar AS businessNameAr,p.logo_url AS profileLogoUrl,p.favicon_url AS faviconUrl,p.meta_title_en AS metaTitleEn,p.meta_title_ar AS metaTitleAr,p.meta_description_en AS metaDescriptionEn,p.meta_description_ar AS metaDescriptionAr,p.revision,c.logo_url AS legacyLogoUrl FROM sx_tenants t LEFT JOIN sx_tenant_business_profiles p ON p.tenant_id=t.id LEFT JOIN sx_tenant_crm_branding c ON c.tenant_id=t.id WHERE t.id=? AND t.status='active'`,[tenantId]);
  if(!row)return null;return {name:row.businessNameEn||row.tenantName,nameEn:row.businessNameEn||row.tenantName,nameAr:row.businessNameAr||'',logoUrl:row.profileLogoUrl||row.legacyLogoUrl||'',faviconUrl:row.faviconUrl||row.profileLogoUrl||row.legacyLogoUrl||'',metaTitleEn:row.metaTitleEn||'',metaTitleAr:row.metaTitleAr||'',metaDescriptionEn:row.metaDescriptionEn||'',metaDescriptionAr:row.metaDescriptionAr||'',revision:Number(row.revision||0)};
}
module.exports={normalize,fromRow,get,save,publicBrand,getPublicForTenant};
