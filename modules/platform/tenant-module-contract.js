'use strict';

const {capabilities}=require('./policy');
const {configurableModules}=require('./workspace-module-registry');
// Labels, dependency checks and the set of modules safe to disable are one
// reviewed source contract. A category or plan still has to grant each key.
const labels=Object.freeze(Object.fromEntries(configurableModules.map(module=>[module.capability,module.label])));
const apiEnforcedModules=new Set(configurableModules.map(module=>module.capability));
const dependencies=Object.freeze(Object.fromEntries(configurableModules.filter(module=>module.requires?.length).map(module=>[module.capability,module.requires])));

function allowedKeys(ctx){
  const categoryKeys=Array.isArray(ctx?.category?.capabilities)?ctx.category.capabilities:[];
  return new Set(categoryKeys.filter(key=>apiEnforcedModules.has(key)&&Object.hasOwn(capabilities,key)&&Object.hasOwn(labels,key)));
}

function options(ctx){
  const allowed=allowedKeys(ctx),plan=new Set(ctx?.subscription?.capabilities||[]);
  const internalRecruitment=ctx?.category?.key==='7network_sales'&&ctx?.membership?.role==='owner';
  return [...allowed].filter(key=>plan.has(key)||(key==='hr.recruitment'&&internalRecruitment))
    .sort().map(key=>({key,label:labels[key],requires:(dependencies[key]||[]).filter(required=>allowed.has(required)&&(plan.has(required)||(required==='hr.recruitment'&&internalRecruitment)))}));
}

function isDisabled(ctx,key){
  const disabled=ctx?.tenant?.disabledModules;
  if(!Array.isArray(disabled))return false;
  return disabled.includes(key)||(dependencies[key]||[]).some(required=>disabled.includes(required));
}

module.exports={allowedKeys,options,labels,apiEnforcedModules,dependencies,isDisabled};
