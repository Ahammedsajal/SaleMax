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
 'CREATE TABLE sx_audit_events(id CHAR(36) PRIMARY KEY,tenant_id CHAR(36),actor_identity_id CHAR(36),actor_kind VARCHAR(20),action VARCHAR(100),resource_type VARCHAR(80),resource_id CHAR(36),changes JSON,correlation_id CHAR(36)) ENGINE=InnoDB'
];
async function use(fn){const db=await pool.getConnection();try{return await fn(db)}finally{db.release()}}
async function fixture(category=trainingCenter){const tenantId=crypto.randomUUID(),identityId=crypto.randomUUID(),membershipId=crypto.randomUUID(),versionId=crypto.randomUUID();await pool.query("INSERT INTO sx_tenants VALUES (?,?,?,'active')",[tenantId,category.key,category.version]);await pool.query("INSERT INTO sx_identities VALUES (?,'active')",[identityId]);await pool.query("INSERT INTO sx_memberships VALUES (?,?,?,'owner','active')",[membershipId,tenantId,identityId]);await pool.query("INSERT INTO sx_plan_versions VALUES (?,?,?,?,'published')",[versionId,category.key,category.version,JSON.stringify(category.capabilities)]);await pool.query("INSERT INTO sx_plan_assignments VALUES (?,?,?,?,'active',?,TIMESTAMPADD(DAY,-1,UTC_TIMESTAMP(3)),TIMESTAMPADD(DAY,1,UTC_TIMESTAMP(3)))",[crypto.randomUUID(),tenantId,versionId,tenantId,JSON.stringify(Object.fromEntries(category.seatRoles.map(role=>[role,role==='owner'?1:5])))]);return {audience:'tenant',identity:{id:identityId},tenant:{id:tenantId,status:'active',categoryKey:category.key,categoryVersion:category.version},membership:{id:membershipId,tenantId,role:'owner',status:'active'},category,subscription:{status:'active',capabilities:[...category.capabilities]}};}
process.env.SALEMAX_PLATFORM_ENABLED='true';
const doc=name=>({schemaVersion:5,navigationLabels:{courses:{en:name,ar:'برامج '+name}},leadFields:[],hiddenNavigation:[],enabledTaskTypes:null,taskTypeLabels:{general:{en:'General '+name,ar:'عام '+name},enrollment:{en:'Enrollment '+name,ar:'تسجيل '+name}}});
const change=(ctx,body,action)=>use(db=>settings.mutate(db,ctx,body,action));
(async()=>{try{
 const [[existing]]=await pool.query('SELECT COUNT(*) AS total FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');assert.equal(Number(existing.total),0,'schema must be empty');
 for(const sql of schema)await pool.query(sql);
 const migration=fs.readFileSync(path.join(__dirname,'../database/migrations/20261220_tenant_customization.sql'),'utf8');for(const sql of require('../database/migration-runner').splitSql(migration))await pool.query(sql);
 const a=await fixture(),b=await fixture();
 await Promise.all([change(a,{expectedRevision:0,document:doc('A')},'draft'),change(b,{expectedRevision:0,document:doc('B')},'draft')]);
 assert.deepEqual((await use(db=>settings.effective(db,a))).document,settings.defaults(a));
 const publishedA=await change(a,{expectedRevision:1},'publish');const publishedB=await change(b,{expectedRevision:1},'publish');
 assert.equal((await use(db=>settings.effective(db,a))).document.navigationLabels.courses.en,'A');assert.equal((await use(db=>settings.effective(db,b))).document.navigationLabels.courses.en,'B');
 const adapters=require('../modules/platform/task-type-adapters'),customA=await use(db=>settings.effective(db,a)),customB=await use(db=>settings.effective(db,b));
 assert.equal(adapters.available({...a,customization:customA}).find(item=>item.key==='general').label.en,'General A');
 assert.equal(adapters.available({...b,customization:customB}).find(item=>item.key==='general').label.en,'General B');
 const sales=await fixture(salemaxSales),salesDocument={schemaVersion:1,navigationLabels:{'products-services':{en:'Inventory C',ar:'منتجات ج'}}};
 await change(sales,{expectedRevision:0,document:salesDocument},'draft');await change(sales,{expectedRevision:1},'publish');
 assert.deepEqual((await use(db=>settings.effective(db,sales))).document,salesDocument);
 const contract=require('../modules/platform/feature-contract');
 assert.equal((await contract.describeWithNavigation(pool,{context:a})).navigationLabels.courses.en,'A');
 assert.equal((await contract.describeWithNavigation(pool,{context:b})).navigationLabels.courses.en,'B');
 assert.deepEqual((await contract.describeWithNavigation(pool,{context:{...a,membership:{...a.membership,role:'agent',assignedNavigation:[]}}})).navigationLabels,{});
 const raced=await Promise.allSettled([change(a,{expectedRevision:2,document:doc('A1')},'draft'),change(a,{expectedRevision:2,document:doc('A2')},'draft')]);assert.equal(raced.filter(x=>x.status==='fulfilled').length,1);assert.equal(raced.find(x=>x.status==='rejected').reason.code,'STALE_CUSTOMIZATION_REVISION');
 await assert.rejects(change(a,{expectedRevision:3,targetId:publishedB.id},'rollback'),{code:'CUSTOMIZATION_NOT_FOUND'});
 await change(a,{expectedRevision:3},'publish');await change(a,{expectedRevision:4,targetId:publishedA.id},'rollback');
 assert.equal((await use(db=>settings.effective(db,a))).document.navigationLabels.courses.en,'A');assert.equal((await use(db=>settings.effective(db,b))).document.navigationLabels.courses.en,'B');
 const moduleDocument={...settings.defaults(a),disabledModules:['training.courses']};
 await change(a,{expectedRevision:5,document:moduleDocument},'draft');await change(a,{expectedRevision:6},'publish');
 await use(db=>settings.prepareRuntimeContext(db,a));
 const policy=require('../modules/platform/policy');
 assert.equal(policy.decision(a,{capability:'training.courses',permission:'courses.read'}).code,'MODULE_DISABLED');
 assert.equal(policy.decision(a,{capability:'training.enrollments',permission:'sales.request'}).code,'MODULE_DISABLED');
 assert.equal(policy.decision(b,{capability:'training.courses',permission:'courses.read'}).allowed,true,'same-category tenant B is unaffected');
 assert.equal((await contract.describeWithNavigation(pool,{context:a})).roleNavigation.includes('courses'),false);
 assert.equal((await contract.describeWithNavigation(pool,{context:b})).roleNavigation.includes('courses'),true);
 await assert.rejects(pool.query('UPDATE sx_tenant_customization_heads SET active_id=? WHERE tenant_id=?',[publishedB.id,a.tenant.id]),error=>error.code==='ER_NO_REFERENCED_ROW_2');
 const before=await use(db=>settings.state(db,a));
 await assert.rejects(use(db=>settings.mutate({query:(sql,args)=>sql.includes('INSERT INTO sx_audit_events')?Promise.reject(Error('SYNTHETIC_AUDIT_FAILURE')):db.query(sql,args),beginTransaction:()=>db.beginTransaction(),commit:()=>db.commit(),rollback:()=>db.rollback()},a,{expectedRevision:7,document:doc('Must rollback')},'draft')),/SYNTHETIC_AUDIT_FAILURE/);
 assert.deepEqual(await use(db=>settings.state(db,a)),before);
 await pool.query("UPDATE sx_memberships SET status='inactive' WHERE tenant_id=?",[a.tenant.id]);await assert.rejects(change(a,{expectedRevision:7,document:doc('No')},'draft'),{code:'PERMISSION_DENIED'});await pool.query("UPDATE sx_memberships SET status='active' WHERE tenant_id=?",[a.tenant.id]);
 await pool.query('UPDATE sx_plan_assignments SET expires_at=TIMESTAMPADD(DAY,-1,UTC_TIMESTAMP(3)) WHERE tenant_id=?',[a.tenant.id]);await assert.rejects(change(a,{expectedRevision:7,document:doc('No')},'draft'),{code:'FEATURE_UNAVAILABLE'});
 console.log(JSON.stringify({passed:true,checks:['draft isolation','published session contract isolation','different category isolation','denied navigation excludes custom labels','publish isolation for same-category tenants','tenant-specific task labels reach the existing task API','tenant module restriction reaches policy and workspace session','module dependencies stay denied','same-category tenant module isolation','exactly one concurrent draft winner','cross-tenant rollback denial','composite foreign key ownership','rollback restores historical revision','audit failure rolls back changes','membership revocation','expired plan'],externalMessages:0}));
 }finally{await pool.end();}})().catch(error=>{console.error({code:error.code||error.name,message:error.message});process.exitCode=1});
