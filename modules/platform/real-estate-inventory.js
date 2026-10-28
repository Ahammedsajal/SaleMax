'use strict';

const crypto = require('node:crypto');
const { decision } = require('./policy');
const properties = require('./real-estate-properties');
const rules = require('./real-estate-inventory-rules');
const uuid = () => crypto.randomUUID();
const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
const TYPES = new Set(['apartment', 'house', 'villa', 'villa_apartment', 'townhouse', 'penthouse', 'land', 'commercial', 'office', 'warehouse', 'other']);
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value, max, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) fail('INVALID_UNIT');
  return value.trim();
}
function validateUnit(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_UNIT');
  const allowed = new Set(['name', 'propertyType', 'area', 'bedrooms', 'buildingId']);
  if (Object.keys(input).some(k => !allowed.has(k))) fail('INVALID_UNIT');
  const name = text(input.name, 160, true), area = text(input.area || '', 100);
  if (!TYPES.has(input.propertyType)) fail('INVALID_PROPERTY_TYPE');
  const bedrooms = input.bedrooms ?? null;
  if (bedrooms !== null && (!Number.isSafeInteger(bedrooms) || bedrooms < 0 || bedrooms > 500)) fail('INVALID_PROPERTY_ROOM_COUNT');
  const buildingId = input.buildingId || null;
  if (buildingId && !ID.test(buildingId)) fail('INVALID_UNIT');
  return { name, area, propertyType: input.propertyType, bedrooms, buildingId };
}
function validateListing(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['unitId', 'priceMinor', 'minimumTermMonths'].includes(k))) fail('INVALID_LISTING');
  if (typeof input.unitId !== 'string' || !ID.test(input.unitId)) fail('INVALID_LISTING');
  if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor < 0 || input.priceMinor > 999999999999) fail('INVALID_PROPERTY_PRICE');
  const term = input.minimumTermMonths ?? null;
  if (term !== null && (!Number.isSafeInteger(term) || term < 1 || term > 1200)) fail('INVALID_LISTING_TERM');
  return { unitId: input.unitId, priceMinor: input.priceMinor, minimumTermMonths: term };
}
const DETAIL_COLUMNS = Object.freeze({name:'name',nameAr:'name_ar',descriptionEn:'description_en',descriptionAr:'description_ar',propertyType:'property_type',area:'area',municipality:'municipality',street:'street',privateAddress:'private_address',unitNumber:'unit_number',floorLabel:'floor_label',ownerName:'owner_name',managingCompany:'managing_company',areaSqm:'area_sqm',bedrooms:'bedrooms',bathrooms:'bathrooms',parkingSpaces:'parking_spaces',furnishing:'furnishing',availableFrom:'available_from',latitude:'latitude',longitude:'longitude',amenities:'amenities',buildingId:'building_id'});
function validateDetails(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || Object.keys(input).some(k => k !== 'expectedRevision' && !Object.hasOwn(DETAIL_COLUMNS,k))) fail('INVALID_UNIT_UPDATE');
  const out = {};
  const textLimits = {name:160,nameAr:160,descriptionEn:5000,descriptionAr:5000,area:100,municipality:100,street:160,privateAddress:500,unitNumber:80,floorLabel:40,ownerName:160,managingCompany:160};
  for (const [key,max] of Object.entries(textLimits)) if (Object.hasOwn(input,key)) out[key]=text(input[key] ?? '',max,key==='name');
  if (Object.hasOwn(input,'propertyType')) { if (!TYPES.has(input.propertyType)) fail('INVALID_PROPERTY_TYPE');out.propertyType=input.propertyType; }
  for (const key of ['bedrooms','bathrooms','parkingSpaces']) if (Object.hasOwn(input,key)) {const value=input[key];if(value!==null&&(!Number.isSafeInteger(value)||value<0||value>500))fail('INVALID_PROPERTY_ROOM_COUNT');out[key]=value;}
  for (const [key,min,max] of [['areaSqm',0,10000000],['latitude',-90,90],['longitude',-180,180]]) if (Object.hasOwn(input,key)) {const value=input[key];if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||(key==='areaSqm'&&value===0)))fail('INVALID_UNIT');out[key]=value;}
  if (Object.hasOwn(input,'furnishing')) {if(!['unknown','furnished','semi_furnished','unfurnished'].includes(input.furnishing))fail('INVALID_UNIT');out.furnishing=input.furnishing;}
  if (Object.hasOwn(input,'buildingId')) {const value=input.buildingId;if(value!==null&&(typeof value!=='string'||!ID.test(value)))fail('INVALID_UNIT');out.buildingId=value;}
  if (Object.hasOwn(input,'availableFrom')) {const value=input.availableFrom;if(value!==null&&(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))fail('INVALID_UNIT');out.availableFrom=value;}
  if (Object.hasOwn(input,'amenities')) {const value=input.amenities;if(!Array.isArray(value)||value.length>30||value.some(item=>typeof item!=='string'||!item.trim()||item.length>80)||new Set(value).size!==value.length)fail('INVALID_UNIT');out.amenities=JSON.stringify(value);}
  if (!Object.keys(out).length) fail('INVALID_UNIT_UPDATE');
  return out;
}
function scope(context, alias = 'u') {
  const access = decision(context, { capability: 'realestate.listings', permission: 'properties.read' });
  if (access.scope === 'assigned') return { sql: ` AND (${alias}.assigned_membership_id=? OR EXISTS (SELECT 1 FROM sx_real_estate_properties p WHERE p.tenant_id=${alias}.tenant_id AND p.unit_id=${alias}.id AND (p.assigned_membership_id=? OR EXISTS (SELECT 1 FROM sx_real_estate_listing_coagents ca WHERE ca.tenant_id=p.tenant_id AND ca.listing_id=p.id AND ca.membership_id=?))))`, args: [context.membership.id, context.membership.id, context.membership.id] };
  if (access.scope === 'team') return { sql: ` AND (${alias}.assigned_membership_id=? OR EXISTS (SELECT 1 FROM sx_real_estate_properties p LEFT JOIN sx_sales_org_history org ON org.tenant_id=p.tenant_id AND org.membership_id=p.assigned_membership_id AND org.ended_at IS NULL WHERE p.tenant_id=${alias}.tenant_id AND p.unit_id=${alias}.id AND (p.assigned_membership_id=? OR org.team_leader_membership_id=? OR EXISTS (SELECT 1 FROM sx_real_estate_listing_coagents ca LEFT JOIN sx_sales_org_history co ON co.tenant_id=ca.tenant_id AND co.membership_id=ca.membership_id AND co.ended_at IS NULL WHERE ca.tenant_id=p.tenant_id AND ca.listing_id=p.id AND (ca.membership_id=? OR co.team_leader_membership_id=?)))) OR EXISTS (SELECT 1 FROM sx_sales_org_history org WHERE org.tenant_id=${alias}.tenant_id AND org.membership_id=${alias}.assigned_membership_id AND org.team_leader_membership_id=? AND org.ended_at IS NULL))`, args: [context.membership.id, context.membership.id, context.membership.id, context.membership.id, context.membership.id, context.membership.id] };
  return { sql: '', args: [] };
}
async function audit(db, context, action, resource, id, changes) {
  await db.query(`INSERT INTO sx_audit_events(id,tenant_id,actor_identity_id,actor_kind,action,resource_type,resource_id,changes,correlation_id) VALUES (?,?,?,'identity',?,?,?,?,?)`, [uuid(), context.tenant.id, context.identity.id, action, resource, id, JSON.stringify(changes), uuid()]);
}
async function listUnits(db, context, query={}) {
  properties.authorize(context, 'properties.read');
  const s = scope(context);
  const page=Math.max(1,Math.min(100000,Number.parseInt(query.page,10)||1)),limit=50;
  const [[count]]=await db.query(`SELECT COUNT(*) AS total FROM sx_real_estate_units u WHERE u.tenant_id=?${s.sql}`,[context.tenant.id,...s.args]);
  const [rows] = await db.query(`SELECT u.id,u.reference_code AS referenceCode,u.name,u.property_type AS propertyType,u.area,u.bedrooms,u.availability,u.revision,u.building_id AS buildingId,b.name AS buildingName FROM sx_real_estate_units u LEFT JOIN sx_real_estate_buildings b ON b.tenant_id=u.tenant_id AND b.id=u.building_id WHERE u.tenant_id=?${s.sql} ORDER BY u.updated_at DESC,u.id LIMIT ? OFFSET ?`, [context.tenant.id, ...s.args,limit,(page-1)*limit]);
  return { items: rows,total:Number(count.total),page,limit };
}
async function createBuilding(db, context, input) {
  properties.authorize(context, 'properties.manage');
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['name', 'area'].includes(k))) fail('INVALID_BUILDING');
  const name = text(input.name, 160, true), area = text(input.area || '', 100), id = uuid();
  await db.beginTransaction();
  try {
    await db.query('INSERT INTO sx_real_estate_buildings(id,tenant_id,name,area,created_by_identity_id) VALUES (?,?,?,?,?)', [id, context.tenant.id, name, area, context.identity.id]);
    await audit(db, context, 'real-estate.building-created', 'real-estate-building', id, {});
    await db.commit();
    return { id, name, area };
  } catch (error) { await db.rollback(); throw error; }
}
async function listBuildings(db, context) {
  properties.authorize(context, 'properties.read');
  const s = scope(context);
  const access = decision(context, { capability: 'realestate.listings', permission: 'properties.read' });
  const visible = access.scope === 'assigned' || access.scope === 'team' ? ` AND EXISTS (SELECT 1 FROM sx_real_estate_units u WHERE u.tenant_id=b.tenant_id AND u.building_id=b.id${s.sql})` : '';
  const [rows] = await db.query(`SELECT b.id,b.name,b.area FROM sx_real_estate_buildings b WHERE b.tenant_id=?${visible} ORDER BY b.name,b.id LIMIT 200`, [context.tenant.id, ...(visible ? s.args : [])]);
  return { items: rows };
}
async function getUnit(db, context, id) {
  properties.authorize(context,'properties.read');
  if (typeof id!=='string'||!ID.test(id)) fail('INVALID_UNIT');
  const s=scope(context), canManage=decision(context,{capability:'realestate.listings',permission:'properties.manage'}).allowed;
  const privateFields=canManage?',u.private_address AS privateAddress,u.owner_name AS ownerName,u.managing_company AS managingCompany':'';
  const [[row]]=await db.query(`SELECT u.id,u.reference_code AS referenceCode,u.name,u.name_ar AS nameAr,u.description_en AS descriptionEn,u.description_ar AS descriptionAr,u.property_type AS propertyType,u.area,u.municipality,u.street,u.unit_number AS unitNumber,u.floor_label AS floorLabel,u.area_sqm AS areaSqm,u.bedrooms,u.bathrooms,u.parking_spaces AS parkingSpaces,u.furnishing,u.availability,DATE_FORMAT(u.available_from,'%Y-%m-%d') AS availableFrom,u.latitude,u.longitude,u.amenities,u.building_id AS buildingId,u.revision${privateFields} FROM sx_real_estate_units u WHERE u.tenant_id=? AND u.id=?${s.sql}`, [context.tenant.id,id,...s.args]);
  if(!row) fail('UNIT_NOT_FOUND',404);
  if(typeof row.amenities==='string') {try {row.amenities=JSON.parse(row.amenities);} catch {fail('UNIT_DATA_INVALID',503);}}
  row.amenities ||= [];
  return row;
}
async function updateUnit(db, context, id, input) {
  properties.authorize(context,'properties.manage');
  if(typeof id!=='string'||!ID.test(id))fail('INVALID_UNIT_UPDATE');
  const patch=validateDetails(input),keys=Object.keys(patch);
  await db.beginTransaction();
  try {
    const [[unit]]=await db.query('SELECT revision FROM sx_real_estate_units WHERE tenant_id=? AND id=? FOR UPDATE',[context.tenant.id,id]);
    if(!unit)fail('UNIT_NOT_FOUND',404);
    if(Number(unit.revision)!==input.expectedRevision)fail('STALE_REVISION',409);
    if(patch.buildingId){const [[building]]=await db.query('SELECT id FROM sx_real_estate_buildings WHERE tenant_id=? AND id=?',[context.tenant.id,patch.buildingId]);if(!building)fail('BUILDING_NOT_FOUND',404);}
    await db.query(`UPDATE sx_real_estate_units SET ${keys.map(key=>`${DETAIL_COLUMNS[key]}=?`).join(',')},revision=revision+1,updated_by_identity_id=? WHERE tenant_id=? AND id=?`,[...keys.map(key=>patch[key]),context.identity.id,context.tenant.id,id]);
    await audit(db,context,'real-estate.unit-updated','real-estate-unit',id,{fields:keys,revision:input.expectedRevision+1});
    await db.commit();return {id,revision:input.expectedRevision+1};
  } catch(error){await db.rollback();throw error;}
}
async function createUnit(db, context, input) {
  properties.authorize(context, 'properties.manage');
  const data = validateUnit(input), id = uuid(), referenceCode = `U-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  await db.beginTransaction();
  try {
    if (data.buildingId) {
      const [[building]] = await db.query('SELECT id FROM sx_real_estate_buildings WHERE tenant_id=? AND id=? FOR UPDATE', [context.tenant.id, data.buildingId]);
      if (!building) fail('BUILDING_NOT_FOUND', 404);
    }
    await db.query(`INSERT INTO sx_real_estate_units(id,tenant_id,building_id,reference_code,name,property_type,area,bedrooms,created_by_identity_id,updated_by_identity_id) VALUES (?,?,?,?,?,?,?,?,?,?)`, [id, context.tenant.id, data.buildingId, referenceCode, data.name, data.propertyType, data.area, data.bedrooms, context.identity.id, context.identity.id]);
    await audit(db, context, 'real-estate.unit-created', 'real-estate-unit', id, { referenceCode, propertyType: data.propertyType });
    await db.commit();
    return { id, referenceCode, ...data, availability: 'available', revision: 1 };
  } catch (error) { await db.rollback(); throw error; }
}
async function createListing(db, context, input) {
  properties.authorize(context, 'properties.manage');
  const data = validateListing(input), id = uuid(), referenceCode = `RE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  await db.beginTransaction();
  try {
    const [[unit]] = await db.query('SELECT id,name,name_ar AS nameAr,property_type AS propertyType,area,bedrooms,bathrooms,area_sqm AS areaSqm,availability FROM sx_real_estate_units WHERE tenant_id=? AND id=? FOR UPDATE', [context.tenant.id, data.unitId]);
    if (!unit) fail('UNIT_NOT_FOUND', 404);
    rules.assertListingCanActivate(unit.availability);
    await db.query(`INSERT INTO sx_real_estate_properties(id,tenant_id,unit_id,reference_code,title_en,title_ar,property_type,transaction_type,status,price_minor,currency,area_sqm,bedrooms,bathrooms,city,description_en,description_ar,minimum_term_months,created_by_identity_id,updated_by_identity_id) VALUES (?,?,?,?,?,?,?,'rent','draft',?,'QAR',?,?,?,?,?,?,?, ?,?)`, [id, context.tenant.id, data.unitId, referenceCode, unit.name, unit.nameAr || unit.name, unit.propertyType, data.priceMinor, unit.areaSqm, unit.bedrooms, unit.bathrooms, unit.area, '', '', data.minimumTermMonths, context.identity.id, context.identity.id]);
    await audit(db, context, 'real-estate.listing-created', 'real-estate-property', id, { referenceCode, unitId: data.unitId, status: 'draft' });
    await db.commit();
    return { id, referenceCode, ...data, status: 'draft', revision: 1 };
  } catch (error) { await db.rollback(); throw error; }
}
async function setAvailability(db, context, id, input) {
  properties.authorize(context, 'properties.manage');
  if (typeof id !== 'string' || !ID.test(id) || !input || Object.keys(input).some(k => !['availability', 'expectedRevision'].includes(k)) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail('INVALID_UNIT_UPDATE');
  rules.validateUnitState(input.availability);
  await db.beginTransaction();
  try {
    const [[unit]] = await db.query('SELECT availability,revision FROM sx_real_estate_units WHERE tenant_id=? AND id=? FOR UPDATE', [context.tenant.id, id]);
    if (!unit) fail('UNIT_NOT_FOUND', 404);
    if (Number(unit.revision) !== input.expectedRevision) fail('STALE_REVISION', 409);
    const [listings] = await db.query('SELECT id,status,transaction_type AS transactionType FROM sx_real_estate_properties WHERE tenant_id=? AND unit_id=? FOR UPDATE', [context.tenant.id, id]);
    for (const listing of listings) {
      // Historical states such as sold and archived remain untouched.
      if (!['active', 'reserved', 'under_offer'].includes(listing.status)) continue;
      const next = input.availability === 'rented' && listing.transactionType === 'sale' ? 'paused' : listing.status === 'under_offer' ? (input.availability === 'rented' ? 'rented' : input.availability === 'reserved' ? 'reserved' : input.availability === 'unavailable' ? 'paused' : 'under_offer') : rules.listingStateForUnit(input.availability, listing.status);
      if (next !== listing.status) await db.query('UPDATE sx_real_estate_properties SET status=?,revision=revision+1,updated_by_identity_id=? WHERE tenant_id=? AND id=?', [next, context.identity.id, context.tenant.id, listing.id]);
    }
    await db.query('UPDATE sx_real_estate_units SET availability=?,revision=revision+1,updated_by_identity_id=? WHERE tenant_id=? AND id=?', [input.availability, context.identity.id, context.tenant.id, id]);
    await audit(db, context, 'real-estate.unit-availability-changed', 'real-estate-unit', id, { from: unit.availability, to: input.availability });
    await db.commit();
    return { id, availability: input.availability, revision: input.expectedRevision + 1 };
  } catch (error) { await db.rollback(); throw error; }
}
module.exports = { validateUnit, validateDetails, validateListing, listUnits, getUnit, updateUnit, listBuildings, createBuilding, createUnit, createListing, setAvailability };
