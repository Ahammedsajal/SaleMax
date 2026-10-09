'use strict';
// Run only in an isolated MariaDB container with no published port.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const mysql=require('mysql2/promise');
const assignments=require('../modules/platform/team-conversation-assignment');
const access=require('../modules/platform/team-inbox-scope');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
async function main(){
  if(process.env.SALEMAX_AGENT_DATABASE_PROOF!=='isolated-container')throw new Error('ISOLATED_DATABASE_REQUIRED');
  const db=await mysql.createConnection({host:'127.0.0.1',user:'root',password:'',multipleStatements:false});
  const name='salemax_agent_proof_'+crypto.randomBytes(5).toString('hex');
  try{
    await db.query('CREATE DATABASE '+name);await db.query('USE '+name);
    const tables=[
      'sx_tenants (id VARCHAR(36) PRIMARY KEY,status VARCHAR(20))',
      'user (id INT PRIMARY KEY,uid VARCHAR(64),role VARCHAR(20))',
      'agents (id INT PRIMARY KEY,uid VARCHAR(64),owner_uid VARCHAR(64),is_active INT)',
      'sx_identities (id VARCHAR(36) PRIMARY KEY,display_name VARCHAR(100),email_normalized VARCHAR(100),status VARCHAR(20))',
      'sx_memberships (id VARCHAR(36) PRIMARY KEY,tenant_id VARCHAR(36),identity_id VARCHAR(36),role VARCHAR(20),status VARCHAR(20),role_profile_id VARCHAR(36),delegated_permissions TEXT)',
      'sx_legacy_ownership (source_table VARCHAR(20),source_id VARCHAR(20),tenant_id VARCHAR(36),membership_id VARCHAR(36),legacy_uid_hash VARCHAR(64))',
      'sx_team_roles (id VARCHAR(36),tenant_id VARCHAR(36),permissions TEXT,status VARCHAR(20),seat_role VARCHAR(20))',
      'beta_chats (id INT PRIMARY KEY,uid VARCHAR(64),chat_id VARCHAR(255),assigned_agent TEXT)',
      'sx_audit_events (id VARCHAR(36),tenant_id VARCHAR(36),actor_identity_id VARCHAR(36),actor_kind VARCHAR(20),action VARCHAR(100),resource_type VARCHAR(40),resource_id VARCHAR(255),changes TEXT,correlation_id VARCHAR(36))'
    ];
    for(const table of tables)await db.query('CREATE TABLE '+table+' ENGINE=InnoDB');
    await db.query("INSERT INTO sx_tenants VALUES ('tenant','active')");
    await db.query("INSERT INTO user VALUES (1,'owner','user'),(2,'manager','user')");
    await db.query("INSERT INTO agents VALUES (1,'agent-a','owner',1),(2,'agent-b','owner',1),(3,'foreign-agent','other-owner',1),(4,'inactive-agent','owner',0)");
    const people=[['owner','owner','user',1],['manager','manager','user',2],['agent-a','agent','agents',1],['agent-b','agent','agents',2],['foreign-agent','agent','agents',3],['inactive-agent','agent','agents',4]];
    for(const [id,role,source,legacyId] of people){
      await db.query("INSERT INTO sx_identities VALUES (?,?,?,'active')",[id,id,id+'@example.test']);
      await db.query("INSERT INTO sx_memberships VALUES (?,'tenant',?,?,'active',NULL,'[]')",[id,id,role]);
      await db.query("INSERT INTO sx_legacy_ownership VALUES (?,?,'tenant',?,?)",[source,String(legacyId),id,hash(id)]);
    }
    await db.query("INSERT INTO beta_chats VALUES (1,'owner','shared-customer','[]')");
    const ctx={tenant:{id:'tenant'},identity:{id:'owner'},membership:{role:'owner'}};
    const staff=await assignments.eligibleStaff(db,'tenant');
    assert.deepEqual(staff.map(x=>x.uid).sort(),['agent-a','agent-b','manager','owner']);
    const query=async(sql,args)=>(await db.query(sql,args))[0];
    const agent={id:1,uid:'agent-a',role:'agent',isAgent:true,is_active:1,owner_uid:'owner'};
    const scope=await access.resolveInboxScope(query,agent,'send_chat_message');assert.equal(scope.uid,'owner');assert.equal(scope.assignedOnly,true);
    const pool={getConnection:async()=>({query:db.query.bind(db),beginTransaction:db.beginTransaction.bind(db),commit:db.commit.bind(db),rollback:db.rollback.bind(db),release:()=>{}})};
    const result=await assignments.routeIncomingConversation(pool,{ctx,uid:'owner',chatId:'shared-customer',profile:{config:{sharedInboxRouting:true,handoffAssigneeIdentityId:'manager'}},connectedUids:['agent-a']});
    assert.equal(result.assignee.uid,'agent-a');
    await access.authorizeInboxPayload(query,scope,'send_chat_message',{chatInfo:{chat_id:'shared-customer',sender_mobile:'forged'}});
    await db.beginTransaction();
    await assignments.assignConversation(db,{ctx:scope.ctx,uid:'owner',chatId:'shared-customer',identityId:'agent-b'});await db.commit();
    await assert.rejects(access.authorizeInboxPayload(query,scope,'send_chat_message',{chatInfo:{chat_id:'shared-customer'}}),{code:'TEAM_INBOX_PERMISSION_DENIED'});
    const [[chat]]=await db.query('SELECT * FROM beta_chats WHERE id=1');assert.equal(chat.uid,'owner');assert.equal(chat.chat_id,'shared-customer');assert.equal(JSON.parse(chat.assigned_agent).length,1);
    assert.equal(JSON.parse(chat.assigned_agent)[0].uid,'agent-b');
    for(const identityId of ['foreign-agent','inactive-agent'])await assert.rejects(assignments.assignConversation(db,{ctx,uid:'owner',chatId:'shared-customer',identityId}),{code:'CONVERSATION_ASSIGNEE_INVALID'});
    console.log(JSON.stringify({realAgentRows:true,onlineRouting:true,singletonTransfer:true,oldAgentReplyDenied:true,foreignAndInactiveExcluded:true,sharedOwnerPreserved:true}));
  }finally{await db.query('DROP DATABASE '+name);await db.end();}
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
