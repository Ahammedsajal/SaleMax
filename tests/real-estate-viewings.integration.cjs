'use strict';

// Run only against a fresh sx_real_estate_test_<hex> disposable schema.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const mysql=require('mysql2/promise');
const categories=require('../modules/platform/categories');
const properties=require('../modules/platform/real-estate-properties');
const requirements=require('../modules/platform/real-estate-requirements');
const viewings=require('../modules/platform/real-estate-viewings');
const parties=require('../modules/platform/real-estate-parties');
const realEstateGuide=require('../modules/platform/chatbot-real-estate-guide');
if(process.env.REALESTATE_SYNTHETIC_ONLY!=='true')throw Error('REALESTATE_SYNTHETIC_ONLY_REQUIRED');
const config=JSON.parse(fs.readFileSync(process.env.REALESTATE_TEST_CONFIG,'utf8'));
if(!/^sx_real_estate_test_[a-f0-9]+$/.test(config.database)||config.database!==config.user)throw Error('DISPOSABLE_REALESTATE_SCHEMA_REQUIRED');
const pool=mysql.createPool({...config,connectionLimit:8,multipleStatements:false});
const tenantId=crypto.randomUUID(),identityId=crypto.randomUUID(),ownerMembership=crypto.randomUUID(),agentIdentity=crypto.randomUUID(),agentMembership=crypto.randomUUID();
const legacyUidHash=crypto.createHash('sha256').update(`synthetic-${tenantId}`).digest('hex');
const category=categories.realEstateV3;
const context={audience:'tenant',tenant:{id:tenantId,status:'active',categoryKey:category.key,categoryVersion:category.version},membership:{id:ownerMembership,tenantId,role:'owner',status:'active'},category,subscription:{status:'active',categoryKey:category.key,categoryVersion:category.version,capabilities:[...category.capabilities]},identity:{id:identityId},legacyUidHash};
const schema=[
  'CREATE TABLE sx_tenants(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,category_key VARCHAR(80),category_version INT,status VARCHAR(20)) ENGINE=InnoDB',
  'CREATE TABLE sx_identities(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,status VARCHAR(20),display_name VARCHAR(120) NOT NULL) ENGINE=InnoDB',
  'CREATE TABLE sx_memberships(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,role VARCHAR(20),status VARCHAR(20),PRIMARY KEY(id),UNIQUE KEY uq_membership_tenant_id(tenant_id,id),UNIQUE KEY uq_membership_tenant_identity(tenant_id,identity_id),FOREIGN KEY(tenant_id) REFERENCES sx_tenants(id),FOREIGN KEY(identity_id) REFERENCES sx_identities(id)) ENGINE=InnoDB',
  'CREATE TABLE sx_audit_events(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,actor_kind VARCHAR(24) NOT NULL,action VARCHAR(100) NOT NULL,resource_type VARCHAR(100) NOT NULL,resource_id VARCHAR(120) NOT NULL,changes JSON NOT NULL,correlation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,FOREIGN KEY(tenant_id) REFERENCES sx_tenants(id),FOREIGN KEY(actor_identity_id) REFERENCES sx_identities(id)) ENGINE=InnoDB',
  'CREATE TABLE sx_legacy_ownership(tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,source_table VARCHAR(24) NOT NULL,source_id VARCHAR(80) NOT NULL,legacy_uid_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,UNIQUE KEY uq_legacy_owner(tenant_id,source_table,source_id)) ENGINE=InnoDB',
  'CREATE TABLE pipeline_leads(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,uid_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,status VARCHAR(20) NOT NULL,title VARCHAR(160) NOT NULL,contact_name VARCHAR(160) NOT NULL,owner_agent_id BIGINT NULL,updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),KEY idx_uid_hash(uid_hash,id)) ENGINE=InnoDB',
];
const listing={titleEn:'Synthetic listing',titleAr:'عقار اختباري',propertyType:'apartment',transactionType:'sale',status:'draft',priceMinor:125000,currency:'QAR',areaSqm:82.5,bedrooms:2,bathrooms:2,city:'Synthetic Doha',descriptionEn:'Synthetic fixture',descriptionAr:'بيانات اختبارية'};
async function use(fn){const db=await pool.getConnection();try{return await fn(db)}finally{db.release()}}
async function createActiveProperty(){const draft=await use(db=>properties.create(db,context,listing));return use(db=>properties.update(db,context,draft.id,{expectedRevision:1,status:'active'}));}

(async()=>{try{
  const [[existing]]=await pool.query('SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
  assert.equal(Number(existing.total),0,'synthetic schema must be empty');
  for(const sql of schema)await pool.query(sql);
  for(const file of ['20261229_real_estate_properties.sql','20261230_real_estate_requirements.sql','20261231_real_estate_viewings.sql','20261232_real_estate_chatbot_visibility.sql','20261233_real_estate_parties.sql']){
    const source=fs.readFileSync(path.join(__dirname,'../database/migrations',file),'utf8');
    for(const sql of require('../database/migration-runner').splitSql(source))await pool.query(sql);
  }
  await pool.query("INSERT INTO sx_tenants VALUES (?, 'real_estate', 3, 'active')",[tenantId]);
  await pool.query("INSERT INTO sx_identities VALUES (?,'active','Synthetic owner'),(?,'active','Synthetic agent')",[identityId,agentIdentity]);
  await pool.query("INSERT INTO sx_memberships VALUES (?,?,?,'owner','active'),(?,?,?,'agent','active')",[ownerMembership,tenantId,identityId,agentMembership,tenantId,agentIdentity]);
  const leadIds=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
  for(let i=0;i<leadIds.length;i++)await pool.query("INSERT INTO pipeline_leads(id,uid_hash,status,title,contact_name) VALUES (?,?,'open',?,?)",[leadIds[i],legacyUidHash,`Synthetic lead ${i+1}`,`Synthetic contact ${i+1}`]);
  const property=await createActiveProperty();
  const requirement=await use(db=>requirements.create(db,context,{leadId:leadIds[0],transactionType:'sale',propertyType:'apartment',minPriceMinor:100000,maxPriceMinor:150000,currency:'QAR',minAreaSqm:80,maxAreaSqm:90,minBedrooms:2,preferredCity:'Synthetic Doha',assignedMembershipId:agentMembership}));
  assert.equal(requirement.status,'open');assert.equal(requirement.revision,1);
  const requirementList=await use(db=>requirements.list(db,context,{status:'open'}));assert.equal(requirementList.total,1);assert.equal(requirementList.items[0].leadId,leadIds[0]);
  const matches=await use(db=>requirements.matches(db,context,requirement.id));assert.equal(matches.items.length,1);assert.equal(matches.items[0].id,property.id);
  const duplicateRequirements=await Promise.allSettled([
    use(db=>requirements.create(db,context,{leadId:leadIds[0],transactionType:'sale',propertyType:'apartment',assignedMembershipId:agentMembership})),
    use(db=>requirements.create(db,context,{leadId:leadIds[0],transactionType:'sale',propertyType:'apartment',assignedMembershipId:agentMembership})),
  ]);
  assert.equal(duplicateRequirements.filter(row=>row.status==='fulfilled').length,0,'requirement for this lead already exists');
  const repeatedRequirement=await Promise.allSettled([
    use(db=>requirements.create(db,context,{leadId:leadIds[1],transactionType:'sale',propertyType:'apartment',assignedMembershipId:agentMembership})),
    use(db=>requirements.create(db,context,{leadId:leadIds[1],transactionType:'sale',propertyType:'apartment',assignedMembershipId:agentMembership})),
  ]);
  assert.equal(repeatedRequirement.filter(row=>row.status==='fulfilled').length,1);
  assert.equal(repeatedRequirement.filter(row=>row.status==='rejected'&&row.reason.code==='ER_DUP_ENTRY').length,1);
  await use(db=>requirements.update(db,context,requirement.id,{expectedRevision:1,status:'matched'}));
  const first=await use(db=>viewings.create(db,context,{leadId:leadIds[0],propertyId:property.id,requirementId:requirement.id,startsAt:'2026-11-10T09:00:00+03:00',endsAt:'2026-11-10T10:00:00+03:00',assignedMembershipId:agentMembership}));
  assert.equal(first.requirementId,requirement.id);
  assert.equal(first.status,'scheduled');
  await assert.rejects(use(db=>properties.update(db,context,property.id,{expectedRevision:2,status:'sold'})),{code:'PROPERTY_HAS_SCHEDULED_VIEWINGS'});
  const racedProperty=await createActiveProperty();
  const attempts=await Promise.allSettled([
    use(db=>viewings.create(db,context,{leadId:leadIds[1],propertyId:racedProperty.id,startsAt:'2026-11-11T09:00:00Z',endsAt:'2026-11-11T10:00:00Z',assignedMembershipId:agentMembership})),
    use(db=>viewings.create(db,context,{leadId:leadIds[2],propertyId:racedProperty.id,startsAt:'2026-11-11T09:00:00Z',endsAt:'2026-11-11T10:00:00Z',assignedMembershipId:agentMembership})),
  ]);
  assert.equal(attempts.filter(row=>row.status==='fulfilled').length,1);
  assert.equal(attempts.filter(row=>row.status==='rejected'&&row.reason.code==='VIEWING_SLOT_UNAVAILABLE').length,1);
  const closeRace=await Promise.allSettled([
    use(db=>viewings.update(db,context,first.id,{expectedRevision:1,status:'completed',outcome:'interested'})),
    use(db=>properties.update(db,context,property.id,{expectedRevision:2,status:'sold'})),
  ]);
  assert.equal(closeRace.filter(row=>row.status==='rejected'&&row.reason.code==='ER_LOCK_DEADLOCK').length,0);
  assert.equal(closeRace[0].status,'fulfilled');
  const [[finalProperty]]=await pool.query('SELECT status FROM sx_real_estate_properties WHERE tenant_id=? AND id=?',[tenantId,property.id]);
  assert.ok(['active','sold'].includes(finalProperty.status));
  if(finalProperty.status==='active')assert.ok(closeRace.some(row=>row.status==='rejected'&&row.reason.code==='PROPERTY_HAS_SCHEDULED_VIEWINGS'));
  const [[audit]]=await pool.query("SELECT COUNT(*) AS total FROM sx_audit_events WHERE tenant_id=? AND action LIKE 'real-estate.viewing-%'",[tenantId]);
  assert.equal(Number(audit.total),3,'created views and completed update must be audited');
  const [[requirementAudit]]=await pool.query("SELECT COUNT(*) AS total FROM sx_audit_events WHERE tenant_id=? AND action LIKE 'real-estate.requirement-%'",[tenantId]);
  assert.equal(Number(requirementAudit.total),3,'created requirements and matched status must be audited');
  await pool.query('UPDATE sx_tenants SET category_version=4 WHERE id=?',[tenantId]);
  const partyContext={...context,tenant:{...context.tenant,categoryVersion:4},category:categories.realEstateV4,subscription:{...context.subscription,categoryVersion:4,capabilities:[...categories.realEstateV4.capabilities]}};
  const partyAssignees=await use(db=>parties.listAssignees(db,partyContext));assert.equal(partyAssignees.items.length,1);assert.equal(partyAssignees.items[0].membershipId,agentMembership);
  const partyAttempts=await Promise.allSettled([use(db=>parties.create(db,partyContext,{leadId:leadIds[0],propertyId:property.id,partyType:'buyer'})),use(db=>parties.create(db,partyContext,{leadId:leadIds[0],propertyId:property.id,partyType:'buyer'}))]);
  assert.equal(partyAttempts.filter(row=>row.status==='fulfilled').length,1);assert.equal(partyAttempts.filter(row=>row.status==='rejected'&&row.reason.code==='PARTY_ALREADY_EXISTS').length,1);
  const partyList=await use(db=>parties.list(db,partyContext,{status:'all'}));assert.equal(partyList.total,1);assert.equal(partyList.items[0].partyType,'buyer');const party=partyAttempts.find(row=>row.status==='fulfilled').value;
  const closedParty=await use(db=>parties.update(db,partyContext,party.id,{status:'closed',expectedRevision:1}));assert.equal(closedParty.status,'closed');
  const [[partyAudit]]=await pool.query("SELECT COUNT(*) AS total FROM sx_audit_events WHERE tenant_id=? AND action LIKE 'real-estate.party-%'",[tenantId]);assert.equal(Number(partyAudit.total),2);
  const shareProperty=await use(db=>properties.create(db,context,{...listing,titleEn:'Tenant A opted-in listing',titleAr:'إعلان اختباري أ',chatbotVisible:true}));await use(db=>properties.update(db,context,shareProperty.id,{expectedRevision:1,status:'active'}));
  const tenantB=crypto.randomUUID(),identityB=crypto.randomUUID(),membershipB=crypto.randomUUID(),propertyB=crypto.randomUUID();
  await pool.query("INSERT INTO sx_tenants VALUES (?, 'real_estate', 4, 'active')",[tenantB]);await pool.query("INSERT INTO sx_identities VALUES (?,'active','Synthetic second owner')",[identityB]);await pool.query("INSERT INTO sx_memberships VALUES (?,?,?,'owner','active')",[membershipB,tenantB,identityB]);
  await pool.query("INSERT INTO sx_real_estate_properties(id,tenant_id,reference_code,title_en,title_ar,property_type,transaction_type,status,price_minor,currency,area_sqm,bedrooms,bathrooms,city,description_en,description_ar,assigned_membership_id,chatbot_visible,created_by_identity_id,updated_by_identity_id) VALUES (?,?,?,'Tenant B opted-in listing','إعلان اختباري ب','apartment','sale','active',99000,'QAR',70,1,1,'Synthetic Doha','Tenant B fixture','بيانات ب',NULL,1,?,?)",[propertyB,tenantB,'RE-SYN-B',identityB,identityB]);
  const factsA=await realEstateGuide.loadFacts({db:pool,tenantId}),factsB=await realEstateGuide.loadFacts({db:pool,tenantId:tenantB});assert.ok(factsA.some(row=>row.titleEn==='Tenant A opted-in listing'));assert.ok(factsB.some(row=>row.titleEn==='Tenant B opted-in listing'));assert.ok(factsA.every(row=>row.titleEn!=='Tenant B opted-in listing'));assert.ok(factsB.every(row=>row.titleEn!=='Tenant A opted-in listing'));
  process.stdout.write(`${JSON.stringify({passed:true,checks:['v1-v4 migrations apply on a disposable database','buyer requirements link to existing leads and return bounded matching properties','concurrent duplicate requirements are rejected by the tenant-keyed unique constraint','requirement matching and status updates are audited','viewings link to the current matched requirement','viewing create and audit persist atomically','scheduled viewings prevent property closure','concurrent same-property bookings have one winner','concurrent completion and property closure preserve lock order and invariants','party assignment options and concurrent duplicate links are tenant scoped and audited','two same-category chatbot fact queries return only their tenant opted-in listings'],customerDataTouched:false,externalWrites:false})}\n`);
}finally{await pool.end();}})().catch(error=>{console.error(JSON.stringify({code:error.code||error.name,message:error.message}));process.exitCode=1;});
