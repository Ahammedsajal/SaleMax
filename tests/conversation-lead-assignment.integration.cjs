'use strict';
const mysql=require('mysql2/promise'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {assignConversation,unassignConversation}=require('../modules/platform/team-conversation-assignment');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
(async()=>{
 const config=JSON.parse(process.env.SALEMAX_TRANSFER_TEST_CONFIG||'null');
 if(!config||config.host!=='salemax-transfer-test-db')throw Error('ISOLATED_TEST_DATABASE_REQUIRED');
 const database='salemax_transfer_test_'+crypto.randomBytes(6).toString('hex'),admin=await mysql.createConnection(config);
 let pool;
 try{
  await admin.query('CREATE DATABASE `'+database+'`');pool=mysql.createPool({...config,database,connectionLimit:4,multipleStatements:true});
  for(const file of ['20260928_lead_pipeline.sql','20261007_pipeline_contacts.sql'])await pool.query(fs.readFileSync(path.join(__dirname,'../database/migrations',file),'utf8'));
  await pool.query('ALTER TABLE pipeline_leads ADD COLUMN qualification_data JSON NULL');
  await pool.query(`CREATE TABLE user(id INT PRIMARY KEY,uid VARCHAR(100),name VARCHAR(100));
   CREATE TABLE agents(id INT PRIMARY KEY,uid VARCHAR(100),owner_uid VARCHAR(100),name VARCHAR(100),is_active INT);
   CREATE TABLE sx_tenants(id VARCHAR(36) PRIMARY KEY,status VARCHAR(20));
   CREATE TABLE sx_memberships(id VARCHAR(36),tenant_id VARCHAR(36),identity_id VARCHAR(36),role VARCHAR(30),status VARCHAR(20),role_profile_id VARCHAR(36));
   CREATE TABLE sx_identities(id VARCHAR(36) PRIMARY KEY,display_name VARCHAR(100),status VARCHAR(20));
   CREATE TABLE sx_legacy_ownership(source_table VARCHAR(10),source_id VARCHAR(36),tenant_id VARCHAR(36),membership_id VARCHAR(36),legacy_uid_hash CHAR(64));
   CREATE TABLE sx_team_roles(id VARCHAR(36),tenant_id VARCHAR(36),permissions JSON,status VARCHAR(20),seat_role VARCHAR(20));
   CREATE TABLE beta_chats(uid VARCHAR(100),chat_id VARCHAR(100),assigned_agent JSON,origin VARCHAR(10),sender_name VARCHAR(100),sender_mobile VARCHAR(40),PRIMARY KEY(uid,chat_id));
   CREATE TABLE sx_audit_events(id VARCHAR(36),tenant_id VARCHAR(36),actor_identity_id VARCHAR(36),actor_kind VARCHAR(30),action VARCHAR(60),resource_type VARCHAR(40),resource_id VARCHAR(100),changes JSON,correlation_id VARCHAR(36));`);
  await pool.query(fs.readFileSync(path.join(__dirname,'../database/migrations/20261227_conversation_assignment_index.sql'),'utf8'));
  await pool.query("INSERT INTO sx_tenants(id,status) VALUES('tenant-a','active')");
  await pool.query("INSERT INTO user VALUES(1,'owner','Main User');INSERT INTO agents VALUES(7,'agent-seven','owner','Seven',1),(8,'agent-eight','owner','Eight',1);");
  for(const [id,role,source,sourceId,uid]of [['owner-id','owner','user',1,'owner'],['seven','agent','agents',7,'agent-seven'],['eight','agent','agents',8,'agent-eight']]){
   await pool.query("INSERT INTO sx_identities VALUES(?,?,'active')",[id,id]);await pool.query("INSERT INTO sx_memberships VALUES(?, 'tenant-a',?,?,'active',NULL)",[id,id,role]);await pool.query("INSERT INTO sx_legacy_ownership VALUES(?,?,'tenant-a',?,?)",[source,String(sourceId),id,hash(uid)]);
  }
  await pool.query("INSERT INTO beta_chats VALUES('owner','chat-one',JSON_ARRAY(),'qr','Synthetic contact','97455555555'),('owner','chat-two',JSON_ARRAY(),'meta','Synthetic contact','97455555555'),('owner','rollback-chat',JSON_ARRAY(),'qr','Rollback contact','97455555556')");
  const ctx={tenant:{id:'tenant-a',categoryKey:'training_center'},identity:{id:'owner-id'},membership:{role:'owner'}};
  const transfer=async(chatId,identityId,rollback=false)=>{const db=await pool.getConnection();try{await db.beginTransaction();const r=await assignConversation(db,{ctx,uid:'owner',chatId,identityId});if(rollback)await db.rollback();else await db.commit();return r;}catch(e){await db.rollback();throw e;}finally{db.release();}};
  const unassign=async(chatId,assigneeUid,rollback=false)=>{const db=await pool.getConnection();try{await db.beginTransaction();const r=await unassignConversation(db,{ctx,uid:'owner',chatId,assigneeUid});if(rollback)await db.rollback();else await db.commit();return r;}catch(e){await db.rollback();throw e;}finally{db.release();}};
  const first=await transfer('chat-one','seven');assert.equal(first.lead.created,true);
  await pool.query("UPDATE pipeline_leads SET stage_key='qualified',expected_value=500,next_follow_up_at='2027-01-01' WHERE id=?",[first.lead.id]);
  const again=await transfer('chat-one','eight');assert.equal(again.lead.id,first.lead.id);assert.equal(again.lead.created,false);
  const repeat=await transfer('chat-one','eight');assert.equal(repeat.lead.id,first.lead.id);
  const [[lead]]=await pool.query('SELECT uid,owner_agent_id,stage_key,expected_value,next_follow_up_at FROM pipeline_leads WHERE id=?',[first.lead.id]);assert.equal(lead.uid,'owner');assert.equal(lead.owner_agent_id,8);assert.equal(lead.stage_key,'qualified');assert.equal(Number(lead.expected_value),500);assert.ok(lead.next_follow_up_at);
  const removed=await unassign('chat-one','agent-eight');assert.equal(removed.lead.ownerAgentId,null);
  const [[unassignedLead]]=await pool.query('SELECT owner_agent_id,stage_key,expected_value,next_follow_up_at FROM pipeline_leads WHERE id=?',[first.lead.id]);assert.equal(unassignedLead.owner_agent_id,null);assert.equal(unassignedLead.stage_key,'qualified');assert.equal(Number(unassignedLead.expected_value),500);assert.ok(unassignedLead.next_follow_up_at);
  const [[unassignedChat]]=await pool.query("SELECT assigned_agent FROM beta_chats WHERE chat_id='chat-one'");assert.deepEqual(typeof unassignedChat.assigned_agent==='string'?JSON.parse(unassignedChat.assigned_agent):unassignedChat.assigned_agent,[]);
  const [[assignmentCount]]=await pool.query("SELECT COUNT(*) AS count FROM sx_conversation_assignments WHERE tenant_id='tenant-a' AND chat_id='chat-one'");assert.equal(Number(assignmentCount.count),0);
  await transfer('chat-one','eight');
  const [[indexedAssignment]]=await pool.query("SELECT identity_id FROM sx_conversation_assignments WHERE tenant_id='tenant-a' AND chat_id='chat-one'");assert.equal(indexedAssignment.identity_id,'eight');
  await Promise.all([transfer('chat-one','eight'),transfer('chat-two','eight')]);
  const [[count]]=await pool.query('SELECT COUNT(*) AS n FROM pipeline_leads WHERE uid_hash=?',[hash('owner')]);assert.equal(count.n,1);
  const [[links]]=await pool.query('SELECT COUNT(*) AS n FROM pipeline_conversations WHERE lead_id=?',[first.lead.id]);assert.equal(links.n,2);
  const [[history]]=await pool.query("SELECT COUNT(*) AS n FROM pipeline_activity WHERE lead_id=? AND activity_type='lead_reassigned'",[first.lead.id]);assert.equal(history.n,3);
  await transfer('rollback-chat','seven',true);const [[after]]=await pool.query('SELECT COUNT(*) AS n FROM pipeline_leads');assert.equal(after.n,1);
  const [[chat]]=await pool.query("SELECT assigned_agent FROM beta_chats WHERE chat_id='rollback-chat'");assert.deepEqual(typeof chat.assigned_agent==='string'?JSON.parse(chat.assigned_agent):chat.assigned_agent,[]);
  await assert.rejects(transfer('chat-one','foreign'),{code:'CONVERSATION_ASSIGNEE_INVALID'});
  console.log('PASS: transfer create/reassign/unassign/retry/concurrent same-contact dedup/owner retention/stage and follow-up preservation/transaction rollback/foreign-recipient rejection');
 }finally{if(pool)await pool.end();await admin.query('DROP DATABASE `'+database+'`');await admin.end();}
})().catch(e=>{console.error(e.code||e.message);process.exit(1)});
