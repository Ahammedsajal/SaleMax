'use strict';
// Run only with a credential restricted to an empty, disposable schema.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const mysql=require('mysql2/promise');
const settings=require('../modules/platform/tenant-customization');
const {trainingCenter,salemaxSales}=require('../modules/platform/categories');
if(process.env.CUSTOMIZATION_SYNTHETIC_ONLY!=='true')throw Error('CUSTOMIZATION_SYNTHETIC_ONLY_REQUIRED');
const config=JSON.parse(fs.readFileSync(process.env.CUSTOMIZATION_TEST_CONFIG,'utf8'));
if(!/^sx_custom_test_[a-f0-9]+$/.test(config.database)||config.database!==config.user)throw Error('DISPOSABLE_CUSTOMIZATION_SCHEMA_REQUIRED');
const pool=mysql.createPool({...config,connectionLimit:6,multipleStatements:false});
const schema=[
 'CREATE TABLE sx_tenants(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,category_key VARCHAR(80),category_version INT,status VARCHAR(20)) ENGINE=InnoDB',
 'CREATE TABLE sx_identities(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,status VARCHAR(20)) ENGINE=InnoDB',
 'CREATE TABLE sx_memberships(id CHAR(36) PRIMARY KEY,tenant_id CHAR(36),identity_id CHAR(36),role VARCHAR(20),status VARCHAR(20)) ENGINE=InnoDB',
 'CREATE TABLE sx_plan_versions(id CHAR(36) PRIMARY KEY,category_key VARCHAR(80),category_version INT,capabilities JSON,status VARCHAR(20)) ENGINE=InnoDB',
 'CREATE TABLE sx_plan_assignments(id CHAR(36) PRIMARY KEY,tenant_id CHAR(36),plan_version_id CHAR(36),current_tenant CHAR(36),status VARCHAR(20),role_limits JSON,effective_from DATETIME(3),expires_at DATETIME(3)) ENGINE=InnoDB',
 'CREATE TABLE pipeline_stages(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,uid_hash CHAR(64),uid VARCHAR(999),stage_key VARCHAR(64),title VARCHAR(100),position INT) ENGINE=InnoDB',
 'CREATE TABLE sx_audit_events(id CHAR(36) PRIMARY KEY,tenant_id CHAR(36),actor_identity_id CHAR(36),actor_kind VARCHAR(20),action VARCHAR(100),resource_type VARCHAR(80),resource_id CHAR(36),changes JSON,correlation_id CHAR(36)) ENGINE=InnoDB'
];
async function use(fn){const db=await pool.getConnection();try{return await fn(db)}finally{db.release()}}
async function fixture(category=trainingCenter){const tenantId=crypto.randomUUID(),identityId=crypto.randomUUID(),membershipId=crypto.randomUUID(),versionId=crypto.randomUUID();await pool.query("INSERT INTO sx_tenants VALUES (?,?,?,'active')",[tenantId,category.key,category.version]);await pool.query("INSERT INTO sx_identities VALUES (?,'active')",[identityId]);await pool.query("INSERT INTO sx_memberships VALUES (?,?,?,'owner','active')",[membershipId,tenantId,identityId]);await pool.query("INSERT INTO sx_plan_versions VALUES (?,?,?,?,'published')",[versionId,category.key,category.version,JSON.stringify(category.capabilities)]);await pool.query("INSERT INTO sx_plan_assignments VALUES (?,?,?,?,'active',?,TIMESTAMPADD(DAY,-1,UTC_TIMESTAMP(3)),TIMESTAMPADD(DAY,1,UTC_TIMESTAMP(3)))",[crypto.randomUUID(),tenantId,versionId,tenantId,JSON.stringify(Object.fromEntries(category.seatRoles.map(role=>[role,role==='owner'?1:5])))]);return {audience:'tenant',identity:{id:identityId},tenant:{id:tenantId,status:'active',categoryKey:category.key,categoryVersion:category.version},membership:{id:membershipId,tenantId,role:'owner',status:'active'},category,subscription:{status:'active',capabilities:[...category.capabilities]}};}
process.env.SALEMAX_PLATFORM_ENABLED='true';
const moduleSettingsSchema=require('../modules/platform/tenant-module-settings').copySchema({moduleSettings:{pipeline:{label:{en:'Pipeline settings',ar:'إعدادات مسار المبيعات'},capability:'crm.leads',fields:[{key:'follow_up_days',type:'integer',label:{en:'Follow-up days',ar:'أيام المتابعة'},min:0,max:30,default:7}]}}},trainingCenter.capabilities);
const sharedCategory={...trainingCenter,customizationSchema:moduleSettingsSchema};
const doc=(name,follow_up_days=7)=>({schemaVersion:6,navigationLabels:{courses:{en:name,ar:'برامج '+name}},hiddenNavigation:[],stageLabels:{},moduleSettings:{pipeline:{follow_up_days}}});
const change=(ctx,body,action)=>use(db=>settings.mutate(db,ctx,body,action));
(async()=>{try{
 const [[existing]]=await pool.query('SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');assert.equal(Number(existing.total),0,'schema must be empty');
 for(const sql of schema)await pool.query(sql);
 const migration=fs.readFileSync(path.join(__dirname,'../database/migrations/20261220_tenant_customization.sql'),'utf8');for(const sql of require('../database/migration-runner').splitSql(migration))await pool.query(sql);
 const a=await fixture(sharedCategory),b=await fixture(sharedCategory);
 const ownerUid='synthetic-owner-a',ownerHash=crypto.createHash('sha256').update(ownerUid,'utf8').digest('hex');
 await pool.query('INSERT INTO pipeline_stages(uid_hash,uid,stage_key,title,position) VALUES (?,?,?,?,?)',[ownerHash,ownerUid,'new','New',0]);
 assert.deepEqual((await use(db=>settings.state(db,a,{ownerUid}))).stageFields,[{key:'new',title:'New'}]);
 await Promise.all([change(a,{expectedRevision:0,document:doc('A',3)},'draft'),change(b,{expectedRevision:0,document:doc('B',9)},'draft')]);
 const draftEffectiveA=(await use(db=>settings.effective(db,a))).document,draftEffectiveB=(await use(db=>settings.effective(db,b))).document;
 assert.equal(draftEffectiveA.navigationLabels.courses.en,'Courses','tenant A draft must not affect its active platform defaults');
 assert.equal(draftEffectiveB.navigationLabels.courses.en,'Courses','tenant B draft must not affect its active platform defaults');
 assert.equal(draftEffectiveA.moduleSettings.pipeline.follow_up_days,7,'tenant A draft must not affect its inherited category setting');
 assert.equal(draftEffectiveB.moduleSettings.pipeline.follow_up_days,7,'tenant B draft must not affect its inherited category setting');
 const publishedA=await change(a,{expectedRevision:1},'publish');const publishedB=await change(b,{expectedRevision:1},'publish');
 assert.equal((await use(db=>settings.effective(db,a))).document.navigationLabels.courses.en,'A');assert.equal((await use(db=>settings.effective(db,b))).document.navigationLabels.courses.en,'B');
 assert.equal((await use(db=>settings.effective(db,a))).document.moduleSettings.pipeline.follow_up_days,3);
 assert.equal((await use(db=>settings.effective(db,b))).document.moduleSettings.pipeline.follow_up_days,9,'same-category tenant settings remain independent');
 const sales=await fixture(salemaxSales),salesDocument={schemaVersion:1,navigationLabels:{'products-services':{en:'Inventory C',ar:'منتجات ج'}}};
 await change(sales,{expectedRevision:0,document:salesDocument},'draft');await change(sales,{expectedRevision:1},'publish');
 const salesEffective=(await use(db=>settings.effective(db,sales))).document;
 assert.equal(salesEffective.navigationLabels['products-services'].en,'Inventory C');
 assert.equal(salesEffective.navigationLabels.inbox.en,'Inbox','Sales tenant customization must retain platform defaults for omitted keys');
 const contract=require('../modules/platform/feature-contract');
 assert.equal((await contract.describeWithNavigation(pool,{context:a})).navigationLabels.courses.en,'A');
 assert.equal((await contract.describeWithNavigation(pool,{context:b})).navigationLabels.courses.en,'B');
 assert.deepEqual((await contract.describeWithNavigation(pool,{context:{...a,membership:{...a.membership,role:'agent',assignedNavigation:[]}}})).navigationLabels,{});
 const raced=await Promise.allSettled([change(a,{expectedRevision:2,document:doc('A1')},'draft'),change(a,{expectedRevision:2,document:doc('A2')},'draft')]);assert.equal(raced.filter(x=>x.status==='fulfilled').length,1);assert.equal(raced.find(x=>x.status==='rejected').reason.code,'STALE_CUSTOMIZATION_REVISION');
 await assert.rejects(change(a,{expectedRevision:3,targetId:publishedB.id},'rollback'),{code:'CUSTOMIZATION_NOT_FOUND'});
 await change(a,{expectedRevision:3},'publish');await change(a,{expectedRevision:4,targetId:publishedA.id},'rollback');
 assert.equal((await use(db=>settings.effective(db,a))).document.navigationLabels.courses.en,'A');assert.equal((await use(db=>settings.effective(db,b))).document.navigationLabels.courses.en,'B');
 assert.equal((await use(db=>settings.effective(db,a))).document.moduleSettings.pipeline.follow_up_days,3,'rollback restores tenant A settings');
 assert.equal((await use(db=>settings.effective(db,b))).document.moduleSettings.pipeline.follow_up_days,9,'tenant A rollback leaves tenant B unchanged');
 await assert.rejects(pool.query('UPDATE sx_tenant_customization_heads SET active_id=? WHERE tenant_id=?',[publishedB.id,a.tenant.id]),error=>error.code==='ER_NO_REFERENCED_ROW_2');
 const before=await use(db=>settings.state(db,a));
 await assert.rejects(use(db=>settings.mutate({query:(sql,args)=>sql.includes('INSERT INTO sx_audit_events')?Promise.reject(Error('SYNTHETIC_AUDIT_FAILURE')):db.query(sql,args),beginTransaction:()=>db.beginTransaction(),commit:()=>db.commit(),rollback:()=>db.rollback()},a,{expectedRevision:5,document:doc('Must rollback')},'draft')),/SYNTHETIC_AUDIT_FAILURE/);
 assert.deepEqual(await use(db=>settings.state(db,a)),before);
 await pool.query("UPDATE sx_memberships SET status='inactive' WHERE tenant_id=?",[a.tenant.id]);await assert.rejects(change(a,{expectedRevision:5,document:doc('No')},'draft'),{code:'PERMISSION_DENIED'});await pool.query("UPDATE sx_memberships SET status='active' WHERE tenant_id=?",[a.tenant.id]);
 await pool.query('UPDATE sx_plan_assignments SET expires_at=TIMESTAMPADD(DAY,-1,UTC_TIMESTAMP(3)) WHERE tenant_id=?',[a.tenant.id]);await assert.rejects(change(a,{expectedRevision:5,document:doc('No')},'draft'),{code:'FEATURE_UNAVAILABLE'});
 console.log(JSON.stringify({passed:true,checks:['draft isolation','same-category typed module setting defaults','published session contract isolation','different category isolation','denied navigation excludes custom labels','same-category module setting and publication isolation','exactly one concurrent draft winner','cross-tenant rollback denial','composite foreign key ownership','rollback restores historical revision and settings','audit failure rolls back changes','membership revocation','expired plan'],externalMessages:0}));
 }finally{await pool.end();}})().catch(error=>{console.error({code:error.code||error.name,message:error.message});process.exitCode=1});
