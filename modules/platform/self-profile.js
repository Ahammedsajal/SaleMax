'use strict';

const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const isValidEmail=email=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function profileValues(input={},actor={},accountType='user'){
  const name=String(input.name??actor.name??'').trim();
  const email=String(input.email??actor.email??'').trim().toLowerCase();
  const mobile=String(input.mobile??input.mobile_with_country_code??actor.mobile_with_country_code??actor.mobile??'').trim();
  if(!name||name.length>200)fail('INVALID_PROFILE_NAME');
  if(!isValidEmail(email))fail('INVALID_PROFILE_EMAIL');
  if(!mobile||mobile.length>64)fail('INVALID_PROFILE_MOBILE');
  const rawPassword=input.newPassword;
  const password=rawPassword==null?'':String(rawPassword);
  if(password&&(Array.from(password).length<12||Buffer.byteLength(password,'utf8')>72))fail('INVALID_PASSWORD');
  let timezone=String(input.timezone??actor.timezone??'Asia/Qatar').trim();
  if(!timezone)timezone='Asia/Qatar';
  try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{fail('INVALID_TIMEZONE');}
  return {name,email,mobile,password,timezone,accountType};
}

async function saveSelfProfile(db,{actor,input,accountType='user',hashPassword}){
  if(!actor||!actor.id||!actor.uid)fail('PROFILE_ACCOUNT_NOT_FOUND',404);
  if(!['user','agent'].includes(accountType))fail('PROFILE_ACCOUNT_TYPE_INVALID',403);
  const values=profileValues(input,actor,accountType);
  const table=accountType==='agent'?'agents':'user';
  const emailConflict=await db.query(`SELECT id FROM ${table} WHERE email=? AND id<>? LIMIT 1`,[values.email,actor.id]);
  if(emailConflict?.length)fail('PROFILE_EMAIL_IN_USE',409);
  const passwordHash=values.password?await hashPassword(values.password):null;
  if(accountType==='agent'){
    const sql=passwordHash
      ?'UPDATE agents SET name=?,email=?,mobile=?,password=? WHERE id=? AND uid=? AND is_active=1'
      :'UPDATE agents SET name=?,email=?,mobile=? WHERE id=? AND uid=? AND is_active=1';
    const params=passwordHash?[values.name,values.email,values.mobile,passwordHash,actor.id,actor.uid]:[values.name,values.email,values.mobile,actor.id,actor.uid];
    const result=await db.query(sql,params);
    if(!result?.affectedRows){const current=await db.query('SELECT id FROM agents WHERE id=? AND uid=? AND is_active=1',[actor.id,actor.uid]);if(!current?.length)fail('PROFILE_ACCOUNT_NOT_FOUND',404);}
  }else{
    const sql=passwordHash
      ?'UPDATE user SET name=?,email=?,password=?,mobile_with_country_code=?,timezone=? WHERE id=? AND uid=?'
      :'UPDATE user SET name=?,email=?,mobile_with_country_code=?,timezone=? WHERE id=? AND uid=?';
    const params=passwordHash?[values.name,values.email,passwordHash,values.mobile,values.timezone,actor.id,actor.uid]:[values.name,values.email,values.mobile,values.timezone,actor.id,actor.uid];
    const result=await db.query(sql,params);
    if(!result?.affectedRows){const current=await db.query('SELECT id FROM user WHERE id=? AND uid=?',[actor.id,actor.uid]);if(!current?.length)fail('PROFILE_ACCOUNT_NOT_FOUND',404);}
  }
  const passwordChanged=Boolean(passwordHash);
  const emailChanged=values.email!==String(actor.email||'').trim().toLowerCase();
  return {passwordChanged,emailChanged,reloginRequired:passwordChanged||emailChanged,accountType};
}

module.exports={profileValues,saveSelfProfile};
