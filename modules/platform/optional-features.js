'use strict';
const crypto=require('node:crypto');
const {platformDecision}=require('./policy');
const portfolio=require('./user-portfolio');
const keys=Object.freeze(['chat_widget','customer_api','webhooks','whatsapp_warmer']);
const defaults=()=>Object.fromEntries(keys.map(key=>[key,false]));
const fail=code=>{throw Object.assign(new Error(code),{code});};
function project(row){return {features:Object.fromEntries(keys.map(key=>[key,Number(row?.[key])===1])),revision:Number(row?.revision||0)};}
async function read(db,id){
  id=portfolio.userId(id);
  const [[user]]=await db.query('SELECT id FROM user WHERE id=?',[id]);if(!user)fail('USER_NOT_FOUND');
  const [[row]]=await db.query('SELECT * FROM sx_user_optional_features WHERE legacy_user_id=?',[id]);
  return {userId:id,...project(row)};
}
async function save(db,context,id,input){
  if(!platformDecision(context,'plans.assign'))fail('PERMISSION_DENIED');
  id=portfolio.userId(id);
  if(!input||typeof input!=='object'||!input.features||typeof input.features!=='object'||Array.isArray(input.features)||Object.keys(input.features).length!==keys.length||keys.some(key=>typeof input.features[key]!=='boolean')||!Number.isSafeInteger(input.revision)||input.revision<0)fail('INVALID_FEATURE_SETTINGS');
  await db.beginTransaction();
  try{
    await portfolio.requireAccess(db,context,id);
    const [[user]]=await db.query('SELECT id FROM user WHERE id=? FOR UPDATE',[id]);if(!user)fail('USER_NOT_FOUND');
    const before=await read(db,id);if(before.revision!==input.revision)fail('STALE_FEATURE_SETTINGS');
    await db.query(`INSERT INTO sx_user_optional_features(legacy_user_id,chat_widget,customer_api,webhooks,whatsapp_warmer,revision) VALUES (?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE chat_widget=VALUES(chat_widget),customer_api=VALUES(customer_api),webhooks=VALUES(webhooks),whatsapp_warmer=VALUES(whatsapp_warmer),revision=VALUES(revision)`,[id,...keys.map(key=>Number(input.features[key])),before.revision+1]);
    await db.query(`INSERT INTO sx_audit_events(id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id)
      VALUES (?,?,'identity','user.optional-features-updated','platform-user',?,?,?)`,[crypto.randomUUID(),context.identity.id,String(id),JSON.stringify({before:before.features,after:input.features}),crypto.randomUUID()]);
    await db.commit();return {userId:id,features:input.features,revision:before.revision+1};
  }catch(error){await db.rollback();throw error;}
}
// Used by legacy routes and workers after identifying the owning account.
async function enabledForUid(uid,key,query=require('../../database/dbpromise').query){
  if(!keys.includes(key)||typeof uid!=='string'||!uid)return false;
  try{const rows=await query(`SELECT f.${key} AS enabled FROM user u LEFT JOIN sx_user_optional_features f ON f.legacy_user_id=u.id WHERE u.uid=?`,[uid]);return rows.length===1&&Number(rows[0].enabled)===1;}catch{return false;}
}
function featureForRequest(req){
  const path=(req.baseUrl||'')+(req.path||'');
  if(path.startsWith('/api/webhook/'))return 'webhooks';
  if(path.startsWith('/api/user/')){
    if(['/add_widget','/get_my_widget','/del_widget'].includes(req.path))return 'chat_widget';
    if(['/generate_api_keys','/get_api_dashboard'].includes(req.path))return 'customer_api';
    if(['/add_warmer_message','/get_warmer_script','/del_warmer_msg','/add_ins_to_warm','/get_my_warmer','/change_warmer_status'].includes(req.path))return 'whatsapp_warmer';
  }
  if(path.startsWith('/api/chatbot/')&&req.body?.origin?.code==='WEBHOOK_AUTOMATION')return 'webhooks';
  return null;
}
module.exports={keys,defaults,project,read,save,enabledForUid,featureForRequest};
