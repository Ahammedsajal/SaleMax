'use strict';

const PERMISSION_STATUSES=new Set(['pending','requested','granted','denied','expired']);
const CALL_STATUSES=new Set(['pending','ringing','answered','completed','failed','rejected']);
const UPDATE_FIELDS=new Set([
  'permission_status','permission_requested_at','permission_granted_at','permission_expires_at','permission_type',
  'call_status','call_id','call_initiated_at','call_completed_at','call_duration','error_message','retry_count',
]);
const TIMESTAMP_FIELDS=new Set(['permission_requested_at','permission_granted_at','permission_expires_at','call_initiated_at','call_completed_at']);

function fail(code){const error=new Error(code);error.code=code;throw error;}
function sanitizeUpdates(value){
  if(!value||typeof value!=='object'||Array.isArray(value))fail('INVALID_CALLBACK');
  const keys=Object.keys(value);
  if(!keys.length||keys.some(key=>!UPDATE_FIELDS.has(key)))fail('INVALID_CALLBACK');
  const updates={};
  for(const key of keys){
    const item=value[key];
    if(key==='permission_status'&&(!PERMISSION_STATUSES.has(item)))fail('INVALID_CALLBACK');
    if(key==='call_status'&&(!CALL_STATUSES.has(item)))fail('INVALID_CALLBACK');
    if(key==='permission_type'&&item!==null&&!['temporary','permanent'].includes(item))fail('INVALID_CALLBACK');
    if(TIMESTAMP_FIELDS.has(key)&&item!==null&&(typeof item!=='string'||item.length>64||!Number.isFinite(Date.parse(item))))fail('INVALID_CALLBACK');
    if(key==='call_id'&&item!==null&&(typeof item!=='string'||!item.trim()||item.length>191))fail('INVALID_CALLBACK');
    if(key==='error_message'&&item!==null&&(typeof item!=='string'||item.length>255))fail('INVALID_CALLBACK');
    if(key==='call_duration'&&item!==null&&(!Number.isSafeInteger(item)||item<0||item>86400))fail('INVALID_CALLBACK');
    if(key==='retry_count'&&(!Number.isSafeInteger(item)||item<0||item>100))fail('INVALID_CALLBACK');
    updates[key]=item;
  }
  return updates;
}

function parseContacts(value){
  let contacts;
  try{contacts=typeof value==='string'?JSON.parse(value||'[]'):value;}catch{fail('CAMPAIGN_DATA_INVALID');}
  if(!Array.isArray(contacts))fail('CAMPAIGN_DATA_INVALID');
  return contacts;
}

async function updateBroadcastContact(pool,{campaignId,uid,contactMobile,updates:rawUpdates}={}){
  if(typeof campaignId!=='string'||!campaignId.trim()||campaignId.length>128||typeof uid!=='string'||!uid.trim()||uid.length>255||typeof contactMobile!=='string'||!contactMobile.trim()||contactMobile.length>40)fail('INVALID_CALLBACK');
  const updates=sanitizeUpdates(rawUpdates);
  const db=await pool.getConnection();
  let begun=false;
  try{
    await db.beginTransaction();begun=true;
    const [rows]=await db.query('SELECT * FROM wa_call_broadcasts WHERE campaign_id = ? AND uid = ? LIMIT 1 FOR UPDATE',[campaignId,uid]);
    const broadcast=rows[0];
    if(!broadcast){await db.rollback();begun=false;return {updated:false,code:'BROADCAST_NOT_FOUND'};}
    if(broadcast.uid!==uid)fail('CAMPAIGN_OWNER_INVALID');
    const contacts=parseContacts(broadcast.contacts);
    const index=contacts.findIndex(contact=>contact&&contact.mobile===contactMobile);
    if(index<0){await db.rollback();begun=false;return {updated:false,code:'CONTACT_NOT_FOUND'};}
    const previous=contacts[index];
    contacts[index]={...previous,...updates};
    const stats={};
    const increment=(inputKey,status,statKey)=>{
      if(updates[inputKey]===status&&previous[inputKey]!==status)stats[statKey]=Number(broadcast[statKey]||0)+1;
    };
    increment('permission_status','requested','permission_requested');
    increment('permission_status','granted','permission_granted');
    increment('permission_status','denied','permission_denied');
    increment('call_status','ringing','calls_initiated');
    increment('call_status','completed','calls_completed');
    increment('call_status','failed','calls_failed');

    const columns=['contacts = ?'];
    const params=[JSON.stringify(contacts)];
    for(const [column,value] of Object.entries(stats)){columns.push(`${column} = ?`);params.push(value);}
    params.push(campaignId,uid);
    await db.query(`UPDATE wa_call_broadcasts SET ${columns.join(', ')} WHERE campaign_id = ? AND uid = ?`,params);
    await db.commit();begun=false;
    return {updated:true};
  }catch(error){if(begun)try{await db.rollback();}catch{}throw error;}
  finally{db.release();}
}

module.exports={sanitizeUpdates,updateBroadcastContact};
