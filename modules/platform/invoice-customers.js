'use strict';
const crypto=require('node:crypto');
const fail=code=>{throw Object.assign(Error(code),{code,status:400});};
const clean=value=>value==null||['null','undefined'].includes(String(value).trim().toLowerCase())?'':String(value).trim();
const normalizeEmail=value=>String(value||'').trim().toLowerCase();
function query(value=''){
  if(typeof value!=='string'||value.length>80)fail('INVALID_CUSTOMER_SEARCH');
  const text=value.trim(),digits=text.replace(/\D/g,''),phone=/^[+\d\s().-]+$/.test(text)&&digits.length>=3?(digits.length===11&&digits.startsWith('974')?digits.slice(3):digits):'';
  return {text,term:'%'+text.replace(/[\\%_]/g,'\\$&')+'%',phone:phone?'%'+phone+'%':''};
}
async function owner(db,tenant){
  const [owners]=await db.query(`SELECT u.uid,o.legacy_uid_hash FROM sx_legacy_ownership o
    JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id AND m.role='owner' AND m.status='active'
    JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
    JOIN user u ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR) WHERE o.tenant_id=? LIMIT 2`,[tenant]);
  if(owners.length!==1||owners[0].legacy_uid_hash!==crypto.createHash('sha256').update(owners[0].uid).digest('hex'))fail('BUSINESS_LINK_INVALID');
  return {uid:owners[0].uid,hash:owners[0].legacy_uid_hash};
}
async function list(db,ctx,{q=''}={}){
  const search=query(q),tenant=ctx.tenant.id,{uid,hash}=await owner(db,tenant);
  const [rows]=await db.query(`SELECT * FROM (
    SELECT l.id,COALESCE(NULLIF(l.learner_name,''),NULLIF(l.contact_name,''),l.title) AS name,
      COALESCE(NULLIF(l.mobile,''),NULLIF(c.normalized_phone,''),NULLIF(JSON_UNQUOTE(JSON_EXTRACT(fs.submission_data,'$.phone')),'null')) AS phone,
      COALESCE(NULLIF(c.normalized_email,''),NULLIF(JSON_UNQUOTE(JSON_EXTRACT(fs.submission_data,'$.email')),'null')) AS email,
      COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(fs.submission_data,'$.address')),'null'),'') AS address,
      'lead' AS source,l.updated_at AS updated_at
    FROM pipeline_leads l LEFT JOIN pipeline_contacts c ON c.uid_hash=l.uid_hash AND c.id=l.contact_id
    LEFT JOIN sx_training_form_submissions fs ON fs.tenant_id=? AND fs.lead_id=l.id AND fs.id=(SELECT recent.id FROM sx_training_form_submissions recent WHERE recent.tenant_id=fs.tenant_id AND recent.lead_id=l.id ORDER BY recent.created_at DESC,recent.id DESC LIMIT 1)
    WHERE l.uid_hash=? AND l.uid=?
    UNION ALL
    SELECT c.id,c.display_name,c.normalized_phone,c.normalized_email,'','contact',c.updated_at
    FROM pipeline_contacts c WHERE c.uid_hash=? AND NOT EXISTS(SELECT 1 FROM pipeline_leads l WHERE l.uid_hash=c.uid_hash AND l.uid=? AND l.contact_id=c.id)
  ) customers WHERE (?='' OR name LIKE ? OR phone LIKE ? OR email LIKE ? OR (?<>'' AND REGEXP_REPLACE(COALESCE(phone,''),'[^0-9]','') LIKE ?))
  ORDER BY updated_at DESC,name,id LIMIT 40`,[tenant,hash,uid,hash,uid,search.text,search.term,search.term,search.term,search.phone,search.phone]);
  return rows.map(row=>({id:row.id,source:row.source,name:clean(row.name),phone:clean(row.phone),email:clean(row.email),address:clean(row.address)}));
}
async function matchContacts(db,tenantId,customers){
  if(!Array.isArray(customers)||customers.length>100)fail('INVALID_CUSTOMER_MATCH_REQUEST');
  const emails=[...new Set(customers.map(row=>normalizeEmail(row?.email)).filter(Boolean))];
  const phones=[...new Set(customers.map(row=>String(row?.phone||'').replace(/\D/g,'')).filter(value=>value.length>=7&&value.length<=15))];
  const empty=()=>customers.map(()=>({status:'none',count:0,records:[]}));
  if(!emails.length&&!phones.length)return empty();
  const {uid,hash}=await owner(db,tenantId),conditions=[],params=[hash,tenantId,hash,uid];
  if(emails.length){conditions.push(`LOWER(TRIM(COALESCE(crm.email,''))) IN (${emails.map(()=>'?').join(',')})`);params.push(...emails);}
  if(phones.length){conditions.push(`REGEXP_REPLACE(COALESCE(crm.phone,''),'[^0-9]','') IN (${phones.map(()=>'?').join(',')})`);params.push(...phones);}
  const [rows]=await db.query(`SELECT crm.id,crm.source,crm.name,crm.email,crm.phone FROM (
    SELECT pc.id,'contact' AS source,pc.display_name AS name,pc.normalized_email AS email,pc.normalized_phone AS phone
      FROM pipeline_contacts pc WHERE pc.uid_hash=?
    UNION ALL
    SELECT pl.id,'lead' AS source,COALESCE(NULLIF(pl.learner_name,''),NULLIF(pl.contact_name,''),pl.title) AS name,
      NULLIF(JSON_UNQUOTE(JSON_EXTRACT(fs.submission_data,'$.email')),'null') AS email,pl.mobile AS phone
      FROM pipeline_leads pl LEFT JOIN sx_training_form_submissions fs ON fs.tenant_id=? AND fs.lead_id=pl.id
        AND fs.id=(SELECT recent.id FROM sx_training_form_submissions recent WHERE recent.tenant_id=fs.tenant_id
          AND recent.lead_id=pl.id ORDER BY recent.created_at DESC,recent.id DESC LIMIT 1)
      WHERE pl.uid_hash=? AND pl.uid=? AND pl.contact_id IS NULL
  ) crm WHERE ${conditions.join(' OR ')}`,params);
  return customers.map(customer=>{
    const email=normalizeEmail(customer?.email),phone=String(customer?.phone||'').replace(/\D/g,'');
    const matches=new Map();
    for(const row of rows){
      const sameEmail=!!email&&normalizeEmail(row.email)===email;
      const samePhone=!!phone&&phone.length>=7&&phone.length<=15&&String(row.phone||'').replace(/\D/g,'')===phone;
      if(sameEmail||samePhone){const key=`${row.source}:${row.id}`;matches.set(key,{id:String(row.id),source:row.source,name:clean(row.name)});}
    }
    const records=[...matches.values()];
    return {status:records.length===1?'unique':records.length>1?'ambiguous':'none',count:records.length,records:records.slice(0,10)};
  });
}
module.exports={query,owner,list,matchContacts};
