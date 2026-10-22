'use strict';
const crypto=require('node:crypto');
const {categoryKeyMatches}=require('./categories');

function fail(code,status=400,row){const error=new Error(code);error.code=code;error.status=status;if(row)error.row=row;throw error;}

function normalizeRows(rows,pipeline){
  if(!Array.isArray(rows)||rows.length<1||rows.length>100)fail('INVALID_IMPORT_ROWS');
  const seen=new Set();
  return rows.map((row,index)=>{
    const number=index+1;
    if(!row||typeof row!=='object'||Array.isArray(row))fail('INVALID_IMPORT_ROW',400,number);
    if(typeof row.title!=='string'||typeof row.name!=='string'||typeof row.phone!=='string')fail('INVALID_IMPORT_ROW',400,number);
    if((row.email!==undefined&&row.email!==null&&typeof row.email!=='string')||(row.agent_email!==undefined&&row.agent_email!==null&&typeof row.agent_email!=='string'))fail('INVALID_IMPORT_ROW',400,number);
    const title=row.title.trim(),contactName=row.name.trim(),mobile=pipeline.normalizePhone(row.phone);
    let email=null,agentEmail=null;
    try{if(row.email)email=pipeline.normalizeEmail(row.email);if(row.agent_email)agentEmail=pipeline.normalizeEmail(row.agent_email);}catch(_){fail('INVALID_IMPORT_ROW',400,number);}
    if(!title||title.length>180||!contactName||contactName.length>255||!/^\s*\+[1-9][\d\s().-]{6,18}$/.test(row.phone)||!mobile||row.email&&!email||row.agent_email&&!agentEmail)fail('INVALID_IMPORT_ROW',400,number);
    let expectedValue=null;
    if(row.expected_value!==undefined&&row.expected_value!==''){
      const raw=String(row.expected_value).trim(),value=Number(raw);
      if(!Number.isFinite(value)||value<0||!/^\d{1,10}(?:\.\d{1,2})?$/.test(raw))fail('INVALID_IMPORT_ROW',400,number);
      expectedValue=value;
    }
    const currency=String(row.currency||'INR').trim().toUpperCase();
    if(!/^[A-Z]{3}$/.test(currency))fail('INVALID_IMPORT_ROW',400,number);
    const key=`${mobile}|${title.toLocaleLowerCase('en').trim()}`;
    if(seen.has(key))fail('DUPLICATE_IMPORT_ROW',409,number);
    seen.add(key);
    return {row:number,title,contactName,mobile,email,expectedValue,currency,agentEmail};
  });
}

async function importBatch({pool,pipeline,actor,rows}){
  if(!categoryKeyMatches(actor?.categoryKey,'7network_sales')||actor?.role!=='owner')fail('PERMISSION_DENIED',403);
  if(Buffer.byteLength(JSON.stringify({rows}),'utf8')>128*1024)fail('IMPORT_TOO_LARGE',413);
  const normalized=normalizeRows(rows,pipeline),db=await pool.getConnection();
  try{
    await db.beginTransaction();
    const uidHash=crypto.createHash('sha256').update(String(actor.uid),'utf8').digest('hex');
    // Shares the existing per-owner lock used by createManualLead, so imports
    // serialize with one another and with normal lead creation.
    await db.query('INSERT IGNORE INTO pipeline_settings(uid_hash,uid) VALUES(?,?)',[uidHash,actor.uid]);
    await db.query('SELECT uid_hash FROM pipeline_settings WHERE uid_hash=? FOR UPDATE',[uidHash]);
    const created=[];
    for(const row of normalized){
      const [[duplicate]]=await db.query('SELECT id FROM pipeline_leads WHERE uid_hash=? AND mobile=? AND LOWER(TRIM(title))=? LIMIT 1 FOR UPDATE',[uidHash,row.mobile,row.title.toLocaleLowerCase('en').trim()]);
      if(duplicate)fail('DUPLICATE_EXISTING_LEAD',409,row.row);
      let ownerAgentId=null;
      if(row.agentEmail){
        const tenantId=actor.tenantId||actor.canonicalContext?.tenant?.id;
        if(!tenantId)fail('CATEGORY_UNAVAILABLE',403,row.row);
        const [[agent]]=await db.query(`SELECT a.id,a.uid,o.legacy_uid_hash AS legacyUidHash FROM agents a
          JOIN sx_legacy_ownership o ON o.source_table='agents' AND o.source_id=CAST(a.id AS CHAR) AND o.tenant_id=?
          JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id AND m.role='agent' AND m.status='active'
          JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
          WHERE a.owner_uid COLLATE utf8mb4_general_ci=? COLLATE utf8mb4_general_ci AND LOWER(a.email)=? AND LOWER(i.email_normalized)=? AND a.is_active=1 LIMIT 1 FOR UPDATE`,[tenantId,actor.uid,row.agentEmail,row.agentEmail]);
        if(!agent||agent.legacyUidHash!==crypto.createHash('sha256').update(String(agent.uid),'utf8').digest('hex'))fail('IMPORT_AGENT_NOT_FOUND',400,row.row);
        ownerAgentId=agent.id;
      }
      const lead=await pipeline.createManualLead({uid:actor.uid,actorType:actor.actorType,actorId:actor.actorId,role:'owner',input:{title:row.title,contactName:row.contactName,mobile:row.mobile,email:row.email,expectedValue:row.expectedValue,currency:row.currency,ownerAgentId},connection:db});
      created.push({row:row.row,id:lead.id,contactId:lead.contactId,ownerAgentId});
    }
    await db.commit();
    return {created:created.length,rows:created};
  }catch(error){try{await db.rollback();}catch(_){}throw error;}
  finally{db.release();}
}

module.exports={importBatch,normalizeRows};
