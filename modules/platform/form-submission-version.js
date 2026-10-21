'use strict';
function normalize(value){
 if(value===undefined)return undefined; // Older clients remain compatible during rollout.
 if(!Number.isSafeInteger(value)||value<1)throw Object.assign(new Error('INVALID_FORM_VERSION'),{code:'INVALID_FORM_VERSION',status:400});
 return value;
}
function assertCurrent(expected,current){
 normalize(expected);
 if(expected!==undefined&&expected!==Number(current))throw Object.assign(new Error('FORM_VERSION_CHANGED'),{code:'FORM_VERSION_CHANGED',status:409});
}
async function replay(db,{tenantId,formId,tokenHash}){
 const [[prior]]=await db.query(`SELECT s.id,s.reference_code,s.lead_id,v.schema_json
 FROM sx_training_form_submissions s JOIN sx_training_form_versions v ON v.tenant_id=s.tenant_id AND v.form_id=s.form_id AND v.version=s.form_version
 WHERE s.tenant_id=? AND s.form_id=? AND s.idempotency_hash=? LIMIT 1`,[tenantId,formId,tokenHash]);
 if(!prior)return null;
 const schema=typeof prior.schema_json==='string'?JSON.parse(prior.schema_json):prior.schema_json;
 const registration=schema?.templateKey==='procatalyst-registration-v1';
 return {...(registration?await require('./training-registration-selections').previous(db,tenantId,prior.id):{}),referenceCode:prior.reference_code,leadId:prior.lead_id,repeated:true};
}
module.exports={normalize,assertCurrent,replay};
