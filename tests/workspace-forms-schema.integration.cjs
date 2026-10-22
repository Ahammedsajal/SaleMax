'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const mysql=require('mysql2/promise');
const path=require('node:path');
const {discover,applyMigrations}=require('../database/migration-runner');

async function main(){
  const host=process.env.DBHOST,port=Number(process.env.DBPORT),database=process.env.SALEMAX_TEST_DATABASE;
  if(process.env.LOCAL_ONLY_MODE!=='true'||!['127.0.0.1','localhost','::1'].includes(host)||!Number.isSafeInteger(port)||port<1||port>65535||!/^salemax_migration_test_[a-z0-9_]{1,40}$/.test(database||'')||!process.env.DBUSER||!process.env.DBPASS)throw Error('DISPOSABLE_LOCAL_MARIADB_REQUIRED');
  const password=process.env.DBPASS==='__EMPTY__'?'':process.env.DBPASS;
  const connectionOptions={host,port,user:process.env.DBUSER,password,database,connectTimeout:5000};
  const db=await mysql.createConnection(connectionOptions);
  try{
    const [[server]]=await db.query('SELECT VERSION() AS version,DATABASE() AS databaseName');
    assert.match(server.version,/mariadb/i,'the focused Forms migration check requires MariaDB');
    assert.equal(server.databaseName,database);
    const [[existing]]=await db.query('SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
    assert.equal(Number(existing.count),0,'refusing to mutate a non-empty test database');

    await db.query(`CREATE TABLE sx_tenants(
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      slug VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
      name VARCHAR(200) NOT NULL,
      category_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      category_version INT UNSIGNED NOT NULL,
      status ENUM('provisioning','active','suspended','archived') NOT NULL DEFAULT 'active'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db.query(`CREATE TABLE sx_identities(
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      email_normalized VARCHAR(254) NOT NULL UNIQUE,
      display_name VARCHAR(200) NOT NULL,
      status ENUM('pending','active','disabled') NOT NULL DEFAULT 'active'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const t1=crypto.randomUUID(),t2=crypto.randomUUID(),i1=crypto.randomUUID(),i2=crypto.randomUUID();
    const baseCategory=require('../modules/platform/categories').baseCrm;
    for(const [index,id] of [t1,t2].entries())await db.query('INSERT INTO sx_tenants(id,slug,name,category_key,category_version,status) VALUES (?,?,?,?,?,\'active\')',[id,`synthetic-${index?'b':'a'}`,`Synthetic ${index?'B':'A'}`,baseCategory.key,baseCategory.version]);
    for(const [index,id] of [i1,i2].entries())await db.query('INSERT INTO sx_identities(id,email_normalized,display_name) VALUES (?,?,?)',[id,`forms-${index?'b':'a'}@example.invalid`,`Synthetic ${index?'B':'A'}`]);
    await db.query(`CREATE TABLE sx_audit_events(
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      actor_kind ENUM('identity','system') NOT NULL,
      action VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      resource_type VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      resource_id VARCHAR(191) NOT NULL,
      changes JSON NOT NULL,
      correlation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES sx_tenants(id),
      FOREIGN KEY (actor_identity_id) REFERENCES sx_identities(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db.query(`CREATE TABLE sx_memberships(
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
      tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      role ENUM('owner','accountant','manager','agent') NOT NULL,
      status ENUM('active','inactive') NOT NULL DEFAULT 'active'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db.query(`CREATE TABLE sx_legacy_ownership(
      source_table VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      source_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      legacy_uid_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      PRIMARY KEY (source_table,source_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await db.query(`CREATE TABLE \`user\`(
      id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      uid VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const names=['20260928_lead_pipeline.sql','20261007_pipeline_contacts.sql','20261022_pipeline_identity_activity_actor.sql','20261118_pipeline_lead_qualification.sql','20261001_platform_plans.sql','20261022_workspace_forms.sql'],migrations=discover(path.join(__dirname,'../database/migrations'));
    for(const name of names){const applied=await applyMigrations(db,migrations,{only:name});assert.deepEqual(applied.applied,[name]);}
    const evidence=await require('./workspace-forms-migration.integration.cjs')(db,{t1,t2,i1,i2,connect:()=>mysql.createConnection(connectionOptions)});
    console.log(JSON.stringify({mariaDb:server.version,databaseIsDisposable:true,migrations:names,...evidence,customerDataTouched:false,externalWrites:false}));
  }finally{await db.end();}
}
main().catch(error=>{process.stderr.write(`${error.code==='ERR_ASSERTION'?error.stack:error.code||error.message||'WORKSPACE_FORMS_MIGRATION_FAILED'}\n`);process.exitCode=1;});
