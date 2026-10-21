'use strict';

// Declarative configuration contracts belong to the module that consumes
// them. Values are presentation/workflow defaults only; they never grant
// capabilities, alter data ownership, or authorize a request. Historical
// schemas remain readable so published revision checksums stay verifiable.
const transactionFields=Object.freeze([
  Object.freeze({key:'defaultTransactionType',type:'enum',defaultValue:'sale',label:Object.freeze({en:'Default transaction',ar:'نوع المعاملة الافتراضي'}),options:Object.freeze([
    Object.freeze({value:'sale',label:Object.freeze({en:'For sale',ar:'للبيع'})}),
    Object.freeze({value:'rent',label:Object.freeze({en:'For rent',ar:'للإيجار'})}),
  ])}),
]);
const currencyField=Object.freeze({key:'defaultCurrency',type:'enum',defaultValue:'QAR',label:Object.freeze({en:'Default listing currency',ar:'العملة الافتراضية للإعلان'}),options:Object.freeze([
  Object.freeze({value:'QAR',label:Object.freeze({en:'QAR · Qatari riyal',ar:'QAR · ريال قطري'})}),
  Object.freeze({value:'AED',label:Object.freeze({en:'AED · UAE dirham',ar:'AED · درهم إماراتي'})}),
  Object.freeze({value:'SAR',label:Object.freeze({en:'SAR · Saudi riyal',ar:'SAR · ريال سعودي'})}),
  Object.freeze({value:'USD',label:Object.freeze({en:'USD · US dollar',ar:'USD · دولار أمريكي'})}),
  Object.freeze({value:'INR',label:Object.freeze({en:'INR · Indian rupee',ar:'INR · روبية هندية'})}),
  Object.freeze({value:'GBP',label:Object.freeze({en:'GBP · British pound',ar:'GBP · جنيه إسترليني'})}),
  Object.freeze({value:'EUR',label:Object.freeze({en:'EUR · euro',ar:'EUR · يورو'})}),
])});
const areaUnitField=Object.freeze({key:'areaUnit',type:'enum',defaultValue:'sqm',label:Object.freeze({en:'Area unit',ar:'وحدة المساحة'}),options:Object.freeze([
  Object.freeze({value:'sqm',label:Object.freeze({en:'Square metres (m²)',ar:'متر مربع (م²)'}),}),
  Object.freeze({value:'sqft',label:Object.freeze({en:'Square feet (sq ft)',ar:'قدم مربع (قدم²)'}),}),
])});
const definitions=Object.freeze([
  Object.freeze({moduleId:'real-estate.properties',moduleVersion:1,schemaVersion:1,fields:Object.freeze([...transactionFields,currencyField])}),
  Object.freeze({moduleId:'real-estate.properties',moduleVersion:1,schemaVersion:2,fields:Object.freeze([...transactionFields,currencyField,areaUnitField])}),
]);
const fail=()=>{throw Object.assign(Error('INVALID_MODULE_SETTINGS'),{code:'INVALID_MODULE_SETTINGS',status:400});};
const keyFor=(moduleId,moduleVersion)=>`${moduleId}@${moduleVersion}`;
function get(moduleId,moduleVersion,schemaVersion){
  return definitions.find(item=>item.moduleId===moduleId&&item.moduleVersion===moduleVersion&&item.schemaVersion===schemaVersion)||null;
}
function assertRegistry(moduleRegistry){
  const modules=moduleRegistry.list();
  for(const module of modules){
    if(module.configSchemaVersion!==null&&!get(module.id,module.version,module.configSchemaVersion))throw Object.assign(Error('INVALID_MODULE_MANIFEST'),{code:'INVALID_MODULE_MANIFEST'});
  }
  for(const definition of definitions){
    const module=moduleRegistry.get(definition.moduleId,definition.moduleVersion);
    if(!module||definition.schemaVersion>module.configSchemaVersion)throw Object.assign(Error('INVALID_MODULE_MANIFEST'),{code:'INVALID_MODULE_MANIFEST'});
  }
  for(const module of modules.filter(item=>item.configSchemaVersion!==null)){
    for(let schemaVersion=1;schemaVersion<=module.configSchemaVersion;schemaVersion++)if(!get(module.id,module.version,schemaVersion))throw Object.assign(Error('INVALID_MODULE_MANIFEST'),{code:'INVALID_MODULE_MANIFEST'});
  }
  return true;
}
function defaults(module){
  if(!module||module.configSchemaVersion===null)return null;
  const definition=get(module.id,module.version,module.configSchemaVersion);if(!definition)fail();
  return Object.fromEntries([['schemaVersion',definition.schemaVersion],...definition.fields.map(field=>[field.key,field.defaultValue])]);
}
function normalize(module,input){
  if(!module||module.configSchemaVersion===null||!input||typeof input!=='object'||Array.isArray(input)||Object.getPrototypeOf(input)!==Object.prototype||!Number.isSafeInteger(input.schemaVersion)||input.schemaVersion<1||input.schemaVersion>module.configSchemaVersion)fail();
  const definition=get(module.id,module.version,input.schemaVersion);
  if(!definition)fail();
  const fields=new Map(definition.fields.map(field=>[field.key,field]));
  if(Object.keys(input).some(key=>key!=='schemaVersion'&&!fields.has(key)))fail();
  const result={schemaVersion:definition.schemaVersion};
  for(const field of definition.fields){
    const value=Object.hasOwn(input,field.key)?input[field.key]:field.defaultValue;
    if(field.type==='enum'&&!field.options.some(option=>option.value===value))fail();
    result[field.key]=value;
  }
  return result;
}
function migrate(module,input){
  const stored=normalize(module,input),target=defaults(module),targetDefinition=get(module.id,module.version,target.schemaVersion);
  const targetFields=new Set(targetDefinition.fields.map(field=>field.key));
  if(Object.keys(stored).some(key=>key!=='schemaVersion'&&!targetFields.has(key)))fail();
  return normalize(module,{...target,...Object.fromEntries(Object.entries(stored).filter(([key])=>key!=='schemaVersion'))});
}
function describe(module){
  const definition=module&&get(module.id,module.version,module.configSchemaVersion);
  if(!definition)return null;
  return {schemaVersion:definition.schemaVersion,fields:definition.fields.map(field=>({key:field.key,type:field.type,defaultValue:field.defaultValue,label:{...field.label},options:field.options.map(option=>({value:option.value,label:{...option.label}}))}))};
}
function moduleKey(moduleId,moduleVersion){return keyFor(moduleId,moduleVersion);}
module.exports={definitions,assertRegistry,get,defaults,normalize,migrate,describe,moduleKey};
