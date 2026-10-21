'use strict';

// Run only against an empty, disposable sx_real_estate_test_<hex> schema.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const mysql=require('mysql2/promise');
const properties=require('../modules/platform/real-estate-properties');
const category=require('../modules/platform/categories').realEstate;
const customization=require('../modules/platform/tenant-customization');
if(process.env.REALESTATE_SYNTHETIC_ONLY!=='true')throw Error('REALESTATE_SYNTHETIC_ONLY_REQUIRED');
const config=JSON.parse(fs.readFileSync(process.env.REALESTATE_TEST_CONFIG,'utf8'));
if(!/^sx_real_estate_test_[a-f0-9]+$/.test(config.database)||config.database!==config.user)throw Error('DISPOSABLE_REALESTATE_SCHEMA_REQUIRED');
const pool=mysql.createPool({...config,connectionLimit:6,multipleStatements:false});
const tenantId=crypto.randomUUID(),otherTenantId=crypto.randomUUID();
const ids=Object.fromEntries(['owner','otherOwner','manager','leader','agent','otherAgent','foreignAgent'].map(key=>[key,crypto.randomUUID()]));
const memberIds=Object.fromEntries(Object.keys(ids).map(key=>[key,crypto.randomUUID()]));
const schema=[
  'CREATE TABLE sx_tenants(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,category_key VARCHAR(80),category_version INT,status VARCHAR(20)) ENGINE=InnoDB',
  'CREATE TABLE sx_identities(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,status VARCHAR(20),display_name VARCHAR(120) NOT NULL) ENGINE=InnoDB',
  'CREATE TABLE sx_memberships(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,role VARCHAR(20),status VARCHAR(20),UNIQUE KEY uq_membership_tenant_id(tenant_id,id),UNIQUE KEY uq_membership_tenant_identity(tenant_id,identity_id),FOREIGN KEY(tenant_id) REFERENCES sx_tenants(id),FOREIGN KEY(identity_id) REFERENCES sx_identities(id)) ENGINE=InnoDB',
  'CREATE TABLE sx_sales_org_history(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,manager_membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,team_leader_membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,ended_at DATETIME(3) NULL) ENGINE=InnoDB',
  'CREATE TABLE sx_audit_events(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,actor_kind VARCHAR(24) NOT NULL,action VARCHAR(100) NOT NULL,resource_type VARCHAR(100) NOT NULL,resource_id VARCHAR(120) NOT NULL,changes JSON NOT NULL,correlation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,FOREIGN KEY(tenant_id) REFERENCES sx_tenants(id),FOREIGN KEY(actor_identity_id) REFERENCES sx_identities(id)) ENGINE=InnoDB'
];
const context=(tenant,identity,membershipId,role='owner')=>({audience:'tenant',tenant:{id:tenant,status:'active',categoryKey:category.key,categoryVersion:category.version},membership:{id:membershipId,tenantId:tenant,role,status:'active'},category,subscription:{status:'active',categoryKey:category.key,categoryVersion:category.version,capabilities:[...category.capabilities]},identity:{id:identity}});
const listing={titleEn:'Synthetic Doha apartment',titleAr:'شقة اختبارية في الدوحة',propertyType:'apartment',transactionType:'sale',status:'draft',priceMinor:125000,currency:'QAR',areaSqm:82.5,bedrooms:2,bathrooms:2,city:'Synthetic Doha',descriptionEn:'Synthetic test record',descriptionAr:'سجل اختبار'};
async function use(fn){const db=await pool.getConnection();try{return await fn(db)}finally{db.release()}}

(async()=>{try{
  const [[existing]]=await pool.query('SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
  assert.equal(Number(existing.total),0,'synthetic schema must be empty');
  for(const sql of schema)await pool.query(sql);
  const runner=require('../database/migration-runner');
  for(const file of ['20261220_tenant_customization.sql','20261222_real_estate_properties.sql','20261225_real_estate_property_custom_fields.sql']){
    const migration=fs.readFileSync(path.join(__dirname,`../database/migrations/${file}`),'utf8');
    for(const sql of runner.splitSql(migration))await pool.query(sql);
  }
  await pool.query("INSERT INTO sx_tenants VALUES (?,?,?,'active'),(?,?,?,'active')",[tenantId,category.key,category.version,otherTenantId,category.key,category.version]);
  for(const [key,identity] of Object.entries(ids))await pool.query("INSERT INTO sx_identities VALUES (?,'active',?)",[identity,`Synthetic ${key}`]);
  const memberRows=[
    ['owner',tenantId,'owner'],['manager',tenantId,'manager'],['leader',tenantId,'team_leader'],['agent',tenantId,'agent'],['otherAgent',tenantId,'agent'],
    ['otherOwner',otherTenantId,'owner'],['foreignAgent',otherTenantId,'agent'],
  ];
  for(const [key,tenant,role] of memberRows)await pool.query('INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES (?,?,?, ?,\'active\')',[memberIds[key],tenant,ids[key],role]);
  const field={key:'pf_text_abcdef0123456789',type:'text',label:{en:'Facing direction',ar:'جهة الإطلالة'},required:false,active:true,version:1};
  const customizationDoc={schemaVersion:6,navigationLabels:{},leadFields:[],hiddenNavigation:[],enabledTaskTypes:null,taskTypeLabels:{},propertyFields:[field]};
  await pool.query("INSERT INTO sx_tenant_customization_revisions(id,tenant_id,category_key,category_version,schema_version,revision,kind,document,checksum,created_by_identity_id) VALUES (?,?,?,1,6,1,'published',?,?,?)",[crypto.randomUUID(),tenantId,category.key,JSON.stringify(customizationDoc),customization.checksum(customizationDoc),ids.owner]);
  const [[customizationRevision]]=await pool.query('SELECT id FROM sx_tenant_customization_revisions WHERE tenant_id=?',[tenantId]);
  await pool.query('INSERT INTO sx_tenant_customization_heads(tenant_id,revision,active_id) VALUES (?,1,?)',[tenantId,customizationRevision.id]);
  await pool.query('INSERT INTO sx_sales_org_history(id,tenant_id,membership_id,manager_membership_id,team_leader_membership_id,ended_at) VALUES (?,?,?,?,?,NULL)',[crypto.randomUUID(),tenantId,memberIds.agent,memberIds.manager,memberIds.leader]);
  await pool.query('INSERT INTO sx_sales_org_history(id,tenant_id,membership_id,manager_membership_id,team_leader_membership_id,ended_at) VALUES (?,?,?,?,?,NULL)',[crypto.randomUUID(),tenantId,memberIds.otherAgent,memberIds.manager,null]);
  const a=context(tenantId,ids.owner,memberIds.owner),b=context(otherTenantId,ids.otherOwner,memberIds.otherOwner);
  const foreignActor={...a,identity:{id:ids.foreignAgent}};
  await assert.rejects(use(db=>properties.create(db,foreignActor,listing)),error=>['ER_NO_REFERENCED_ROW_2','ER_NO_REFERENCED_ROW'].includes(error.code));
  const manager=context(tenantId,ids.manager,memberIds.manager,'manager'),leader=context(tenantId,ids.leader,memberIds.leader,'team_leader'),agent=context(tenantId,ids.agent,memberIds.agent,'agent'),otherAgent=context(tenantId,ids.otherAgent,memberIds.otherAgent,'agent');
  const created=await use(db=>properties.create(db,manager,{...listing,assignedMembershipId:memberIds.agent,customFields:{configurationRevision:1,values:{[field.key]:'North facing'}}}));
  const savedListing=(await use(db=>properties.list(db,a,{search:'North facing'}))).items[0];
  assert.equal(savedListing.customFields[field.key].value,'North facing');assert.equal(savedListing.customFields[field.key].definition.label.en,'Facing direction');
  assert.equal((await use(db=>properties.list(db,b))).fieldContract.fields.length,0,'another tenant has no access to this tenant custom-field contract');
  const customUpdate=await use(db=>properties.update(db,a,created.id,{expectedRevision:1,customFields:{configurationRevision:1,values:{[field.key]:'South facing'}}}));
  assert.equal(customUpdate.customFields[field.key].value,'South facing');
  assert.equal((await use(db=>properties.list(db,a,{search:'North facing'}))).total,0);
  assert.equal((await use(db=>properties.list(db,a,{search:'South facing'}))).total,1);
  assert.equal((await use(db=>properties.list(db,agent))).total,1);
  assert.equal((await use(db=>properties.list(db,otherAgent))).total,0);
  assert.equal((await use(db=>properties.list(db,leader))).total,1);
  assert.equal((await use(db=>properties.list(db,manager))).total,1);
  assert.equal((await use(db=>properties.listAssignees(db,manager))).items.length,2);
  await assert.rejects(use(db=>properties.create(db,manager,{...listing,assignedMembershipId:memberIds.foreignAgent})),{code:'PROPERTY_ASSIGNEE_UNAVAILABLE'});
  assert.equal((await use(db=>properties.list(db,a))).total,1);
  assert.equal((await use(db=>properties.list(db,b))).total,0);
  await assert.rejects(use(db=>properties.update(db,b,created.id,{expectedRevision:1,status:'active'})),{code:'PROPERTY_NOT_FOUND'});
  await assert.rejects(use(db=>properties.create(db,a,{...listing,status:'active'})),{code:'INVALID_PROPERTY_TRANSITION'});

  const results=await Promise.allSettled([
    use(db=>properties.update(db,a,created.id,{expectedRevision:2,status:'active'})),
    use(db=>properties.update(db,a,created.id,{expectedRevision:2,priceMinor:130000})),
  ]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected'&&result.reason.code==='STALE_REVISION').length,1);
  const [[row]]=await pool.query('SELECT revision,status FROM sx_real_estate_properties WHERE tenant_id=? AND id=?',[tenantId,created.id]);
  assert.equal(Number(row.revision),3);

  const before=await use(async db=>{const [[count]]=await db.query('SELECT COUNT(*) AS total FROM sx_real_estate_properties WHERE tenant_id=?',[tenantId]);return Number(count.total)});
  const connection=await pool.getConnection();
  const failingDb={beginTransaction:()=>connection.beginTransaction(),commit:()=>connection.commit(),rollback:()=>connection.rollback(),query:(sql,args)=>String(sql).includes('INSERT INTO sx_audit_events')?Promise.reject(Error('SYNTHETIC_AUDIT_FAILURE')):connection.query(sql,args)};
  try{await assert.rejects(properties.create(failingDb,a,{...listing,titleEn:'Audit rollback candidate'}),/SYNTHETIC_AUDIT_FAILURE/);}finally{connection.release();}
  const after=await use(async db=>{const [[count]]=await db.query('SELECT COUNT(*) AS total FROM sx_real_estate_properties WHERE tenant_id=?',[tenantId]);return Number(count.total)});
  assert.equal(after,before,'listing insert must roll back with its audit event');
  console.log(JSON.stringify({passed:true,checks:['property and customization migrations apply to disposable MariaDB','creator identity must be a member of the same tenant','manager assignment is limited to active same-team agents','agents see only their assigned listings','team leaders see listings assigned to current team members','foreign-tenant assignee denied','tenant-scoped listing reads','custom field config and values remain tenant-isolated','custom values validate, retain bilingual snapshots and update transactionally','custom values are searchable inside the tenant scope','cross-tenant listing ID denied','new listings start as drafts','two concurrent edits yield one revision winner','audit failure rolls back listing creation'],customerDataTouched:false,externalWrites:false}));
}finally{await pool.end();}})().catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});
