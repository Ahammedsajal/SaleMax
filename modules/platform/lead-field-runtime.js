'use strict';
const crypto=require('node:crypto');
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
async function contractForOwner(db,uid,{lock=false}={}){
 const empty={revision:0,fields:[]};
 if(process.env.SALEMAX_PLATFORM_ENABLED!=='true')return empty;
 const [rows]=await db.query(`SELECT t.id,t.status,t.category_key,t.category_version,h.active_id,m.id AS membership_id,m.identity_id,m.status AS membership_status
  FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
  JOIN sx_tenants t ON t.id=o.tenant_id JOIN sx_memberships m ON m.tenant_id=t.id AND m.id=o.membership_id AND m.role='owner' AND m.status='active'
  JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
  LEFT JOIN sx_tenant_customization_heads h ON h.tenant_id=t.id
  WHERE u.uid=? AND o.legacy_uid_hash=? LIMIT 2${lock?' FOR UPDATE':''}`,[uid,crypto.createHash('sha256').update(String(uid)).digest('hex')]);
 if(!rows.length)return empty; // Legacy accounts remain unmapped.
 if(rows.length!==1)fail('BUSINESS_LINK_INVALID');
 const row=rows[0];if(row.status!=='active')fail('ACCOUNT_INACTIVE',403);
 const categories=require('./categories'),category=categories.getCategory(row.category_key,Number(row.category_version));if(!category)fail('CATEGORY_UNAVAILABLE');
 const entitlement=await require('./plans').loadEntitlements(db,row.id);
 const subscription=entitlement?{...entitlement,categoryKey:categories.canonicalCategoryKey(entitlement.categoryKey)}:null;
 const context={audience:'tenant',tenant:{id:row.id,status:row.status,categoryKey:category.key,categoryVersion:Number(row.category_version)},membership:{id:row.membership_id,identityId:row.identity_id,tenantId:row.id,role:'owner',status:row.membership_status},identity:{id:row.identity_id},category,subscription};
 if(!require('./policy').decision(context,{capability:'crm.leads',permission:'leads.read'}).allowed)return {...empty,available:false};
 if(!row.active_id)return {...empty,available:true};
 const [[document]]=await db.query("SELECT * FROM sx_tenant_customization_revisions WHERE tenant_id=? AND id=? AND kind='published'",[row.id,row.active_id]);
 if(!document)fail('CUSTOMIZATION_NOT_FOUND');
 const active=require('./tenant-customization').decode({tenant:{id:row.id,categoryKey:category.key,categoryVersion:category.version},category},document);
 return {...require('./lead-field-contract').publicContract({revision:active.revision,document:active.document}),available:true};
}
function qualification(raw){if(typeof raw==='string'){try{return JSON.parse(raw)||{};}catch{return {};}}return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};}
async function save(db,uid,input,priorRaw,{creating=false}={}){
 const prior=qualification(priorRaw).customFields||{};
 if(input===undefined&&!creating)return prior;
 const contract=await contractForOwner(db,uid,{lock:true});
 if(contract.available===false&&Object.keys(input?.values||{}).length)fail('FEATURE_UNAVAILABLE',409);
 if(input===undefined)input={configurationRevision:contract.revision,values:{}};
 return require('./lead-field-contract').save(contract,input,prior);
}
module.exports={contractForOwner,save,qualification};
