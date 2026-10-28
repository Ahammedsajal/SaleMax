'use strict';
const crypto=require('node:crypto');
const net=require('node:net');
const properties=require('./real-estate-properties');
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const id=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function check(ctx,resource,write=false){
  properties.authorize(ctx,`realestate.${resource}.${write?'manage':'read'}`);
  if(write&&ctx.membership.role!=='owner')fail('PERMISSION_DENIED',403);
}
async function member(db,ctx,memberId,lock=false){
  if(!id(memberId))fail('MEMBER_NOT_FOUND',404);
  const role=ctx.membership.role,args=[ctx.tenant.id,memberId];let filter='';
  if(role==='agent'){filter=' AND m.id=?';args.push(ctx.membership.id);}
  else if(role==='team_leader'||role==='manager'){
    const column=role==='manager'?'manager_membership_id':'team_leader_membership_id';
    filter=` AND (m.id=? OR EXISTS (SELECT 1 FROM sx_sales_org_history h WHERE h.tenant_id=m.tenant_id AND h.membership_id=m.id AND h.${column}=? AND h.ended_at IS NULL))`;args.push(ctx.membership.id,ctx.membership.id);
  }else if(role!=='owner')fail('PERMISSION_DENIED',403);
  const [[row]]=await db.query(`SELECT m.id FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id WHERE m.tenant_id=? AND m.id=? AND m.status='active' AND i.status='active' AND m.role IN ('agent','team_leader','manager')${filter}${lock?' FOR UPDATE':''}`,args);
  if(!row)fail('MEMBER_NOT_FOUND',404);return row;
}
function cleanProfile(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['workingAreas','languages','seniority','publicEnabled','publicBioEn','publicBioAr','expectedRevision'].includes(k)))fail('INVALID_AGENT_PROFILE');
  const list=k=>{const v=input[k]??[];if(!Array.isArray(v)||v.length>30||v.some(x=>typeof x!=='string'||!x.trim()||x.trim().length>100)||new Set(v.map(x=>x.trim())).size!==v.length)fail('INVALID_AGENT_PROFILE');return v.map(x=>x.trim());};
  const text=k=>{const v=input[k]??'';if(typeof v!=='string'||v.trim().length>1000)fail('INVALID_AGENT_PROFILE');return v.trim();};
  const out={workingAreas:list('workingAreas'),languages:list('languages'),seniority:input.seniority??'agent',publicEnabled:input.publicEnabled??false,publicBioEn:text('publicBioEn'),publicBioAr:text('publicBioAr'),expectedRevision:input.expectedRevision??0};
  if(!['agent','senior'].includes(out.seniority)||typeof out.publicEnabled!=='boolean'||!Number.isSafeInteger(out.expectedRevision)||out.expectedRevision<0)fail('INVALID_AGENT_PROFILE');return out;
}
async function profile(db,ctx,memberId){
  check(ctx,'agent_profiles');await member(db,ctx,memberId);
  const [[row]]=await db.query('SELECT p.working_areas AS workingAreas,p.languages,p.seniority,p.public_enabled AS publicEnabled,p.public_bio_en AS publicBioEn,p.public_bio_ar AS publicBioAr,p.revision,t.slug AS tenantSlug FROM sx_real_estate_agent_profiles p JOIN sx_tenants t ON t.id=p.tenant_id WHERE p.tenant_id=? AND p.membership_id=?',[ctx.tenant.id,memberId]);
  if(!row)return null;for(const key of ['workingAreas','languages'])if(typeof row[key]==='string'){try{row[key]=JSON.parse(row[key]);}catch{fail('AGENT_PROFILE_INVALID',503);}}row.publicEnabled=Boolean(row.publicEnabled);return row;
}
async function saveProfile(db,ctx,memberId,input){
  check(ctx,'agent_profiles',true);const v=cleanProfile(input);await db.beginTransaction();try{
    await member(db,ctx,memberId,true);const [[current]]=await db.query('SELECT revision FROM sx_real_estate_agent_profiles WHERE tenant_id=? AND membership_id=? FOR UPDATE',[ctx.tenant.id,memberId]);
    if(Number(current?.revision||0)!==v.expectedRevision)fail('STALE_REVISION',409);
    const values=[JSON.stringify(v.workingAreas),JSON.stringify(v.languages),v.seniority,v.publicEnabled?1:0,v.publicBioEn,v.publicBioAr,ctx.identity.id];
    if(current)await db.query('UPDATE sx_real_estate_agent_profiles SET working_areas=?,languages=?,seniority=?,public_enabled=?,public_bio_en=?,public_bio_ar=?,updated_by_identity_id=?,revision=revision+1 WHERE tenant_id=? AND membership_id=?',[...values,ctx.tenant.id,memberId]);
    else await db.query('INSERT INTO sx_real_estate_agent_profiles (working_areas,languages,seniority,public_enabled,public_bio_en,public_bio_ar,updated_by_identity_id,tenant_id,membership_id) VALUES (?,?,?,?,?,?,?,?,?)',[...values,ctx.tenant.id,memberId]);
    await db.commit();return {revision:Number(current?.revision||0)+1};
  }catch(error){await db.rollback();throw error;}
}
async function rules(db,ctx,memberId){
  check(ctx,'commissions');await member(db,ctx,memberId);
  const [items]=await db.query(`SELECT r.id,r.listing_id AS listingId,p.reference_code AS listingReference,p.title_en AS listingTitleEn,p.title_ar AS listingTitleAr,r.basis,r.value_minor_or_bps AS value,r.reason,r.created_by_identity_id AS createdByIdentityId,r.created_at AS createdAt FROM sx_real_estate_agent_commission_rules r LEFT JOIN sx_real_estate_properties p ON p.tenant_id=r.tenant_id AND p.id=r.listing_id WHERE r.tenant_id=? AND r.membership_id=? ORDER BY r.sequence_id DESC LIMIT 200`,[ctx.tenant.id,memberId]);
  return {items};
}
async function addRule(db,ctx,memberId,input){
  check(ctx,'commissions',true);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['listingId','basis','value','reason'].includes(k)))fail('INVALID_COMMISSION_RULE');
  const listingId=input.listingId||null,reason=typeof input.reason==='string'?input.reason.trim():'';
  if((listingId&&!id(listingId))||!['first_month_percent','fixed_qar'].includes(input.basis)||!Number.isSafeInteger(input.value)||input.value<0||input.value>(input.basis==='first_month_percent'?10000:999999999999)||reason.length<3||reason.length>1000)fail('INVALID_COMMISSION_RULE');
  await db.beginTransaction();try{
    await member(db,ctx,memberId,true);
    if(listingId){const [[listing]]=await db.query('SELECT id FROM sx_real_estate_properties WHERE tenant_id=? AND id=? FOR UPDATE',[ctx.tenant.id,listingId]);if(!listing)fail('PROPERTY_NOT_FOUND',404);}
    const ruleId=crypto.randomUUID();await db.query('INSERT INTO sx_real_estate_agent_commission_rules (id,tenant_id,membership_id,listing_id,basis,value_minor_or_bps,reason,created_by_identity_id) VALUES (?,?,?,?,?,?,?,?)',[ruleId,ctx.tenant.id,memberId,listingId,input.basis,input.value,reason,ctx.identity.id]);
    await db.query("INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,reason,changes,correlation_id) VALUES (?,?,?,'identity','real-estate.commission-rule-created','membership',?,?,?,?)",[crypto.randomUUID(),ctx.tenant.id,ctx.identity.id,memberId,reason,JSON.stringify({ruleId,listingId,basis:input.basis,value:input.value}),crypto.randomUUID()]);
    await db.commit();return {id:ruleId};
  }catch(error){await db.rollback();throw error;}
}
async function publicProfile(db,slug,memberId){
  if(typeof slug!=='string'||!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)||!id(memberId))fail('PROFILE_NOT_FOUND',404);
  const [[row]]=await db.query(`SELECT t.id AS tenantId,t.name AS businessName,i.display_name AS name,p.working_areas AS workingAreas,p.languages,p.seniority,p.public_bio_en AS bioEn,p.public_bio_ar AS bioAr FROM sx_real_estate_agent_profiles p JOIN sx_tenants t ON t.id=p.tenant_id JOIN sx_memberships m ON m.tenant_id=p.tenant_id AND m.id=p.membership_id JOIN sx_identities i ON i.id=m.identity_id WHERE t.slug=? AND t.status='active' AND t.category_key='real_estate' AND p.membership_id=? AND p.public_enabled=1 AND m.status='active' AND m.role IN ('agent','team_leader','manager') AND i.status='active' LIMIT 1`,[slug,memberId]);
  if(!row)fail('PROFILE_NOT_FOUND',404);
  const entitlement=await require('./plans').loadEntitlements(db,row.tenantId);
  if(!entitlement||!['active','trial','grace'].includes(entitlement.status)||!entitlement.capabilities?.includes('realestate.listings'))fail('PROFILE_NOT_FOUND',404);
  for(const key of ['workingAreas','languages'])if(typeof row[key]==='string'){try{row[key]=JSON.parse(row[key]);}catch{fail('PROFILE_NOT_FOUND',404);}}
  // This count is an explicitly defined operational indicator, not a rating
  // or a certification. It counts active listing records assigned in the CRM.
  const [[count]]=await db.query(`SELECT COUNT(*) AS total FROM sx_real_estate_properties p WHERE p.tenant_id=? AND p.status='active' AND (p.assigned_membership_id=? OR EXISTS (SELECT 1 FROM sx_real_estate_listing_coagents c WHERE c.tenant_id=p.tenant_id AND c.listing_id=p.id AND c.membership_id=?))`,[row.tenantId,memberId,memberId]);
  delete row.tenantId;return {...row,activeListingCount:Number(count.total)};
}
function publicProfileRouter({pool,key}){
  const express=require('express'),router=express.Router();
  router.get('/:tenantSlug/:memberId',async(req,res)=>{
    res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    const remote=req.socket.remoteAddress||'',chain=(req.get('X-Forwarded-For')||'').split(',').map(value=>value.trim()).filter(Boolean),last=chain.at(-1);
    const clientIp=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)&&last&&net.isIP(last)?last:remote;
    const visitorHash=crypto.createHmac('sha256',key).update(clientIp||crypto.randomBytes(32)).digest();
    let db;
    try{
      db=await pool.getConnection();
      await db.query('DELETE FROM sx_real_estate_public_profile_rate_limits WHERE window_started_at<TIMESTAMPADD(DAY,-7,UTC_TIMESTAMP(3)) LIMIT 100');
      await db.query(`INSERT INTO sx_real_estate_public_profile_rate_limits(visitor_hash,window_started_at,attempts) VALUES (?,UTC_TIMESTAMP(3),1)
        ON DUPLICATE KEY UPDATE attempts=IF(window_started_at<TIMESTAMPADD(MINUTE,-1,UTC_TIMESTAMP(3)),1,attempts+1),window_started_at=IF(window_started_at<TIMESTAMPADD(MINUTE,-1,UTC_TIMESTAMP(3)),UTC_TIMESTAMP(3),window_started_at)`,[visitorHash]);
      const [[limit]]=await db.query('SELECT attempts FROM sx_real_estate_public_profile_rate_limits WHERE visitor_hash=?',[visitorHash]);
      if(Number(limit.attempts)>60)return res.status(429).json({success:false,code:'PROFILE_RATE_LIMITED'});
      const data=await publicProfile(db,req.params.tenantSlug,req.params.memberId);
      return res.json({success:true,data});
    }catch(error){const status=error.status||500;return res.status(status).json({success:false,code:status>=500?'PROFILE_UNAVAILABLE':error.code||'PROFILE_NOT_FOUND'});}
    finally{if(db)db.release();}
  });
  return router;
}
module.exports={cleanProfile,profile,saveProfile,rules,addRule,publicProfile,publicProfileRouter};
