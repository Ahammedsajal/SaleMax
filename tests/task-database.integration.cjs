'use strict';
require('dotenv').config({quiet:true});
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const mysql=require('mysql2/promise');
const {discover,applyMigrations}=require('../database/migration-runner');

async function main(){
  if(process.env.LOCAL_ONLY_MODE!=='true'||!['127.0.0.1','localhost','::1'].includes(process.env.DBHOST))throw Error('LOCAL_DATABASE_ONLY');
  const socketPath=process.env.SALEMAX_TEST_DB_SOCKET||null;
  if(socketPath&&(!path.isAbsolute(socketPath)||!fs.lstatSync(socketPath,{throwIfNoEntry:false})?.isSocket()))throw Error('INVALID_LOCAL_TEST_DB_SOCKET');
  const name=`salemax_task_test_${crypto.randomBytes(6).toString('hex')}`;
  if(!/^salemax_task_test_[a-f0-9]{12}$/.test(name))throw Error('INVALID_SYNTHETIC_TEST_DATABASE');
  const config={host:process.env.DBHOST,port:Number(process.env.DBPORT),user:process.env.DBUSER,password:process.env.DBPASS==='__EMPTY__'?'':process.env.DBPASS,...(socketPath?{socketPath}:{})};
  const admin=await mysql.createConnection(config);let db,other,pool,created=false;
  try{
    await admin.query(`CREATE DATABASE \`${name}\``);created=true;
    db=await mysql.createConnection({...config,database:name});other=await mysql.createConnection({...config,database:name});pool=mysql.createPool({...config,database:name,connectionLimit:4});
    await db.query("CREATE TABLE sx_tenants(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,status VARCHAR(24) NOT NULL DEFAULT 'active') ENGINE=InnoDB");
    await db.query("CREATE TABLE sx_identities(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,email_normalized VARCHAR(254) NOT NULL,display_name VARCHAR(200) NOT NULL,status VARCHAR(24) NOT NULL DEFAULT 'active') ENGINE=InnoDB");
    await db.query("CREATE TABLE sx_memberships(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,role VARCHAR(24) NOT NULL,status VARCHAR(24) NOT NULL DEFAULT 'active',KEY idx_task_membership(tenant_id,identity_id,status)) ENGINE=InnoDB");
    await db.query("CREATE TABLE agents(id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,owner_uid VARCHAR(999) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,uid VARCHAR(999) NOT NULL,email VARCHAR(254) NOT NULL,password VARCHAR(255) NOT NULL,name VARCHAR(255) NOT NULL,mobile VARCHAR(64),role VARCHAR(24) NOT NULL DEFAULT 'agent',is_active TINYINT NOT NULL DEFAULT 1) ENGINE=InnoDB");
    await db.query("CREATE TABLE `user`(id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,uid VARCHAR(999) NOT NULL,name VARCHAR(255),email VARCHAR(254),mobile VARCHAR(64)) ENGINE=InnoDB");
    await db.query("CREATE TABLE pipeline_leads(id CHAR(36) NOT NULL PRIMARY KEY,uid_hash CHAR(64) NOT NULL,uid VARCHAR(999) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,identity_key CHAR(64) NOT NULL,contact_id CHAR(36),title VARCHAR(180) NOT NULL,contact_name VARCHAR(255),learner_name VARCHAR(255),mobile VARCHAR(64),chat_id VARCHAR(999),stage_key VARCHAR(64) NOT NULL DEFAULT 'new',owner_agent_id INT,status VARCHAR(24) NOT NULL DEFAULT 'open',priority VARCHAR(24) NOT NULL DEFAULT 'normal',expected_value DECIMAL(14,2),currency CHAR(3) NOT NULL DEFAULT 'QAR',next_follow_up_at DATETIME(3),last_activity_at DATETIME(3),created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB");
    await db.query("CREATE TABLE pipeline_activity(id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,uid_hash CHAR(64) NOT NULL,lead_id CHAR(36) NOT NULL,actor_type VARCHAR(24) NOT NULL,actor_id VARCHAR(191) NOT NULL,activity_type VARCHAR(64) NOT NULL,summary VARCHAR(1000) NOT NULL,details JSON,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),KEY idx_task_lead_activity(uid_hash,lead_id,created_at,id)) ENGINE=InnoDB");
    await db.query("CREATE TABLE pipeline_contacts(id CHAR(36) NOT NULL,uid_hash CHAR(64) NOT NULL,display_name VARCHAR(255),normalized_email VARCHAR(254),preferred_language VARCHAR(8),PRIMARY KEY(uid_hash,id)) ENGINE=InnoDB");
    await db.query("CREATE TABLE pipeline_conversations(id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,uid_hash CHAR(64) NOT NULL,lead_id CHAR(36) NOT NULL,conversation_key CHAR(64) NOT NULL,chat_id VARCHAR(999) NOT NULL,origin VARCHAR(12) NOT NULL,first_inbound_at DATETIME(3) NOT NULL,last_inbound_at DATETIME(3) NOT NULL,KEY idx_task_lead_conversation(uid_hash,lead_id,last_inbound_at)) ENGINE=InnoDB");
    await db.query("CREATE TABLE pipeline_attributions(id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,uid_hash CHAR(64) NOT NULL,lead_id CHAR(36) NOT NULL,conversation_key CHAR(64) NOT NULL,event_key CHAR(64) NOT NULL,source_type VARCHAR(64) NOT NULL,source_id VARCHAR(191),source_url TEXT,headline VARCHAR(500),body VARCHAR(1000),media_type VARCHAR(64),ctwa_clid VARCHAR(255),is_verified_ad TINYINT NOT NULL DEFAULT 0,event_at DATETIME(3),received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),KEY idx_task_lead_attribution(uid_hash,lead_id,received_at)) ENGINE=InnoDB");
    const allMigrations=discover(path.join(__dirname,'../database/migrations'));
    const tasksMigration=allMigrations.filter(m=>['20261103_task_management.sql','20261117_task_chat_collaboration.sql'].includes(m.file));
    assert.equal(tasksMigration.length,2,'task and chat migrations are present and uniquely discoverable');
    const migrated=await applyMigrations(db,tasksMigration);assert.deepEqual(migrated.applied,['20261103_task_management.sql','20261117_task_chat_collaboration.sql']);
    const tenantId=crypto.randomUUID(),identityId=crypto.randomUUID();
    await db.query('INSERT INTO sx_tenants(id,status) VALUES(?,?)',[tenantId,'active']);
    await db.query('INSERT INTO sx_identities(id,email_normalized,display_name,status) VALUES(?,?,?,?)',[identityId,'task-owner@example.invalid','Synthetic Task Owner','active']);
    await db.query('INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES(?,?,?,?,?)',[crypto.randomUUID(),tenantId,identityId,'owner','active']);
    const [[serverInfo]]=await db.query('SELECT VERSION() AS version');
    const evidence=await require('./task-integration.cjs')(db,other,{tenantId,identityId,pool});
    console.log(JSON.stringify({localDisposableDatabase:true,databaseVersion:serverInfo.version,tableStorage:'InnoDB',taskMigration:true,...evidence,customerDataTouched:false,externalWrites:false}));
  }finally{
    if(pool)await pool.end();if(other)await other.end();if(db)await db.end();
    if(created)await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await admin.end();
  }
}
main().catch(error=>{console.error('Task database integration failed:',error.code||error.message,error.stack||'');process.exitCode=1;});
