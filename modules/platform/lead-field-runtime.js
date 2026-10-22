'use strict';
const crypto=require('node:crypto');
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
async function contractForOwner(db,uid,{lock=false}={}){
 if(process.env.SALEMAX_PLATFORM_ENABLED!=='true')return {revision:0,fields:[]};
 const [rows]=await db.query(`SELECT t.id,t.status,t.category_key,t.category_version,h.active_id
  FROM user u JOIN sx_legacy_ownership o ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
  JOIN sx_tenants t ON t.id=o.tenant_id JOIN sx_memberships m ON m.tenant_id=t.id AND m.id=o.membership_id AND m.role='owner' AND m.status='active'
  LEFT JOIN sx_tenant_customization_heads h ON h.tenant_id=t.id
  WHERE u.uid=? AND o.legacy_uid_hash=? LIMIT 2${lock?' FOR UPDATE':''}`,[uid,crypto.createHash('sha256').update(String(uid)).digest('hex')]);
 if(!rows.length)return {revision:0,fields:[]}; // Legacy accounts remain unmapped.
 if(rows.length!==1)fail('BUSINESS_LINK_INVALID');
 const row=rows[0];if(row.status!=='active')fail('ACCOUNT_INACTIVE',403);
 const category=require('./categories').getCategory(row.category_key,Number(row.category_version));if(!category)fail('CATEGORY_UNAVAILABLE');
 const context={tenant:{id:row.id,categoryKey:category.key,categoryVersion:category.version},category};
 if(!row.active_id)return require('./lead-field-contract').publicContract({revision:0,document:require('./tenant-customization').resolved(context,null,0).value});
 const [[document]]=await db.query("SELECT * FROM sx_tenant_customization_revisions WHERE tenant_id=? AND id=? AND kind='published'",[row.id,row.active_id]);
 if(!document)fail('CUSTOMIZATION_NOT_FOUND');
 const active=require('./tenant-customization').decode(context,document);
 const resolved=require('./tenant-customization').resolved(context,active.document,active.revision);
 return require('./lead-field-contract').publicContract({revision:active.revision,document:resolved.value});
}
function qualification(raw){if(typeof raw==='string'){try{return JSON.parse(raw)||{};}catch{return {};}}return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};}
async function save(db,uid,input,priorRaw,{creating=false}={}){
 const prior=qualification(priorRaw).customFields||{};
 if(input===undefined&&!creating)return prior;
 const contract=await contractForOwner(db,uid,{lock:true});
 if(input===undefined)input={configurationRevision:contract.revision,values:{}};
 return require('./lead-field-contract').save(contract,input,prior);
}
module.exports={contractForOwner,save,qualification};
