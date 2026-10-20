'use strict';
const plans=require('./plans');
const fail=code=>{throw Object.assign(new Error(code),{code});};
function supports(category){return category?.key==='training_center'&&category.version===1;}
function normalize(value){
 if(value===undefined||value===null)return value;
 if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))fail('INVALID_CAPTURE_FORM');return value;
}
function enabled(ctx){return Boolean(supports(ctx?.category)&&ctx.category.capabilities.includes('portal.forms')&&ctx.subscription?.categoryKey===ctx.category.key&&ctx.subscription.categoryVersion===ctx.category.version&&['active','trial','grace'].includes(ctx.subscription.status)&&ctx.subscription.capabilities?.includes('portal.forms'));}
const select=`SELECT t.slug AS tenantSlug,v.slug AS formSlug,f.id AS formId,v.version AS publishedVersion,v.name_en AS nameEn,v.name_ar AS nameAr,JSON_UNQUOTE(JSON_EXTRACT(v.schema_json,'$.templateKey')) AS templateKey,COALESCE(JSON_LENGTH(v.schema_json,'$.leadFields.fields'),0) AS customFieldCount
 FROM sx_training_forms f JOIN sx_training_form_versions v ON v.tenant_id=f.tenant_id AND v.form_id=f.id AND v.version=f.published_version
 JOIN sx_tenants t ON t.id=f.tenant_id
 WHERE f.tenant_id=? AND t.status='active' AND t.category_key='training_center' AND t.category_version=1 AND f.status='published' AND f.published_version IS NOT NULL`;
async function options(db,ctx){
 if(!enabled(ctx))return [];
 const [rows]=await db.query(select+' ORDER BY f.updated_at DESC,f.id LIMIT 100',[ctx.tenant.id]);
 return rows.map(row=>({id:row.formId,nameEn:row.nameEn,nameAr:row.nameAr,publishedVersion:Number(row.publishedVersion),customFieldCount:Number(row.customFieldCount)}));
}
async function validate(db,ctx,config){
 const id=normalize(config?.captureFormId);if(id===undefined)return;
 if(!supports(ctx?.category))fail('INVALID_CAPTURE_FORM');
 if(id===null)return;
 if(!enabled(ctx))fail('FEATURE_UNAVAILABLE');
 const [rows]=await db.query(select+' AND f.id=? LIMIT 1',[ctx.tenant.id,id]);if(rows.length!==1)fail('CAPTURE_FORM_UNAVAILABLE');
}
async function selectedRows(db,tenantId,id){
 id=normalize(id);if(id===null)return [];
 if(id===undefined)throw Error('EXPLICIT_CAPTURE_FORM_REQUIRED');
 const subscription=await plans.loadEntitlements(db,tenantId),category=require('./categories').trainingCenter;
 if(!enabled({category,subscription}))return [];
 const [rows]=await db.query(select+' AND f.id=? LIMIT 1',[tenantId,id]);return rows;
}
module.exports={supports,normalize,enabled,options,validate,selectedRows};
