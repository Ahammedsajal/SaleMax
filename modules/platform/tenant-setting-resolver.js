'use strict';

const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const fail=()=>{throw Object.assign(new Error('INVALID_SETTING_LAYER'),{code:'INVALID_SETTING_LAYER',status:500});};

function source(scope,metadata={}) {
  if(!['platform','category_version','tenant'].includes(scope))fail();
  const result={scope};
  if(scope==='category_version'){
    if(typeof metadata.categoryKey!=='string'||!Number.isSafeInteger(metadata.categoryVersion)||metadata.categoryVersion<1)fail();
    result.categoryKey=metadata.categoryKey;result.categoryVersion=metadata.categoryVersion;
  }
  if(scope==='tenant'){
    if(!Number.isSafeInteger(metadata.revision)||metadata.revision<0)fail();
    result.revision=metadata.revision;
  }
  return Object.freeze(result);
}

function assertLayer(value,depth=0) {
  if(depth>16)fail();
  if(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return;
  if(Array.isArray(value)){for(const item of value)assertLayer(item,depth+1);return;}
  if(!plain(value))fail();
  for(const [key,item] of Object.entries(value)){
    if(!/^[A-Za-z0-9_-]{1,160}$/.test(key)||['__proto__','prototype','constructor'].includes(key))fail();
    assertLayer(item,depth+1);
  }
}

function clearPaths(record,path) {
  for(const key of Object.keys(record))if(key===path||key.startsWith(`${path}.`))delete record[key];
}
function atPath(record,path) {
  let value=record;
  for(const key of path.split('.')){
    if(!plain(value)||!Object.hasOwn(value,key))return {found:false,value:undefined};
    value=value[key];
  }
  return {found:true,value};
}
function apply(target,overrides,layerSource,path,provenance,deleted) {
  for(const [key,value] of Object.entries(overrides)){
    const nextPath=path?`${path}.${key}`:key;
    if(value===null){delete target[key];clearPaths(provenance,nextPath);clearPaths(deleted,nextPath);deleted[nextPath]=layerSource;continue;}
    if(plain(value)){
      if(!plain(target[key])){clearPaths(provenance,nextPath);clearPaths(deleted,nextPath);target[key]={};}
      else {delete provenance[nextPath];delete deleted[nextPath];}
      apply(target[key],value,layerSource,nextPath,provenance,deleted);
    }else{
      clearPaths(provenance,nextPath);clearPaths(deleted,nextPath);
      target[key]=structuredClone(value);
      provenance[nextPath]=layerSource;
      // Lists are atomic values: an explicit [] replaces an inherited list.
    }
  }
}
function applyTenant(target,overrides,platform,layerSource,path,provenance,deleted) {
  for(const [key,value] of Object.entries(overrides)){
    const nextPath=path?`${path}.${key}`:key;
    if(value===null){
      const fallback=atPath(platform,nextPath);
      delete target[key];clearPaths(provenance,nextPath);clearPaths(deleted,nextPath);
      if(fallback.found&&fallback.value!==null){
        if(plain(fallback.value)){target[key]={};apply(target[key],fallback.value,source('platform'),nextPath,provenance,deleted);}
        else {target[key]=structuredClone(fallback.value);provenance[nextPath]=source('platform');}
      }
      deleted[nextPath]=layerSource;
      continue;
    }
    if(plain(value)){
      if(!plain(target[key])){clearPaths(provenance,nextPath);clearPaths(deleted,nextPath);target[key]={};}
      else {delete provenance[nextPath];delete deleted[nextPath];}
      applyTenant(target[key],value,platform,layerSource,nextPath,provenance,deleted);
    }else{
      clearPaths(provenance,nextPath);clearPaths(deleted,nextPath);
      target[key]=structuredClone(value);provenance[nextPath]=layerSource;
    }
  }
}

function resolve({platform={},category={},tenant={},categoryKey,categoryVersion,tenantRevision=0}) {
  for(const layer of [platform,category,tenant]){if(!plain(layer))fail();assertLayer(layer);}
  const value={},provenance={},deleted={};
  apply(value,platform,source('platform'),'',provenance,deleted);
  apply(value,category,source('category_version',{categoryKey,categoryVersion}),'',provenance,deleted);
  applyTenant(value,tenant,platform,source('tenant',{revision:tenantRevision}),'',provenance,deleted);
  return {value,provenance,deleted};
}

module.exports={resolve};
