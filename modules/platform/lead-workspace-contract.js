'use strict';
const crypto=require('node:crypto');
const {getCategory}=require('./categories');
const plans=require('./plans');
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
// Presentation contract only. Every workflow keeps its existing server policy.
function definition(category,subscription){
 const training=Boolean(category?.capabilities.includes('training.courses'));
 const enabled=capability=>Boolean(category?.capabilities.includes(capability)&&['active','trial','grace'].includes(subscription?.status)&&subscription.capabilities?.includes(capability)&&subscription.categoryKey===category.key&&subscription.categoryVersion===category.version);
 return {version:1,category:category?{key:category.key,version:category.version}:null,profile:training?'training':'shared',workflows:{courses:enabled('training.courses'),forms:training&&enabled('portal.forms'),saleReviews:training&&enabled('training.courses')&&enabled('training.enrollments')}};
}
async function forOwner(db,uid){
 if(process.env.SALEMAX_PLATFORM_ENABLED!=='true')return definition(null,null);
 const [rows]=await db.query(`SELECT o.tenant_id,o.legacy_uid_hash,t.status AS tenant_status,t.category_key,t.category_version,m.role AS owner_role,m.status AS membership_status,i.status AS identity_status
 FROM user u LEFT JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
 LEFT JOIN sx_tenants t ON t.id=o.tenant_id LEFT JOIN sx_memberships m ON m.id=o.membership_id AND m.tenant_id=o.tenant_id
 LEFT JOIN sx_identities i ON i.id=m.identity_id WHERE u.uid=? LIMIT 2`,[uid]);
 if(!rows.length||rows.length===1&&!rows[0].tenant_id)return definition(null,null);
 if(rows.length!==1)fail('BUSINESS_LINK_INVALID');const row=rows[0];
 if(row.legacy_uid_hash!==crypto.createHash('sha256').update(String(uid)).digest('hex')||row.owner_role!=='owner'||row.membership_status!=='active'||row.identity_status!=='active')fail('BUSINESS_LINK_INVALID');
 if(row.tenant_status!=='active')fail('ACCOUNT_INACTIVE',403);
 const category=getCategory(row.category_key,Number(row.category_version));if(!category)fail('CATEGORY_UNAVAILABLE');
 return definition(category,await plans.loadEntitlements(db,row.tenant_id));
}
module.exports={definition,forOwner};
