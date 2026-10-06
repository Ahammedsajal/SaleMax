'use strict';

async function get(db,tenantId){
  const [[row]]=await db.query(`SELECT t.name AS tenantName,p.display_name_en AS nameEn,p.display_name_ar AS nameAr,p.logo_url AS logoUrl FROM sx_tenants t LEFT JOIN sx_training_center_profiles p ON p.tenant_id=t.id WHERE t.id=? LIMIT 1`,[tenantId]);
  if(!row)return {nameEn:'Training Center',nameAr:'Training Center',logoUrl:''};
  const fallback=String(row.tenantName||'Training Center');
  return {nameEn:String(row.nameEn||fallback),nameAr:String(row.nameAr||row.nameEn||fallback),logoUrl:String(row.logoUrl||'')};
}
module.exports={get};
