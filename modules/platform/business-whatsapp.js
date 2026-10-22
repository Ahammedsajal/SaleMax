'use strict';
const crypto=require('node:crypto');
const phone=(value,{countryCode}={})=>{let s=String(value||'').replace(/[\s().-]/g,'');if(/^\d{8}$/.test(s)){if(countryCode)s=countryCode+s;else return null;}s=s.replace(/^00/,'');return /^\+?[1-9]\d{7,14}$/.test(s)?s.replace(/^\+/,''):null;};
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
async function staff(db,tenantId,{ownerOnly=false}={}){
 const [rows]=await db.query(`SELECT m.identity_id,m.role,t.timezone,COALESCE(NULLIF(u.mobile_with_country_code,''),a.mobile) AS phone
 FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
 JOIN sx_tenants t ON t.id=m.tenant_id AND t.status='active'
 JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id
 LEFT JOIN user u ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
 LEFT JOIN agents a ON o.source_table='agents' AND o.source_id=CAST(a.id AS CHAR) AND a.is_active=1
 WHERE m.tenant_id=? AND m.status='active' AND m.role IN (${ownerOnly?"'owner'":"'owner','manager'"})`,[tenantId]);
 return rows.map(r=>({kind:'identity',id:r.identity_id,role:r.role,phone:phone(r.phone,{countryCode:r.timezone==='Asia/Qatar'?'974':undefined})}));
}
async function sender(db,tenantId){
 const [rows]=await db.query(`SELECT n.id,n.uid,n.number,n.uniqueId,m.role,s.qr_instance_id
 FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id AND i.status='active'
 JOIN sx_legacy_ownership o ON o.tenant_id=m.tenant_id AND o.membership_id=m.id
 LEFT JOIN user u ON o.source_table='user' AND o.source_id=CAST(u.id AS CHAR)
 LEFT JOIN agents a ON o.source_table='agents' AND o.source_id=CAST(a.id AS CHAR) AND a.is_active=1
 JOIN instance n ON n.uid=COALESCE(u.uid,a.uid) AND n.status='ACTIVE' AND o.legacy_uid_hash=CONVERT(SHA2(COALESCE(u.uid,a.uid),256) USING ascii) COLLATE ascii_bin
 LEFT JOIN sx_business_notification_settings s ON s.tenant_id=m.tenant_id
 WHERE m.tenant_id=? AND m.status='active' AND m.role IN ('owner','manager') ORDER BY (m.role='owner') DESC,n.id`,[tenantId]);
 const configured=rows.find(r=>r.qr_instance_id&&String(r.id)===String(r.qr_instance_id));if(configured)return configured;
 const owners=rows.filter(r=>r.role==='owner');const candidates=owners.length?owners:rows;
 const unique=[...new Map(candidates.map(r=>[String(r.id),r])).values()];return unique.length===1?unique[0]:null;
}
function internalConfig(env=process.env){
 const secret=String(env.CRM_INTERNAL_SECRET||'');const origin=new URL(env.SALEMAX_TASK_QR_INTERNAL_ORIGIN||`http://127.0.0.1:${Number(env.PORT||3010)}`);
 if(env.LOCAL_ONLY_MODE==='true'||!secret||origin.protocol!=='http:'||!['127.0.0.1','localhost','app'].includes(origin.hostname)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Object.assign(Error('BUSINESS_QR_NOT_CONFIGURED'),{code:'BUSINESS_QR_NOT_CONFIGURED'});
 return {secret,origin:origin.origin};
}
async function send(db,{tenantId,to,text,pdf,fileName='7Network-daily-report.pdf',env=process.env,http=require('axios')}){
 const destination=phone(to);if(!destination)return {status:'blocked',errorCode:'RECIPIENT_PHONE_MISSING'};
 let cfg,from;try{cfg=internalConfig(env);from=await sender(db,tenantId);}catch{return {status:'blocked',errorCode:'BUSINESS_QR_NOT_CONFIGURED'};}
 if(!from)return {status:'blocked',errorCode:'DEFAULT_QR_UNAVAILABLE_OR_AMBIGUOUS'};
 const payload={uid:from.uid,from:String(from.number),to:destination,...(pdf?{documentBase64:pdf.toString('base64'),fileName,caption:text}:{text})};
 try{const r=await http.post(cfg.origin+(pdf?'/api/internal/qr/send-pdf':'/api/internal/qr/send-text'),payload,{headers:{'x-internal-secret':cfg.secret},timeout:30000,maxBodyLength:8*1024*1024});
  const id=r?.data?.data?.messageId;return r?.data?.success&&id?{status:'accepted',providerMessageId:String(id).slice(0,191)}:{status:'unknown',errorCode:'QR_ACCEPTANCE_UNCONFIRMED'};
 }catch(e){const status=Number(e?.response?.status);return status>=400&&status<500?{status:'blocked',errorCode:'QR_REQUEST_REJECTED'}:{status:'unknown',errorCode:'QR_SEND_OUTCOME_UNKNOWN'};}
}
module.exports={phone,hash,staff,sender,internalConfig,send};
