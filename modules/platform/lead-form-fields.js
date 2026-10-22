'use strict';
const fields=require('./lead-field-contract');
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
function normalize(value){
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||!Number.isSafeInteger(value.configurationRevision)||value.configurationRevision<0||!Array.isArray(value.fields)||!value.fields.length)fail('INVALID_FORM_LEAD_FIELDS');
 const definitions=fields.definitions(value.fields);if(definitions.some(field=>!field.active))fail('INVALID_FORM_LEAD_FIELDS');
 return {configurationRevision:value.configurationRevision,fields:definitions};
}
async function options(db,ctx,{lock=false}={}){
 const [[row]]=await db.query(`SELECT r.* FROM sx_tenant_customization_heads h JOIN sx_tenant_customization_revisions r ON r.tenant_id=h.tenant_id AND r.id=h.active_id AND r.kind='published' WHERE h.tenant_id=?${lock?' FOR UPDATE':''}`,[ctx.tenant.id]);
 const customization=require('./tenant-customization');
 if(!row)return fields.publicContract({revision:0,document:customization.resolved(ctx,null,0).value});
 const active=customization.decode(ctx,row),resolved=customization.resolved(ctx,active.document,active.revision);
 return fields.publicContract({revision:active.revision,document:resolved.value});
}
async function validateDraft(db,ctx,value){
 const selected=normalize(value);if(!selected)return;
 const current=await options(db,ctx,{lock:true});if(selected.configurationRevision!==current.revision)fail('STALE_LEAD_FIELD_CONFIGURATION',409);
 for(const requested of selected.fields){
  const actual=current.fields.find(field=>field.key===requested.key&&field.active);
  if(!actual)fail('UNKNOWN_LEAD_FIELD');
  // Only the form's required switch may differ from the published definition.
  if(JSON.stringify({...requested,required:actual.required})!==JSON.stringify(actual))fail('INVALID_FORM_LEAD_FIELDS');
 }
}
function contract(value){const selected=normalize(value);return selected?{revision:selected.configurationRevision,fields:selected.fields}:null;}
function save(value,input,prior={}){
 const pinned=contract(value);
 if(!pinned){if(input!==undefined)fail('UNKNOWN_LEAD_FIELD');return {};}
 return fields.save(pinned,{configurationRevision:pinned.revision,values:input===undefined?{}:input},prior);
}
function values(snapshots){return Object.fromEntries(Object.entries(snapshots||{}).map(([key,snapshot])=>[key,snapshot.value]));}
module.exports={normalize,options,validateDraft,contract,save,values};
