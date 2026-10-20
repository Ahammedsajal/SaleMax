'use strict';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const types=Object.freeze(['text','integer','boolean','date']);
function label(value){
 if(!plain(value)||Object.keys(value).length!==2||!['en','ar'].every(lang=>typeof value[lang]==='string'&&value[lang].trim()&&value[lang].length<=80&&!/[<>\u0000-\u001f\u007f]/.test(value[lang])))fail('INVALID_LEAD_FIELD_LABEL');
 return {en:value.en.trim(),ar:value.ar.trim()};
}
function definitions(input){
 if(!Array.isArray(input)||input.length>24)fail('INVALID_LEAD_FIELDS');
 const seen=new Set();
 return input.map(field=>{
  if(!plain(field)||Object.keys(field).length!==6||Object.keys(field).some(key=>!['key','type','label','required','active','version'].includes(key))||!types.includes(field.type)||field.version!==1||typeof field.required!=='boolean'||typeof field.active!=='boolean'||typeof field.key!=='string'||!new RegExp('^cf_'+field.type+'_[a-f0-9]{16}$').test(field.key)||seen.has(field.key))fail('INVALID_LEAD_FIELD');
  seen.add(field.key);
  return {key:field.key,type:field.type,label:label(field.label),required:field.required,active:field.active,version:1};
 });
}
function valueFor(field,value){
 if(value===null||value==='')return null;
 if(field.type==='text'){
  if(typeof value!=='string'||value.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail('INVALID_LEAD_FIELD_VALUE');
  return value.trim()||null;
 }
 if(field.type==='integer'){if(!Number.isSafeInteger(value)||Math.abs(value)>1000000000000)fail('INVALID_LEAD_FIELD_VALUE');return value;}
 if(field.type==='boolean'){if(typeof value!=='boolean')fail('INVALID_LEAD_FIELD_VALUE');return value;}
 if(field.type==='date'){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail('INVALID_LEAD_FIELD_VALUE');
  return value;
 }
 fail('INVALID_LEAD_FIELD');
}
function save(contract,input,prior={}){
 if(!plain(input)||Object.keys(input).length!==2||!Number.isSafeInteger(input.configurationRevision)||!plain(input.values))fail('INVALID_LEAD_FIELD_VALUES');
 if(input.configurationRevision!==contract.revision)fail('STALE_LEAD_FIELD_CONFIGURATION',409);
 const fields=definitions(contract.fields),active=new Map(fields.filter(field=>field.active).map(field=>[field.key,field]));
 if(Object.keys(input.values).some(key=>!active.has(key)))fail('UNKNOWN_LEAD_FIELD');
 const saved=plain(prior)?structuredClone(prior):{};
 for(const field of active.values()){
  // Payload is a patch: absent optional fields retain their historical snapshot.
  const supplied=Object.hasOwn(input.values,field.key),existing=saved[field.key]?.value;
  const value=supplied?valueFor(field,input.values[field.key]):existing??null;
  if(field.required&&(value===null||value===''))fail('REQUIRED_LEAD_FIELD');
  if(!supplied)continue;
  saved[field.key]={value,definition:field,configurationRevision:contract.revision};
 }
 // Bound accumulated historical snapshots independently of active field count.
 if(Object.keys(saved).length>120||Buffer.byteLength(JSON.stringify(saved),'utf8')>128*1024)fail('LEAD_FIELD_HISTORY_LIMIT',413);
 return saved;
}
function publicContract(configuration){return {revision:configuration.revision,fields:definitions(configuration.document.leadFields||[])};}
module.exports={definitions,save,valueFor,publicContract,types};
