'use strict';

const crypto = require('node:crypto');
const {decision} = require('./policy');
const {TYPES,authorize:authorizeProperties} = require('./real-estate-properties');
const inventory = require('./real-estate-inventory');
const properties = require('./real-estate-properties');
const authority = require('./real-estate-authority');
const fail = (code,status=400) => { throw Object.assign(new Error(code),{code,status}); };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = ['areas','propertyTypes','bedrooms','budgetMinMinor','budgetMaxMinor','moveInDate','leaseMonths','furnishing','amenities','includedBills','contactPreferences','consent','consentNote','expectedRevision'];

function clean(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k=>!fields.includes(k))) fail('INVALID_REQUIREMENT');
  const list=(key,max,allowed)=>{
    const value=input[key]??[];
    if(!Array.isArray(value)||value.length>max||value.some(x=>typeof x!=='string'||!x.trim()||x.trim().length>100||(allowed&&!allowed.has(x)))||new Set(value.map(x=>x.trim())).size!==value.length) fail('INVALID_REQUIREMENT');
    return value.map(x=>x.trim());
  };
  const integer=(key,max,min=0)=>{const value=input[key]??null;if(value!==null&&(!Number.isSafeInteger(value)||value<min||value>max))fail('INVALID_REQUIREMENT');return value;};
  const out={areas:list('areas',30),propertyTypes:list('propertyTypes',20,TYPES),bedrooms:integer('bedrooms',500),budgetMinMinor:integer('budgetMinMinor',999999999999),budgetMaxMinor:integer('budgetMaxMinor',999999999999),moveInDate:input.moveInDate??null,leaseMonths:integer('leaseMonths',1200,1),furnishing:input.furnishing??'any',amenities:list('amenities',30),includedBills:list('includedBills',5,new Set(['electricity','water','cooling','internet','maintenance'])),contactPreferences:list('contactPreferences',4,new Set(['phone','whatsapp','email','sms'])),consent:input.consent??'unknown',consentNote:input.consentNote??'',expectedRevision:integer('expectedRevision',4294967295)};
  if(out.budgetMinMinor!==null&&out.budgetMaxMinor!==null&&out.budgetMinMinor>out.budgetMaxMinor)fail('INVALID_REQUIREMENT');
  if(out.moveInDate!==null&&(typeof out.moveInDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(out.moveInDate)||Number.isNaN(Date.parse(out.moveInDate))||new Date(out.moveInDate).toISOString().slice(0,10)!==out.moveInDate))fail('INVALID_REQUIREMENT');
  if(!['any','furnished','semi_furnished','unfurnished'].includes(out.furnishing)||!['unknown','granted','declined'].includes(out.consent)||typeof out.consentNote!=='string'||out.consentNote.trim().length>500)fail('INVALID_REQUIREMENT');
  out.consentNote=out.consentNote.trim();
  return out;
}

// Resolve the lead under the same owner and assignment boundary as the existing
// pipeline, then repeat the check while holding a lock for every mutation.
async function authorizeLead(db,session,leadId,permission,lock=false){
  const context=session.context;
  if(context?.tenant?.categoryKey!=='real_estate'||context.membership?.tenantId!==context.tenant.id)fail('CATEGORY_UNAVAILABLE',404);
  const access=decision(context,{capability:'crm.leads',permission});
  if(!access.allowed)fail(access.code,403);
  if(typeof leadId!=='string'||!idPattern.test(leadId)||typeof session.ownerUid!=='string')fail('LEAD_NOT_FOUND',404);
  const hash=crypto.createHash('sha256').update(session.ownerUid,'utf8').digest('hex');
  const args=[hash,leadId];let scope='';
  if(access.scope==='assigned'){
    if(!session.agent||!Number.isSafeInteger(Number(session.actor?.id)))fail('LEAD_NOT_FOUND',404);
    scope=' AND l.owner_agent_id=?';args.push(Number(session.actor.id));
  }else if(access.scope==='team'){
    scope=` AND EXISTS (SELECT 1 FROM agents a JOIN sx_legacy_ownership o ON o.source_table='agents' AND BINARY o.source_id=BINARY CAST(a.id AS CHAR) AND o.tenant_id=? JOIN sx_memberships m ON m.tenant_id=o.tenant_id AND m.id=o.membership_id AND m.status='active' JOIN sx_sales_org_history h ON h.tenant_id=m.tenant_id AND h.membership_id=m.id AND h.ended_at IS NULL WHERE a.id=l.owner_agent_id AND a.owner_uid=? AND a.is_active=1 AND BINARY o.legacy_uid_hash=BINARY SHA2(a.uid,256) AND h.team_leader_membership_id=?)`;
    args.push(context.tenant.id,session.ownerUid,context.membership.id);
  }else if(access.scope!=='tenant') fail('PERMISSION_DENIED',403);
  const [[lead]]=await db.query(`SELECT l.id FROM pipeline_leads l WHERE l.uid_hash=? AND l.id=?${scope}${lock?' FOR UPDATE':''}`,args);
  if(!lead)fail('LEAD_NOT_FOUND',404);
}

async function get(db,session,leadId){
  await authorizeLead(db,session,leadId,'leads.read');
  const [[row]]=await db.query(`SELECT areas,property_types AS propertyTypes,bedrooms,budget_min_minor AS budgetMinMinor,budget_max_minor AS budgetMaxMinor,DATE_FORMAT(move_in_date,'%Y-%m-%d') AS moveInDate,lease_months AS leaseMonths,furnishing,amenities,included_bills AS includedBills,contact_preferences AS contactPreferences,consent,consent_note AS consentNote,revision FROM sx_real_estate_tenant_requirements WHERE tenant_id=? AND lead_id=?`,[session.context.tenant.id,leadId]);
  if(!row)return null;
  for(const key of ['areas','propertyTypes','amenities','includedBills','contactPreferences'])if(typeof row[key]==='string'){try{row[key]=JSON.parse(row[key]);}catch{fail('REQUIREMENT_DATA_INVALID',503);}}
  return row;
}

async function save(db,session,leadId,input){
  const value=clean(input),tenant=session.context.tenant.id;
  await db.beginTransaction();
  try{
    await authorizeLead(db,session,leadId,'leads.manage',true);
    const [[current]]=await db.query('SELECT revision FROM sx_real_estate_tenant_requirements WHERE tenant_id=? AND lead_id=? FOR UPDATE',[tenant,leadId]);
    if(Number(current?.revision||0)!==Number(value.expectedRevision||0))fail('STALE_REVISION',409);
    const args=[JSON.stringify(value.areas),JSON.stringify(value.propertyTypes),value.bedrooms,value.budgetMinMinor,value.budgetMaxMinor,value.moveInDate,value.leaseMonths,value.furnishing,JSON.stringify(value.amenities),JSON.stringify(value.includedBills),JSON.stringify(value.contactPreferences),value.consent,value.consentNote,session.context.identity.id];
    if(current) await db.query('UPDATE sx_real_estate_tenant_requirements SET areas=?,property_types=?,bedrooms=?,budget_min_minor=?,budget_max_minor=?,move_in_date=?,lease_months=?,furnishing=?,amenities=?,included_bills=?,contact_preferences=?,consent=?,consent_note=?,updated_by_identity_id=?,revision=revision+1 WHERE tenant_id=? AND lead_id=?',[...args,tenant,leadId]);
    else await db.query('INSERT INTO sx_real_estate_tenant_requirements (areas,property_types,bedrooms,budget_min_minor,budget_max_minor,move_in_date,lease_months,furnishing,amenities,included_bills,contact_preferences,consent,consent_note,updated_by_identity_id,tenant_id,lead_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[...args,tenant,leadId]);
    await db.commit();return {revision:Number(current?.revision||0)+1};
  }catch(error){await db.rollback();throw error;}
}

async function addUnit(db,session,leadId,unitId){
  if(typeof unitId!=='string'||!idPattern.test(unitId))fail('INVALID_UNIT');
  authorizeProperties(session.context,'properties.read');
  await db.beginTransaction();
  try{
    await authorizeLead(db,session,leadId,'leads.manage',true);
    await inventory.getUnit(db,session.context,unitId);
    const [[requirement]]=await db.query('SELECT lead_id FROM sx_real_estate_tenant_requirements WHERE tenant_id=? AND lead_id=? FOR UPDATE',[session.context.tenant.id,leadId]);
    if(!requirement)fail('REQUIREMENT_NOT_FOUND',404);
    await db.query('INSERT IGNORE INTO sx_real_estate_lead_units (tenant_id,lead_id,unit_id,added_by_identity_id) VALUES (?,?,?,?)',[session.context.tenant.id,leadId,unitId,session.context.identity.id]);
    await db.commit();return {unitId};
  }catch(error){await db.rollback();throw error;}
}
async function listUnits(db,session,leadId){
  await authorizeLead(db,session,leadId,'leads.read');
  authorizeProperties(session.context,'properties.read');
  const [rows]=await db.query('SELECT unit_id AS unitId FROM sx_real_estate_lead_units WHERE tenant_id=? AND lead_id=? ORDER BY created_at,unit_id LIMIT 200',[session.context.tenant.id,leadId]);
  const items=[];
  for(const row of rows){
    try{items.push(await inventory.getUnit(db,session.context,row.unitId));}
    catch(error){if(error.code!=='UNIT_NOT_FOUND')throw error;}
  }
  return {items};
}
async function removeUnit(db,session,leadId,unitId){
  if(typeof unitId!=='string'||!idPattern.test(unitId))fail('INVALID_UNIT');
  authorizeProperties(session.context,'properties.read');
  await db.beginTransaction();
  try{
    await authorizeLead(db,session,leadId,'leads.manage',true);
    await inventory.getUnit(db,session.context,unitId);
    await db.query('DELETE FROM sx_real_estate_lead_units WHERE tenant_id=? AND lead_id=? AND unit_id=?',[session.context.tenant.id,leadId,unitId]);
    await db.commit();return {unitId};
  }catch(error){await db.rollback();throw error;}
}
async function matches(db,session,leadId,page){
  const requirement=await get(db,session,leadId);
  if(!requirement)fail('REQUIREMENT_NOT_FOUND',404);
  const listings=await properties.list(db,session.context,{status:'active',page});
  const items=[];
  for(const listing of listings.items){
    // Tenant budgets are in QAR, so prices in another currency are not
    // comparable without a separately supplied exchange rate.
    if(listing.transactionType!=='rent'||listing.currency!=='QAR'||!listing.unitId||listing.unitAvailability!=='available')continue;
    let unit;
    try{unit=await inventory.getUnit(db,session.context,listing.unitId);await authority.assertMayActivateListing(db,session.context,unit.id);}
    catch(error){if(['UNIT_NOT_FOUND','PROPERTY_AUTHORITY_REQUIRED','CONTENT_APPROVAL_REQUIRED','AGREEMENT_NOT_IN_EFFECT','AGREEMENT_NOT_AVAILABLE'].includes(error.code))continue;throw error;}
    const r=requirement,area=String(unit.area||'').trim().toLocaleLowerCase();
    if(r.areas.length&&!r.areas.some(value=>value.trim().toLocaleLowerCase()===area))continue;
    if(r.propertyTypes.length&&!r.propertyTypes.includes(unit.propertyType))continue;
    if(r.bedrooms!==null&&Number(unit.bedrooms)!==Number(r.bedrooms))continue;
    if(r.bedrooms!==null&&unit.bedrooms===null)continue;
    if(r.budgetMinMinor!==null&&Number(listing.priceMinor)<Number(r.budgetMinMinor))continue;
    if(r.budgetMaxMinor!==null&&Number(listing.priceMinor)>Number(r.budgetMaxMinor))continue;
    if(r.moveInDate&&unit.availableFrom&&unit.availableFrom>r.moveInDate)continue;
    if(r.leaseMonths!==null&&listing.minimumTermMonths!==null&&Number(listing.minimumTermMonths)>Number(r.leaseMonths))continue;
    if(r.furnishing!=='any'&&r.furnishing!==unit.furnishing)continue;
    const amenities=(unit.amenities||[]).map(x=>String(x).trim().toLocaleLowerCase());
    if(r.amenities.some(x=>!amenities.includes(x.trim().toLocaleLowerCase())))continue;
    let services=listing.includedServices||[];if(typeof services==='string'){try{services=JSON.parse(services);}catch{services=[];}}
    if(!Array.isArray(services)||r.includedBills.some(x=>!services.includes(x)))continue;
    items.push({unitId:unit.id,listingId:listing.id,name:unit.name,area:unit.area,bedrooms:unit.bedrooms,priceMinor:Number(listing.priceMinor),currency:listing.currency,minimumTermMonths:listing.minimumTermMonths});
  }
  return {items,page:listings.page,hasMore:listings.page*listings.limit<listings.total};
}
module.exports={clean,authorizeLead,get,save,addUnit,listUnits,removeUnit,matches};
