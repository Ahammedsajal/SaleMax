'use strict';

const fields={
  certificate_name:255,
  qid:11,
  nationality:120,
  birth_date:10,
  address:255,
  city:120,
  local_address:255,
  city_state:120,
  phone_res:40,
  emergency_phone:40,
  social_contact:255,
  referral_name:255,
  gender:20,
  graduated:10,
  source:40,
};

function parse(value){
  if(typeof value==='string')try{value=JSON.parse(value);}catch{value={};}
  return value&&typeof value==='object'&&!Array.isArray(value)?{...value}:{};
}

function fieldKeys(schema){
  return new Set((Array.isArray(schema?.fields)?schema.fields:[]).map(field=>field?.key).filter(key=>Object.hasOwn(fields,key)));
}

function profileFromSubmission(schema,data){
  const profile={};
  for(const key of fieldKeys(schema)){
    const raw=data?.[key];
    if(raw===undefined||raw===null||raw==='')continue;
    if(typeof raw!=='string'||raw.length>fields[key])throw Object.assign(new Error('INVALID_SUBMISSION'),{code:'INVALID_SUBMISSION'});
    const value=raw.trim();if(value)profile[key]=value;
  }
  return profile;
}

function mergeSubmitted(existing,schema,data){
  const qualification=parse(existing),changed=[];
  for(const key of fieldKeys(schema)){
    const raw=data?.[key];
    if(raw===undefined||raw===null||raw===''){
      if(Object.hasOwn(qualification,key)){delete qualification[key];changed.push(key);}
      continue;
    }
    if(typeof raw!=='string'||raw.length>fields[key])throw Object.assign(new Error('INVALID_SUBMISSION'),{code:'INVALID_SUBMISSION'});
    const value=raw.trim();
    if(!value){if(Object.hasOwn(qualification,key)){delete qualification[key];changed.push(key);}continue;}
    if(qualification[key]!==value){qualification[key]=value;changed.push(key);}
  }
  return {qualification,changed};
}

function fillMissing(existing,applicationData){
  const qualification=parse(existing),data=typeof applicationData==='string'?parse(applicationData):parse(applicationData);
  for(const [key,limit] of Object.entries(fields)){
    if(qualification[key]!==undefined&&qualification[key]!==null&&String(qualification[key]).trim())continue;
    const raw=data[key];if(typeof raw!=='string'||!raw.trim()||raw.length>limit)continue;
    qualification[key]=raw.trim();
  }
  return qualification;
}

module.exports={profileFromSubmission,mergeSubmitted,fillMissing};
