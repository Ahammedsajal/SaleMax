'use strict';

const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const fail=()=>{throw Object.assign(new Error('INVALID_CUSTOMIZATION_MODULE_SETTINGS'),{code:'INVALID_CUSTOMIZATION_MODULE_SETTINGS',status:400});};
const slug=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{1,63}$/.test(value)&&!['__proto__','prototype','constructor'].includes(value);
const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=80&&!/[<>\u0000-\u001f\u007f]/.test(value);
const localized=value=>plain(value)&&Object.keys(value).length===2&&['en','ar'].every(lang=>text(value[lang]));

function copySchema(schema,capabilities){
  if(!plain(schema)||Object.keys(schema).some(key=>key!=='moduleSettings')||!plain(schema.moduleSettings))fail();
  let size;try{size=Buffer.byteLength(JSON.stringify(schema),'utf8');}catch{fail();}if(size>32*1024)fail();
  const modules=Object.entries(schema.moduleSettings);
  if(modules.length>24)fail();
  const result={moduleSettings:{}};
  for(const [moduleKey,source] of modules.sort(([a],[b])=>a.localeCompare(b))){
    if(!slug(moduleKey)||!plain(source)||Object.keys(source).some(key=>!['capability','fields'].includes(key))||
      typeof source.capability!=='string'||!capabilities.includes(source.capability)||!Array.isArray(source.fields)||source.fields.length<1||source.fields.length>32)fail();
    const seen=new Set();
    const fields=source.fields.map(field=>{
      if(!plain(field)||!slug(field.key)||seen.has(field.key)||!localized(field.label)||!['boolean','integer','text','enum'].includes(field.type))fail();
      seen.add(field.key);
      const base={key:field.key,type:field.type,label:{en:field.label.en.trim(),ar:field.label.ar.trim()}};
      if(field.type==='boolean'){
        if(Object.keys(field).some(key=>!['key','type','label','default'].includes(key))||typeof field.default!=='boolean')fail();
        base.default=field.default;
      }else if(field.type==='integer'){
        if(Object.keys(field).some(key=>!['key','type','label','default','min','max'].includes(key))||!Number.isSafeInteger(field.min)||!Number.isSafeInteger(field.max)||field.min>field.max||!Number.isSafeInteger(field.default)||field.default<field.min||field.default>field.max)fail();
        base.min=field.min;base.max=field.max;base.default=field.default;
      }else if(field.type==='text'){
        if(Object.keys(field).some(key=>!['key','type','label','default','maxLength'].includes(key))||!Number.isSafeInteger(field.maxLength)||field.maxLength<1||field.maxLength>200||typeof field.default!=='string'||field.default.length>field.maxLength||/[<>\u0000-\u001f\u007f]/.test(field.default))fail();
        base.maxLength=field.maxLength;base.default=field.default;
      }else{
        if(Object.keys(field).some(key=>!['key','type','label','default','options'].includes(key))||!Array.isArray(field.options)||field.options.length<1||field.options.length>32)fail();
        const optionKeys=new Set();
        base.options=field.options.map(option=>{
          if(!plain(option)||Object.keys(option).length!==2||!slug(option.key)||optionKeys.has(option.key)||!localized(option.label))fail();
          optionKeys.add(option.key);return {key:option.key,label:{en:option.label.en.trim(),ar:option.label.ar.trim()}};
        });
        if(!optionKeys.has(field.default))fail();
        base.default=field.default;
      }
      return Object.freeze(base);
    });
    result.moduleSettings[moduleKey]=Object.freeze({capability:source.capability,fields:Object.freeze(fields)});
  }
  return Object.freeze({moduleSettings:Object.freeze(result.moduleSettings)});
}

function defaults(schema){
  const value={};
  for(const [moduleKey,module] of Object.entries(schema?.moduleSettings||{}))value[moduleKey]=Object.fromEntries(module.fields.map(field=>[field.key,field.default]));
  return value;
}

function normalize(input,schema){
  if(!plain(input))fail();
  const modules=schema?.moduleSettings||{},result={};
  for(const [moduleKey,values] of Object.entries(input)){
    const definition=modules[moduleKey];
    if(!definition||!Array.isArray(definition.fields)||!plain(values))fail();
    const fields=new Map(definition.fields.map(field=>[field.key,field])),normalized={};
    for(const [key,value] of Object.entries(values)){
      const field=fields.get(key);if(!field)fail();
      if(field.type==='boolean'){if(typeof value!=='boolean')fail();}
      else if(field.type==='integer'){if(!Number.isSafeInteger(value)||value<field.min||value>field.max)fail();}
      else if(field.type==='text'){if(typeof value!=='string'||value.length>field.maxLength||/[<>\u0000-\u001f\u007f]/.test(value))fail();}
      else if(field.type==='enum'){if(!field.options.some(option=>option.key===value))fail();}
      normalized[key]=value;
    }
    if(Object.keys(normalized).length)result[moduleKey]=normalized;
  }
  return result;
}

module.exports={copySchema,defaults,normalize};
